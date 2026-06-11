// src/integrations/aiqfome/webhookProcessor.js
// Processes webhooks from aiqbridge (iFood-compatible format)
import { prisma } from '../../prisma.js';
import { emitirNovoPedido, emitirPedidoAtualizado } from '../../index.js';
import { canTransition } from '../../stateMachine.js';
import { findOrCreateCustomer, normalizePhone, buildConcatenatedAddress, normalizeDeliveryAddressFromPayload } from '../../services/customers.js';
import { matchItemsToLocalProducts } from '../../utils/integrationMatcher.js';
import { nextDisplaySimple } from '../../utils/displaySimple.js';
import { resolveMenuForStore } from '../../utils/resolveMenuForStore.js';
import { aiqfomeGet, aiqfomePost } from './client.js';
import { reverseStockMovementForOrder } from '../../services/stockFromOrder.js';

// aiqbridge expõe os pedidos pela família iFood-compatível, namespaced por versão.
// Sem este prefixo o fetch de detalhes e o confirm caem em 404.
const ORDER_API = '/ifood/order/v1.0';

/**
 * Resolve companyId from merchantId in ApiIntegration
 */
// Extração tolerante: a bridge pode aninhar (data/order) ou usar nomes variados.
function firstVal(...vals) { return vals.find(v => v != null && v !== '') ?? null; }

function extractOrderId(p) {
  const d = p?.data || {};
  const o = p?.order || d?.order || {};
  return firstVal(
    p?.order_id, p?.orderId, p?.id,
    d?.order_id, d?.orderId, d?.id,
    o?.id, o?.order_id, o?.orderId,
    p?.orderExternalId, p?.order_external_id, p?.reference,
    p?.correlationId, p?.correlation_id, d?.correlationId,
  );
}

function extractEventCode(p) {
  const d = p?.data || {};
  return firstVal(
    p?.event, p?.fullCode, p?.code, p?.type, p?.event_type, p?.eventType,
    d?.event, d?.code, d?.fullCode, d?.type,
  ) || 'NEW_ORDER';
}

function extractMerchantId(p) {
  const d = p?.data || {};
  const o = p?.order || d?.order || {};
  return firstVal(
    p?.merchant_id, p?.merchantId,
    d?.merchant_id, d?.merchantId,
    o?.merchant_id, o?.merchantId, o?.merchant?.id,
  );
}

// Escolhe o vínculo de cardápio default (ou o único), como no iFood.
function pickMenuLink(links) {
  const arr = Array.isArray(links) ? links : [];
  if (!arr.length) return null;
  return arr.find(l => l.isDefault) || (arr.length === 1 ? arr[0] : null);
}

