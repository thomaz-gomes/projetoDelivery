// src/integrations/aiqfome/webhookProcessor.js
// Processes webhooks from aiqbridge (iFood-compatible format)
import { prisma } from '../../prisma.js';
import { emitirNovoPedido, emitirPedidoAtualizado } from '../../index.js';
import { canTransition } from '../../stateMachine.js';
import { findOrCreateCustomer, normalizePhone, buildConcatenatedAddress, normalizeDeliveryAddressFromPayload } from '../../services/customers.js';
import { matchItemsToLocalProducts } from '../../utils/integrationMatcher.js';
import { nextDisplaySimple } from '../../utils/displaySimple.js';
import { aiqfomeGet, aiqfomePost } from './client.js';
import { reverseStockMovementForOrder } from '../../services/stockFromOrder.js';

/**
 * Resolve companyId from merchantId in ApiIntegration
 */
async function resolveCompany(merchantId) {
  if (!merchantId) return null;
  const key = String(merchantId).trim();

  const integ = await prisma.apiIntegration.findFirst({
    where: { provider: 'AIQFOME', merchantId: key },
    select: { id: true, companyId: true, storeId: true, autoAccept: true },
  });

  if (integ) {
    let storeId = integ.storeId;
    if (!storeId) {
      const first = await prisma.store.findFirst({ where: { companyId: integ.companyId }, select: { id: true }, orderBy: { createdAt: 'asc' } });
      storeId = first?.id || null;
    }
    return { integrationId: integ.id, companyId: integ.companyId, storeId, autoAccept: !!integ.autoAccept };
  }

  // Fallback: only one AIQFOME integration
  const all = await prisma.apiIntegration.findMany({ where: { provider: 'AIQFOME' }, select: { id: true, companyId: true, storeId: true, autoAccept: true } });
  if (all.length === 1) {
    return { integrationId: all[0].id, companyId: all[0].companyId, storeId: all[0].storeId, autoAccept: !!all[0].autoAccept };
  }
  return null;
}

/**
 * Map iFood-format event code to local status
 */
function mapEventToStatus(eventCode) {
  const map = {
    'PLACED': 'PENDENTE_ACEITE',
    'NEW_ORDER': 'PENDENTE_ACEITE',
    'CONFIRMED': 'EM_PREPARO',
    'READY_TO_PICKUP': 'PRONTO',
    'DISPATCHED': 'SAIU_PARA_ENTREGA',
    'CONCLUDED': 'CONCLUIDO',
    'CANCELLED': 'CANCELADO',
  };
  return map[String(eventCode).toUpperCase()] || null;
}

/**
 * Process a webhook event from aiqbridge.
 * aiqbridge sends: { event: "NEW_ORDER", order_id, merchant_id, timestamp }
 * We fetch full order details via GET /orders/:orderId
 */
