// src/integrations/aiqfome/webhookProcessor.js
import { prisma } from '../../prisma.js';
import { emitirNovoPedido, emitirPedidoAtualizado } from '../../index.js';
import { canTransition } from '../../stateMachine.js';
import { findOrCreateCustomer, normalizePhone } from '../../services/customers.js';
import { matchItemsToLocalProducts } from '../../utils/integrationMatcher.js';
import { aiqfomePost } from './client.js';

/**
 * Determina o status interno a partir dos flags booleanos do pedido aiqfome.
 * Ordem de prioridade: estados terminais primeiro, depois progressivos.
 */
export function determineStatusFromAiqfome(order) {
  if (!order) return null;
  if (order.is_cancelled) return 'CANCELADO';
  if (order.is_delivered) return 'CONCLUIDO';
  if (order.is_ready) return 'PRONTO';
  if (order.is_in_separation) return 'EM_PREPARO';
  if (order.is_read) return 'EM_PREPARO';
  // Not read and not cancelled -> pending acceptance
  return 'PENDENTE_ACEITE';
}

/**
 * Resolve companyId + storeId a partir do store.id do payload aiqfome.
 * Busca ApiIntegration com provider='AIQFOME' e merchantId correspondente.
 */
async function resolveCompanyFromAiqfome(aiqfomeStoreId) {
  if (!aiqfomeStoreId) return null;

  const merchantKey = String(aiqfomeStoreId).trim();

  const integ = await prisma.apiIntegration.findFirst({
    where: {
      provider: 'AIQFOME',
      merchantId: merchantKey,
    },
    select: { id: true, companyId: true, storeId: true, autoAccept: true },
  });

  if (integ) {
    let resolvedStoreId = integ.storeId || null;

    // If no storeId on integration, fallback to first store of the company
    if (!resolvedStoreId) {
      try {
        const firstStore = await prisma.store.findFirst({
          where: { companyId: integ.companyId },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        resolvedStoreId = firstStore?.id || null;
        if (resolvedStoreId) {
          console.log('[aiqfome Processor] sem storeId na integração, usando primeira loja:', resolvedStoreId);
        }
      } catch (e) { /* ignore */ }
    }

    return {
      integrationId: integ.id,
      companyId: integ.companyId,
      storeId: resolvedStoreId,
      autoAccept: !!integ.autoAccept,
    };
  }

  // Fallback: if there is only one AIQFOME integration, assume it
  try {
    const all = await prisma.apiIntegration.findMany({
      where: { provider: 'AIQFOME' },
      select: { id: true, companyId: true, storeId: true, autoAccept: true },
    });
    if (all && all.length === 1) {
      console.warn('[aiqfome Processor] fallback: only one AIQFOME integration found; assigning companyId', all[0].companyId);
      return {
        integrationId: all[0].id,
        companyId: all[0].companyId,
        storeId: all[0].storeId || null,
        autoAccept: !!all[0].autoAccept,
      };
    }
  } catch (e) { /* ignore */ }

  return null;
}

/**
 * Formata endereço a partir dos campos do user.address do aiqfome
 */
function formatAiqfomeAddress(addr) {
  if (!addr) return null;
  const parts = [
    addr.street_name,
    addr.number,
    addr.complement,
    addr.neighborhood_name,
    addr.city_name,
    addr.state_uf,
  ].filter(Boolean);
  return parts.join(', ') || null;
}

/**
 * Mapeia itens do payload aiqfome para o formato OrderItem local.
 * Agrupa mandatory_items, additional_items e subitems em options (JSON).
 */
function mapAiqfomeItems(items) {
  if (!Array.isArray(items)) return [];

  return items.map((it) => {
    const qty = Number(it.quantity || 1);
    const unitPrice = Number(it.unit_value || 0);

    // Build options from mandatory_items, additional_items, and subitems
    const options = [];

    if (Array.isArray(it.order_mandatory_items)) {
      for (const m of it.order_mandatory_items) {
        options.push({
          type: 'mandatory',
          group: m.group || null,
          name: m.name || '',
          quantity: Number(m.quantity || 1),
          price: Number(m.value || 0),
          sku: m.sku || null,
        });
      }
    }

    if (Array.isArray(it.order_additional_items)) {
      for (const a of it.order_additional_items) {
        options.push({
          type: 'additional',
          name: a.name || '',
          quantity: Number(a.quantity || 1),
          price: Number(a.value || 0),
          sku: a.sku || null,
        });
      }
    }

    if (Array.isArray(it.order_item_subitems)) {
      for (const s of it.order_item_subitems) {
        options.push({
          type: 'subitem',
          name: s.name || '',
          sku: s.sku || null,
        });
      }
    }

    return {
      name: it.name || 'Item',
      quantity: qty,
      price: unitPrice,
      notes: it.observations || null,
      externalCode: it.sku || null,
      options: options.length > 0 ? options : null,
      // Keep sub-items in legacy format for matchItemsToLocalProducts compatibility
      subItems: options.filter(o => o.type !== 'subitem').map(o => ({
        name: o.name,
        quantity: o.quantity || 1,
        price: o.price || 0,
      })),
    };
  });
}

/**
 * Upsert customer from aiqfome payload.
 * Uses phone as primary matching key, creates if not found.
 */
async function upsertCustomerFromAiqfome({ companyId, user }) {
  if (!user) return null;

  const fullName = [user.name, user.surname].filter(Boolean).join(' ') || null;
  const rawPhone = user.mobile_phone || user.phone_number || null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const cpf = user.document_receipt || null;

  if (!phone && !fullName) return null;

  try {
    const customer = await findOrCreateCustomer({
      companyId,
      fullName,
      cpf,
      whatsapp: phone,
      phone,
      addressPayload: null,
      persistPhone: true,
    });
    return customer;
  } catch (e) {
    console.warn('[aiqfome Processor] upsertCustomer failed:', e?.message || e);
    return null;
  }
}

/**
 * Processa um WebhookEvent do aiqfome salvo no banco.
 */
export async function processAiqfomeWebhook(eventId) {
  const evt = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!evt) return;

  // Skip already-processed events
  if (evt.status === 'PROCESSED') {
    console.log('[aiqfome Processor] skipping already-processed event', eventId);
    return;
  }

  try {
    const payload = evt.payload;
    // Order lives in payload.data or payload directly
    const order = payload?.data || payload;

    if (!order || !order.id) {
      throw new Error('Payload inválido: sem order.id');
    }

    const externalId = String(order.id);

    // Resolve company via store.id
    const aiqfomeStoreId = order.store?.id || null;
    const resolved = await resolveCompanyFromAiqfome(aiqfomeStoreId);
    if (!resolved || !resolved.companyId) {
      console.error('[aiqfome Processor] falha ao resolver companyId para store.id:', aiqfomeStoreId);
      throw new Error('Não foi possível determinar companyId a partir do payload (store.id não encontrado em ApiIntegration).');
    }

    const { integrationId, companyId, storeId, autoAccept } = resolved;

    // Determine status from boolean flags
    const status = determineStatusFromAiqfome(order);
    console.log('[aiqfome Processor] order', externalId, 'status:', status);

    // Upsert customer
    let customerId = null;
    try {
      const customer = await upsertCustomerFromAiqfome({ companyId, user: order.user });
      if (customer) {
        customerId = customer.id;
        console.log('[aiqfome Processor] customer upserted:', customer.id, customer.fullName);
      }
    } catch (e) {
      console.warn('[aiqfome Processor] customer upsert failed:', e?.message || e);
    }

    // Format address
    const addr = order.user?.address || null;
    const formattedAddress = formatAiqfomeAddress(addr);
    const latitude = addr?.latitude != null ? Number(addr.latitude) : null;
    const longitude = addr?.longitude != null ? Number(addr.longitude) : null;

    // Map items
    let items = mapAiqfomeItems(order.items);

    // Match integration items to local products by integrationCode
    try {
      if (items.length > 0) {
        const matchedItems = await matchItemsToLocalProducts(items, companyId);
        items = matchedItems.map(it => ({
          ...it,
          productId: it._matchedProductId || null,
        }));
      }
    } catch (e) {
      console.warn('[aiqfome Processor] integration code matching failed:', e?.message || e);
    }

    // Payment info
    const pm = order.payment_method || {};
    const total = Number(pm.total || 0);
    const deliveryFee = Number(pm.delivery_tax || 0) || null;
    const couponDiscount = Number(pm.coupon_value || 0) || null;
    const changeFor = pm.change != null ? Number(pm.change) : null;
    const paymentMethodName = pm.name || null;
    const prePaid = !!pm.pre_paid;

    // Customer info
    const customerName = [order.user?.name, order.user?.surname].filter(Boolean).join(' ') || 'Cliente';
    const customerPhone = order.user?.mobile_phone || order.user?.phone_number || null;

    // Order type
    const orderType = order.is_pickup ? 'TAKEOUT' : 'DELIVERY';

    // Check if order already exists
    const existingOrder = await prisma.order.findFirst({
      where: { externalId, companyId },
    });

    if (existingOrder) {
      // ---- UPDATE existing order ----
      const currentStatus = existingOrder.status;
      let statusChanged = false;

      if (status && status !== currentStatus) {
        if (canTransition(currentStatus, status)) {
          await prisma.order.update({
            where: { id: existingOrder.id },
            data: {
              status,
              payload: order,
              histories: {
                create: { from: currentStatus, to: status, reason: 'aiqfome webhook (update)' },
              },
            },
          });
          statusChanged = true;
          console.log('[aiqfome Processor] status change allowed:', existingOrder.id, currentStatus, '->', status);

          // Emit update event
          try {
            const updatedOrder = await prisma.order.findUnique({
              where: { id: existingOrder.id },
              include: { items: true, histories: true },
            });
            if (updatedOrder) emitirPedidoAtualizado(updatedOrder);
          } catch (eEmit) {
            console.warn('[aiqfome Processor] emit update failed:', eEmit?.message);
          }
        } else {
          console.warn('[aiqfome Processor] status transition NOT allowed:', existingOrder.id, currentStatus, '->', status);
        }
      }
    } else {
      // ---- CREATE new order ----

      // Skip creation for terminal statuses
      const terminalStatuses = ['CANCELADO', 'CONCLUIDO'];
      if (terminalStatuses.includes(status)) {
        console.log('[aiqfome Processor] skipping creation of order with terminal status:', status, 'externalId:', externalId);
        await prisma.webhookEvent.update({
          where: { id: evt.id },
          data: { status: 'PROCESSED', processedAt: new Date(), error: null },
        });
        return;
      }

      // Compute displaySimple for today
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const existingCount = await prisma.order.count({
        where: { companyId, createdAt: { gte: startOfDay } },
      });
      const displaySimple = existingCount + 1;

      const initialStatus = status || 'PENDENTE_ACEITE';

      const savedOrder = await prisma.order.create({
        data: {
          companyId,
          storeId: storeId || null,
          externalId,
          displayId: `#${externalId.slice(-6)}`,
          displaySimple,
          status: initialStatus,
          customerId: customerId || null,
          customerSource: 'AIQFOME',
          customerName,
          customerPhone,
          address: formattedAddress,
          deliveryNeighborhood: addr?.neighborhood_name || null,
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
          total,
          deliveryFee,
          couponDiscount,
          orderType,
          payload: order,
          items: {
            create: items.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              price: i.price,
              notes: i.notes || null,
              productId: i.productId || i._matchedProductId || null,
              options: i.options || null,
            })),
          },
          histories: {
            create: [{ from: null, to: initialStatus, reason: 'aiqfome webhook' }],
          },
        },
        include: { items: true, histories: true },
      });

      console.log('[aiqfome Processor] created order:', savedOrder.id, 'status:', initialStatus, 'externalId:', externalId);

      // Pad displaySimple for emitted object
      try {
        if (savedOrder.displaySimple != null) {
          savedOrder.displaySimple = String(savedOrder.displaySimple).padStart(2, '0');
        }
      } catch (e) { /* ignore */ }

      // Auto-accept: if enabled and status is PENDENTE_ACEITE, mark as read on aiqfome
      if (autoAccept && initialStatus === 'PENDENTE_ACEITE') {
        let acceptOk = false;
        try {
          // aiqfome API: PUT /v2/orders/{orderId}/read (or similar endpoint)
          await aiqfomePost(integrationId, `/v2/orders/${externalId}/read`, {});
          acceptOk = true;
          console.log('[aiqfome Auto-accept] marked as read on aiqfome, orderId:', externalId);
        } catch (e) {
          console.warn('[aiqfome Auto-accept] failed to mark as read:', e?.response?.status, e?.message);
        }

        if (acceptOk) {
          try {
            await prisma.order.update({
              where: { id: savedOrder.id },
              data: {
                status: 'EM_PREPARO',
                histories: {
                  create: { from: 'PENDENTE_ACEITE', to: 'EM_PREPARO', reason: 'aiqfome auto-accept' },
                },
              },
            });
            savedOrder.status = 'EM_PREPARO';
            console.log('[aiqfome Auto-accept] internal status updated to EM_PREPARO for order', savedOrder.id);
          } catch (e) {
            console.warn('[aiqfome Auto-accept] failed to update internal status:', e?.message);
          }
        }
      }

      // Emit new order event
      try {
        emitirNovoPedido(savedOrder);
        console.log('[aiqfome Processor] emitted novo-pedido for order', savedOrder.id);
      } catch (eEmit) {
        console.warn('[aiqfome Processor] emit novo-pedido failed:', eEmit?.message);
      }
    }

    // Mark webhook event as processed
    await prisma.webhookEvent.update({
      where: { id: evt.id },
      data: { status: 'PROCESSED', processedAt: new Date(), error: null },
    });
  } catch (err) {
    console.error('[aiqfome Processor] Erro ao processar evento:', err);
    await prisma.webhookEvent.update({
      where: { id: evt.id },
      data: { status: 'ERROR', error: String(err) },
    });
  }
}