async function resolveCompany(merchantId) {
  const include = { menuLinks: { include: { menu: { select: { id: true, name: true, storeId: true } } } } };
  const key = merchantId != null ? String(merchantId).trim() : null;

  let integ = null;
  if (key) {
    integ = await prisma.apiIntegration.findFirst({ where: { provider: 'AIQFOME', merchantId: key }, include });
  }
  // Sem match por merchantId (ex.: evento de teste usa merchant de amostra, ou
  // merchantId não cadastrado): usa a integração AIQFOME mais recente — preferindo
  // habilitadas — em vez de descartar o pedido.
  if (!integ) {
    const all = await prisma.apiIntegration.findMany({ where: { provider: 'AIQFOME' }, orderBy: { updatedAt: 'desc' }, include });
    if (all.length) {
      integ = all.find(i => i.enabled) || all[0];
      console.warn(`[aiqbridge] merchantId ${key || '(ausente)'} sem match exato — usando fallback ${integ.id} de ${all.length} integração(ões)`);
    }
  }
  if (!integ) { console.warn('[aiqbridge] nenhuma integração AIQFOME cadastrada — pedido descartado'); return null; }

  // Roteamento por cardápio: integração → cardápio default → loja (mesma lógica
  // do iFood via applyMenuLinkRouting). Cai para storeId direto se não houver vínculo.
  const link = pickMenuLink(integ.menuLinks);
  const menuId = link?.menu?.id || null;
  let storeId = link?.menu?.storeId || integ.storeId || null;
  if (!storeId) {
    const first = await prisma.store.findFirst({ where: { companyId: integ.companyId }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    storeId = first?.id || null;
  }
  if (link) console.log('[aiqbridge] roteando via cardápio:', { menuId, menuName: link.menu?.name, storeId, isDefault: link.isDefault });

  return { integrationId: integ.id, companyId: integ.companyId, storeId, menuId, autoAccept: !!integ.autoAccept };
}

/**
 * Map iFood-format event code to local status
 */
function mapEventToStatus(eventCode) {
  const map = {
    // Formato iFood OUT (o que a bridge realmente envia no payload)
    'PLACED': 'PENDENTE_ACEITE',
    'CONFIRMED': 'EM_PREPARO',
    'READY_FOR_PICKUP': 'PRONTO',
    'READY_TO_PICKUP': 'PRONTO',
    'DISPATCHED': 'SAIU_PARA_ENTREGA',
    'DELIVERED': 'CONCLUIDO',
    'CONCLUDED': 'CONCLUIDO',
    'CANCELLED': 'CANCELADO',
    // Códigos curtos Open Delivery (PLC/CFM/RDY/DSP/CON/CAN)
    'PLC': 'PENDENTE_ACEITE',
    'CFM': 'EM_PREPARO',
    'RDY': 'PRONTO',
    'DSP': 'SAIU_PARA_ENTREGA',
    'CON': 'CONCLUIDO',
    'CAN': 'CANCELADO',
    // Nomes de event_type do aiqbridge (ORDER_*) — defensivo
    'NEW_ORDER': 'PENDENTE_ACEITE',
    'ORDER_CREATED': 'PENDENTE_ACEITE',
    'ORDER_CONFIRMED': 'EM_PREPARO',
    'ORDER_PREPARATION_STARTED': 'EM_PREPARO',
    'ORDER_READY': 'PRONTO',
    'ORDER_DISPATCHED': 'SAIU_PARA_ENTREGA',
    'ORDER_DELIVERED': 'CONCLUIDO',
    'ORDER_CANCELLED': 'CANCELADO',
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
    const orderId = extractOrderId(payload);
    const eventType = extractEventCode(payload);
    const merchantId = extractMerchantId(payload);

    if (!orderId) {
      // Loga as chaves do payload p/ descobrir onde a bridge põe o id do pedido.
      console.warn('[aiqbridge] payload sem order_id. Chaves top-level:', Object.keys(payload || {}), 'data:', Object.keys(payload?.data || {}), 'order:', Object.keys(payload?.order || {}));
      throw new Error('Payload sem order_id');
    }

    // Resolve company
    const resolved = await resolveCompany(merchantId);
    if (!resolved) throw new Error(`Company not found for merchantId: ${merchantId}`);
    const { integrationId, companyId, storeId, menuId: routedMenuId, autoAccept } = resolved;

    const externalId = String(orderId);
    const status = mapEventToStatus(eventType);
    console.log('[aiqbridge] processando webhook:', { eventType, status, orderId: externalId, merchantId, companyId, storeId, menuId: routedMenuId });

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
        orderData = await aiqfomeGet(integrationId, `${ORDER_API}/orders/${orderId}`);
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

      // Aiqfome payloads don't carry a menuId — derive it from the store so
      // every order ends up with menuId set (per-menu WhatsApp routing and
      // {{loja}} placeholder depend on it).
      // Prefere o cardápio vinculado à integração (default); cai para a heurística por loja.
      const resolvedMenuId = routedMenuId || await resolveMenuForStore(storeId);

      const savedOrder = await prisma.order.create({
        data: {
          companyId,
          storeId: storeId || null,
          menuId: resolvedMenuId,
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
            create: items.map(i => {
              const subs = Array.isArray(i.options) ? i.options : []
              const options = subs.length > 0 ? subs.map(s => {
                const kind = s._kind || 'addon'
                const price = Number(s.unitPrice || s.price || 0) || (Number(s.totalPrice || 0) / (Number(s.quantity || 1) || 1))
                const opt = {
                  kind,
                  name: s.name,
                  quantity: Number(s.quantity || 1),
                  price,
                  productId: s._matchedProductId || null,
                  _matchedProductId: s._matchedProductId || null,
                }
                if (kind === 'combo_slot') {
                if (s._vUnComDeclarado != null) opt.vUnComDeclarado = Number(s._vUnComDeclarado)
                if (s._slotId) opt.slotId = s._slotId
                if (s._slotName) opt.slotName = s._slotName
              }
                return opt
              }) : null
              return {
                name: i.name,
                quantity: i.quantity,
                price: i.price,
                notes: i.notes || null,
                productId: i.productId || null,
                options,
              }
            }),
          },
          histories: { create: [{ from: null, to: initialStatus, reason: `aiqbridge webhook (${eventType})` }] },
        },
        include: { items: true, histories: true },
      });

      console.log(`[aiqbridge] Created order ${savedOrder.id} (${externalId}), status: ${initialStatus}`);

      // Auto-accept
      if (autoAccept && initialStatus === 'PENDENTE_ACEITE') {
        try {
          await aiqfomePost(integrationId, `${ORDER_API}/orders/${orderId}/confirm`, {});
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

      // Check cash session
      try {
        const { findMatchingSession } = await import('../../services/cash/sessionMatcher.js');
        const matchedSession = await findMatchingSession(savedOrder, null);
        if (matchedSession) {
          await prisma.order.update({ where: { id: savedOrder.id }, data: { cashSessionId: matchedSession.id, outOfSession: false } });
        } else {
          await prisma.order.update({ where: { id: savedOrder.id }, data: { outOfSession: true } });
        }
      } catch (e) { console.warn('[aiqfome] cash session check failed:', e?.message); }

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