export async function processAiqfomeWebhook(eventId) {
  const evt = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!evt || evt.status === 'PROCESSED') return;

  try {
    const payload = evt.payload;
    const eventType = payload?.event || payload?.fullCode || payload?.code || 'NEW_ORDER';
    const orderId = payload?.order_id || payload?.orderId || payload?.id;
    const merchantId = payload?.merchant_id || payload?.merchantId;

    if (!orderId) throw new Error('Payload sem order_id');

    // Resolve company
    const resolved = await resolveCompany(merchantId);
    if (!resolved) throw new Error(`Company not found for merchantId: ${merchantId}`);
    const { integrationId, companyId, storeId, autoAccept } = resolved;

    const externalId = String(orderId);
    const status = mapEventToStatus(eventType);

    // Check if order exists
    const existingOrder = await prisma.order.findFirst({ where: { externalId, companyId } });

    if (existingOrder) {
      // ---- UPDATE ----
      if (status && status !== existingOrder.status && canTransition(existingOrder.status, status)) {
        const updated = await prisma.order.update({
          where: { id: existingOrder.id },
          data: {
            status,
            histories: { create: { from: existingOrder.status, to: status, reason: `aiqbridge webhook (${eventType})` } },
          },
          include: { items: true },
        });
        if (status === 'CANCELADO') {
          try {
            await reverseStockMovementForOrder(prisma, updated.id, null);
          } catch (e) {
            console.warn('reverseStockMovementForOrder failed for order', updated.id, e?.message);
          }
        }
        emitirPedidoAtualizado(updated);
        console.log(`[aiqbridge] Order ${existingOrder.id}: ${existingOrder.status} -> ${status}`);
      }
    } else {
      // ---- CREATE: fetch full order details from aiqbridge ----
      const terminalStatuses = ['CANCELADO', 'CONCLUIDO'];
      if (terminalStatuses.includes(status)) {
        console.log(`[aiqbridge] Skipping creation for terminal status: ${status}`);
        await prisma.webhookEvent.update({ where: { id: evt.id }, data: { status: 'PROCESSED', processedAt: new Date() } });
        return;
      }

      let orderData;
      try {
        orderData = await aiqfomeGet(integrationId, `/orders/${orderId}`);
      } catch (e) {
        console.warn(`[aiqbridge] Failed to fetch order ${orderId}:`, e?.response?.data || e?.message);
        // Use payload as fallback
        orderData = payload;
      }

      // Parse iFood-format order
      const order = orderData?.order || orderData?.data || orderData;
      const customer = order?.customer || order?.user || {};
      const delivery = order?.delivery || {};
      const deliveryAddr = delivery?.deliveryAddress || customer?.address || {};
      const payments = order?.payments || [];

      // Customer
      const customerName = customer?.name || customer?.fullName || [customer?.name, customer?.surname].filter(Boolean).join(' ') || 'Cliente';
      const customerPhone = normalizePhone(customer?.phone?.number || customer?.phone || customer?.mobile_phone || customer?.phone_number || '');
      let customerId = null;
      try {
        const c = await findOrCreateCustomer({ companyId, fullName: customerName, phone: customerPhone, whatsapp: customerPhone, persistPhone: true });
        customerId = c?.id || null;
      } catch (e) { /* non-blocking */ }

      // Address
      const formattedAddress = buildConcatenatedAddress({ delivery: { deliveryAddress: deliveryAddr } })
        || deliveryAddr?.formattedAddress
        || [deliveryAddr?.street_name || deliveryAddr?.streetName, deliveryAddr?.number || deliveryAddr?.streetNumber].filter(Boolean).join(', ')
        || null;
      const latitude = Number(deliveryAddr?.latitude ?? deliveryAddr?.coordinates?.latitude ?? null) || null;
      const longitude = Number(deliveryAddr?.longitude ?? deliveryAddr?.coordinates?.longitude ?? null) || null;
      const neighborhood = deliveryAddr?.neighborhood_name || deliveryAddr?.neighborhood || null;

      // Items
      const rawItems = order?.items || [];
      let items = rawItems.map(it => {
        const subs = it.subItems || it.subitems || it.garnishItems || it.order_mandatory_items || [];
        const options = subs.length > 0 ? subs.map(s => ({ name: s.name, quantity: Number(s.quantity || 1), price: Number(s.price || s.value || 0) })) : null;
        return {
          name: it.name || 'Item',
          quantity: Number(it.quantity || 1),
          price: Number(it.unitPrice || it.unit_value || it.price || 0),
          notes: it.observations || it.note || null,
          externalCode: it.externalCode || it.sku || null,
          options,
        };
      });

      // Match to local products
      try {
        if (items.length > 0) {
          const matched = await matchItemsToLocalProducts(items, companyId);
          items = matched.map(it => ({ ...it, productId: it._matchedProductId || null }));
        }
      } catch (e) { /* non-blocking */ }

      // Payment/totals
      const total = Number(order?.total?.orderAmount ?? order?.totalAmount ?? payments?.[0]?.value ?? order?.payment_method?.total ?? 0);
      const deliveryFee = Number(order?.total?.deliveryFee ?? order?.deliveryFee ?? order?.payment_method?.delivery_tax ?? 0) || null;
      const orderType = (order?.orderType === 'TAKEOUT' || order?.is_pickup) ? 'TAKEOUT' : 'DELIVERY';
      const initialStatus = status || 'PENDENTE_ACEITE';
      const displaySimple = await nextDisplaySimple(companyId);

      const savedOrder = await prisma.order.create({
        data: {
          companyId,
          storeId: storeId || null,
          externalId,
          displaySimple,
          status: initialStatus,
          customerId,
          customerSource: 'AIQFOME',
          customerName,
          customerPhone,
          address: formattedAddress,
          deliveryNeighborhood: neighborhood,
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
          total,
          deliveryFee,
          orderType,
          payload: order,
          items: {
            create: items.map(i => ({
              name: i.name,
              quantity: i.quantity,
              price: i.price,
              notes: i.notes || null,
              productId: i.productId || null,
              options: i.options || null,
            })),
          },
          histories: { create: [{ from: null, to: initialStatus, reason: `aiqbridge webhook (${eventType})` }] },
        },
        include: { items: true, histories: true },
      });

      console.log(`[aiqbridge] Created order ${savedOrder.id} (${externalId}), status: ${initialStatus}`);

      // Auto-accept
      if (autoAccept && initialStatus === 'PENDENTE_ACEITE') {
        try {
          await aiqfomePost(integrationId, `/orders/${orderId}/confirm`, {});
          await prisma.order.update({
            where: { id: savedOrder.id },
            data: { status: 'EM_PREPARO', histories: { create: { from: 'PENDENTE_ACEITE', to: 'EM_PREPARO', reason: 'aiqbridge auto-accept' } } },
          });
          savedOrder.status = 'EM_PREPARO';
          console.log(`[aiqbridge] Auto-accepted order ${savedOrder.id}`);
        } catch (e) {
          console.warn('[aiqbridge] Auto-accept failed:', e?.message);
        }
      }

      // Pad displaySimple for emit
      if (savedOrder.displaySimple != null) savedOrder.displaySimple = String(savedOrder.displaySimple).padStart(2, '0');

      emitirNovoPedido(savedOrder);
    }

    await prisma.webhookEvent.update({ where: { id: evt.id }, data: { status: 'PROCESSED', processedAt: new Date(), error: null } });
  } catch (err) {
    console.error('[aiqbridge] Webhook processing error:', err);
        await prisma.webhookEvent.update({ where: { id: evt.id }, data: { status: 'ERROR', error: String(err) } });
      }
    }