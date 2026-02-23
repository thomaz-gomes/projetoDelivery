// src/services/ifoodWebhookProcessor.js
import { prisma } from '../prisma.js';
import { getIFoodOrderDetails } from '../integrations/ifood/orders.js';
import { emitirNovoPedido, emitirPedidoAtualizado, app } from '../index.js';
import buildAndPersistStockMovementFromOrderItems from './stockFromOrder.js';
import { canTransition } from '../stateMachine.js';
import printQueue from '../printQueue.js'

/**
 * Extrai companyId a partir do merchantId do payload
 * (assumindo que você salvou merchantId em ApiIntegration)
 */
async function resolveCompanyIdFromPayload(payload) {
  const merchantIdRaw =
    payload?.merchantId ||
    payload?.merchant?.id ||
    payload?.order?.merchant?.id ||
    payload?.storeId ||
    null;

  if (!merchantIdRaw) return null;

  // Normalize candidate keys to improve matching (uuid with/without dashes, trimmed)
  const cand = String(merchantIdRaw).trim();
  const noDashes = cand.replace(/-/g, '');
  const candidates = Array.from(new Set([cand, noDashes]));

  // Try matching merchantId against both merchantId and merchantUuid fields using normalized candidates
  const integ = await prisma.apiIntegration.findFirst({
    where: {
      provider: 'IFOOD',
      OR: [
        { merchantId: { in: candidates } },
        { merchantUuid: { in: candidates } }
      ]
    },
    select: { companyId: true, storeId: true },
  });

  if (integ) {
    console.log('[iFood Processor] matched integration by merchant id/uuid:', cand, '-> companyId', integ.companyId);
  }

  // if not found, try fallback: if there is only one IFOOD integration in the system, assume events belong to it
  if (!integ) {
    try {
      const all = await prisma.apiIntegration.findMany({ where: { provider: 'IFOOD' } });
      if (all && all.length === 1) {
        console.warn('[iFood Processor] fallback: only one IFOOD integration found; assigning companyId', all[0].companyId);
        return { companyId: all[0].companyId || null, storeId: all[0].storeId || null };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // If integration exists but storeId not set, attempt to infer from payload store info
  if (!integ.storeId) {
    try {
      const payloadStoreId = payload?.storeId || payload?.store?.id || null;
      const payloadStoreName = payload?.store?.name || null;
      if (payloadStoreId) {
        const s = await prisma.store.findFirst({ where: { companyId: integ.companyId, OR: [{ id: payloadStoreId }, { slug: payloadStoreId }, { cnpj: payloadStoreId }] }, select: { id: true } });
        if (s) return { companyId: integ.companyId || null, storeId: s.id || null };
      }
      if (payloadStoreName) {
        const s2 = await prisma.store.findFirst({ where: { companyId: integ.companyId, name: payloadStoreName }, select: { id: true } });
        if (s2) return { companyId: integ.companyId || null, storeId: s2.id || null };
      }
    } catch (e) {
      console.warn('Failed to infer storeId from payload in iFood webhook processor:', e?.message || e);
    }
  }

  // Fallback: use first store of the company so all orders have a storeId
  let resolvedStoreId = integ.storeId || null;
  if (!resolvedStoreId) {
    try {
      const firstStore = await prisma.store.findFirst({ where: { companyId: integ.companyId }, select: { id: true }, orderBy: { createdAt: 'asc' } });
      resolvedStoreId = firstStore?.id || null;
      if (resolvedStoreId) console.log('iFood webhook processor: sem storeId na integração, usando primeira loja:', resolvedStoreId);
    } catch (e) { /* ignore */ }
  }
  return { companyId: integ.companyId || null, storeId: resolvedStoreId };
}

/**
 * Mapeia payload do iFood → nosso Order/OrderItem
 * (ajuste conforme o formato real recebido do iFood)
 */
function mapIFoodOrder(payload) {
  const order = payload?.order || payload; // alguns provedores envelopam em "order"

  // Coordenadas (se vierem no payload). Support multiple possible key names
  const coords = order?.delivery?.deliveryAddress?.coordinates || order?.delivery?.deliveryAddress || order?.delivery || order || {};
  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const latitude = toNum(coords.latitude ?? coords.lat ?? order?.latitude ?? order?.delivery?.latitude ?? null);
  const longitude = toNum(coords.longitude ?? coords.lng ?? coords.lon ?? order?.longitude ?? order?.delivery?.longitude ?? null);

  // Endereço formatado
  const addr = order?.delivery?.deliveryAddress || {};
  const formattedAddress =
    addr.formattedAddress ||
    [addr.streetName, addr.streetNumber, addr.neighborhood]
      .filter(Boolean)
      .join(', ') ||
    null;

  // Total
  const total =
    Number(order?.total?.orderAmount) ||
    Number(order?.total) ||
    0;

  // Itens
  const items = (order?.items || []).map((it) => ({
    name: it?.name || it?.description || 'Item',
    quantity: Number(it?.quantity || 1),
    price: Number(it?.price || it?.unitPrice || 0),
    notes: it?.observations || null,
  }));

  // Cliente
  const customer = order?.customer || {};
  const customerName =
    customer?.name ||
    [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') ||
    null;
  const customerPhone = customer?.phone?.number || customer?.phone || null;

  // iFood event payloads sometimes include `orderId` (real order identifier) alongside the event `id`.
  // Prefer explicit `orderId` or nested `order.id`/`referenceId` over the event `id` to avoid mixing event vs order identifiers.
  const externalId = payload?.orderId || order?.id || order?.referenceId || null;

  return {
    externalId,
    displayId: order?.displayId || order?.shortCode || null,
    status: 'EM_PREPARO', // default ao entrar; você pode mapear status do iFood
    customerName,
    customerPhone,
    address: formattedAddress,
    orderType: (order && (order.orderType || order.type)) || null,
    latitude,
    longitude,
    total,
    deliveryFee: Number(order?.total?.deliveryFee || 0) || null,
    items,
    // payment troco (changeFor) extraction — prefer payments.methods[*].changeFor (iFood)
    payment: (function(){
      try {
        const p = order?.payments || order?.payment || null;
        const methods = p && Array.isArray(p.methods) ? p.methods : (Array.isArray(p) ? p : null);
        let cand = null;
        if (methods && methods.length) {
          cand = methods.find(m => String(m.method || m.type || '').toUpperCase().includes('CASH')) || methods[0];
        }
        if (cand) {
          // support nested cash.changeFor (iFood samples use payments.methods[].cash.changeFor)
          let changeFor = null;
          if (cand.changeFor != null) changeFor = Number(cand.changeFor);
          else if (cand.change_for != null) changeFor = Number(cand.change_for);
          else if (cand.cash && (cand.cash.changeFor != null || cand.cash.change_for != null)) changeFor = Number(cand.cash.changeFor ?? cand.cash.change_for);
          const amount = (cand.value != null ? Number(cand.value) : (cand.amount != null ? Number(cand.amount) : null));
          return { method: cand.method || cand.type || null, changeFor: !Number.isNaN(changeFor) ? changeFor : null, amount: !Number.isNaN(amount) ? amount : null };
        }
      } catch (e) {}
      return null;
    })(),
    raw: payload,
  };
}

/**
 * Determina o status interno a partir de um evento/estado iFood
 */
export function determineStatusFromIFoodEvent(payload, orderObj) {
  const code = (payload && (payload.fullCode || payload.code || payload.name)) ? String(payload.fullCode || payload.code || payload.name).toUpperCase() : null;
  if (!code) return null;

  // helper to detect payment online
  function isPaymentOnline(o) {
    try {
      if (!o) return false;
      const pm = o.payment || o.payments || o.paymentMethod || null;
      if (pm) {
        if (Array.isArray(pm)) return pm.some(p => String(p.method || p.methodCode || '').toUpperCase().includes('ONLINE'));
        return String(pm.method || pm.methodCode || '').toUpperCase().includes('ONLINE');
      }
      // try nested payload structures
      if (o.payload && o.payload.paymentConfirmed) return false;
      return false;
    } catch (e) { return false; }
  }

  // Delivery mappings
  if (code === 'PLACED') return 'EM_PREPARO';
  if (code === 'DISPATCHED' || code === 'DSP') return 'SAIU_PARA_ENTREGA';
  if (code === 'CONCLUDED' || code === 'CON') {
    // if payment is ONLINE -> mark as CONCLUIDO directly, otherwise confirmation step
    return isPaymentOnline(orderObj) ? 'CONCLUIDO' : 'CONFIRMACAO_PAGAMENTO';
  }
  if (code === 'READY_TO_PICKUP' || code === 'RTP') {
    // If this is a TAKEOUT/PICKUP order, READY_TO_PICKUP means the order is
    // ready for pickup (map to internal 'PRONTO'). For delivery flows, keep
    // previous behavior regarding payment confirmation / conclusion.
    try {
      const ot = orderObj && (orderObj.orderType || orderObj.type || (orderObj.payload && (orderObj.payload.orderType || orderObj.payload.type)));
      const upto = ot ? String(ot).toUpperCase() : null;
      if (upto === 'TAKEOUT' || upto === 'PICKUP' || upto === 'TAKE-OUT' || upto === 'PICK-UP') return 'PRONTO';
    } catch (e) {}
    return isPaymentOnline(orderObj) ? 'CONCLUIDO' : 'CONFIRMACAO_PAGAMENTO';
  }
  if (code === 'CANCELLED' || code === 'CANCEL' || code === 'CAN') return 'CANCELADO';

  return null;
}

/**
 * Upsert do pedido no nosso banco
 */
import { buildConcatenatedAddress, normalizeDeliveryAddressFromPayload } from './customers.js';

async function upsertOrder({ companyId, mapped, storeId = null }) {
  const exists = mapped.externalId
    ? await prisma.order.findUnique({ where: { externalId: mapped.externalId } })
    : null;

  const baseData = {
    companyId,
    externalId: mapped.externalId,
    displayId: mapped.displayId,
    status: mapped.status,
    customerName: mapped.customerName,
    customerPhone: mapped.customerPhone,
    address: buildConcatenatedAddress(mapped.raw) || mapped.address,
    deliveryNeighborhood: (mapped.raw && (mapped.raw.delivery && mapped.raw.delivery.deliveryAddress && mapped.raw.delivery.deliveryAddress.neighborhood)) || (normalizeDeliveryAddressFromPayload(mapped.raw || {})?.neighborhood) || mapped.raw?.neighborhood || null,
    latitude: mapped.latitude,
    longitude: mapped.longitude,
    total: mapped.total,
    deliveryFee: mapped.deliveryFee,
    payload: mapped.raw,
  };

  if (!exists) {
    // compute displaySimple for today's orders for this company
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const existingCount = await prisma.order.count({ where: { companyId, createdAt: { gte: startOfDay } } });
    const displaySimple = existingCount + 1;

    const created = await prisma.order.create({
      data: {
        ...baseData,
        storeId: storeId || null,
        displaySimple,
        items: {
          create: mapped.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            notes: i.notes || null,
          })),
        },
        histories: {
          create: [{ from: null, to: 'EM_PREPARO', reason: 'iFood webhook' }],
        },
      },
      include: { items: true, histories: true },
    });
    return { order: created, created: true, statusChanged: true, from: null, to: 'EM_PREPARO' };
  }

  // se já existe, atualizamos campos principais — mas NÃO sobrescrevemos o
  // status indiscriminadamente. Apenas altere o status se a transição for
  // permitida pelo `canTransition` centralizado (evita regressões como quando
  // um evento PLACED é reprocessado após o pedido já ter sido concluído).
  try {
    const updateData = Object.assign({}, baseData);
    // Determine whether we should change the status
    const incomingStatus = mapped.status || null;
    const currentStatus = exists.status || null;
    let statusChanged = false;
    let from = null;
    let to = null;
    if (incomingStatus && incomingStatus !== currentStatus) {
      if (canTransition(currentStatus, incomingStatus)) {
        updateData.status = incomingStatus;
        updateData.histories = { create: { from: currentStatus, to: incomingStatus, reason: 'iFood webhook (update)' } };
        statusChanged = true;
        from = currentStatus;
        to = incomingStatus;
        console.log('[iFood Processor] status change allowed:', exists.id, currentStatus, '->', incomingStatus);
      } else {
        console.warn('[iFood Processor] status transition NOT allowed:', exists.id, currentStatus, '->', incomingStatus);
        delete updateData.status;
      }
    } else {
      delete updateData.status;
    }

    const updated = await prisma.order.update({
      where: { id: exists.id },
      data: updateData,
      include: { items: true, histories: true },
    });
    return { order: updated, created: false, statusChanged, from, to };
  } catch (e) {
    // Fallback: if update fails, log and rethrow
    console.error('[iFood Processor] failed to update existing order:', e?.message || e);
    throw e;
  }
}

/**
 * Processa o evento salvo em WebhookEvent
 */
export async function processIFoodWebhook(eventId) {
  const evt = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!evt) return;

  try {
    const payload = evt.payload;
    // debug: if we can't resolve company, log a compact sample to help mapping
    const compact = (p) => {
      try { return JSON.stringify(p && (p.order || p).id ? { id: (p.order||p).id } : Object.keys(p).slice(0,6)); } catch(e){ return String(p).slice(0,200) }
    }

      // Descobre empresa + storeId
      const resolved = await resolveCompanyIdFromPayload(payload);
      if (!resolved || !resolved.companyId) {
        console.error('[iFood Processor] falha ao resolver companyId para payload (compact):', compact(payload));
        try {
          const full = JSON.stringify(payload, null, 2).slice(0, 2000);
          console.error('[iFood Processor] payload (truncated 2000 chars):', full);
        } catch (e) {}
        throw new Error('Não foi possível determinar companyId a partir do payload (merchantId ausente).');
      }
      const { companyId, storeId } = resolved;

      // If payload lacks full order details but has an orderId, try fetching full details
      const orderId = payload?.orderId || payload?.order?.id || payload?.id || null;
      if (!payload?.order && orderId) {
        try {
          const details = await getIFoodOrderDetails(companyId, orderId);
          if (details) {
            // persist fetched details into webhookEvent payload for future debugging
            const merged = { ...payload, order: details };
            await prisma.webhookEvent.update({ where: { id: evt.id }, data: { payload: merged } });
            // replace payload variable so mapping uses fetched order
            payload.order = details;
          }
        } catch (e) {
          console.warn('[iFood Processor] failed to fetch order details for', orderId, e?.message || e);
        }
      }

      // If this is a PLACED event and we already have an order with the same external id, skip processing.
      try {
        const codeRaw = payload && (payload.fullCode || payload.code || (payload.order && (payload.order.fullCode || payload.order.code)));
        const eventCode = codeRaw ? String(codeRaw).toUpperCase() : null;
        const resolvedOrderId = payload?.orderId || payload?.order?.id || payload?.id || null;
        if (eventCode === 'PLACED' && resolvedOrderId) {
          const existingOrder = await prisma.order.findUnique({ where: { externalId: resolvedOrderId } });
          if (existingOrder) {
            // mark event as processed and skip creating a duplicate
            await prisma.webhookEvent.update({ where: { id: evt.id }, data: { status: 'PROCESSED', processedAt: new Date(), error: null } });
            console.log('[iFood Processor] duplicate PLACED event ignored for order', resolvedOrderId, 'webhookEventId', evt.id);
            return;
          }
        }
      } catch (e) {
        // if the dedupe check fails, continue processing the event normally
        console.warn('[iFood Processor] dedupe check failed (continuing):', e?.message || e);
      }

      // Mapeia e upsert (propaga storeId quando disponível)
      const mapped = mapIFoodOrder(payload);
      // Persist extracted payment info (troco) inside payload JSON so it's stored
      try {
        if (mapped && mapped.payment) {
          mapped.raw = mapped.raw || {};
          // Persist under a safe, non-conflicting key for debugging
          mapped.raw._extractedPayment = mapped.payment;
          // Also ensure frontend-friendly shape exists so PDV views find troco at payload.payment.changeFor
          mapped.raw.payment = mapped.raw.payment || mapped.payment;
        }
      } catch (e) { /* non-fatal */ }
      // If payload contains an iFood event code, prefer mapping its status
      let inferred = null;
      try {
        const codeRaw = payload && (payload.fullCode || payload.code || (payload.order && (payload.order.fullCode || payload.order.code)));
        const eventCode = codeRaw ? String(codeRaw).toUpperCase() : null;
        inferred = determineStatusFromIFoodEvent(payload, payload.order || payload);
        if (inferred) mapped.status = inferred;
        console.log('[iFood Processor] eventCode:', eventCode, '-> inferred status:', inferred, 'mapped.status:', mapped.status);
      } catch (e) {
        console.warn('[iFood Processor] failed to infer status from payload:', e?.message || e);
      }

      const res = await upsertOrder({ companyId, mapped, storeId });
      const savedOrder = res && res.order ? res.order : res;

      // attempt to decrement stock for items that reference technical sheets (best-effort)
      try {
        await buildAndPersistStockMovementFromOrderItems(prisma, savedOrder);
      } catch (e) {
        console.warn('[iFood Processor] failed to create stock movement for order', savedOrder && savedOrder.id, e && e.message);
      }

      // Emit socket events depending on create vs update
      try {
        if (res && res.created) {
          console.log('[iFood Processor] emitting novo-pedido for created order', savedOrder && savedOrder.id);
          emitirNovoPedido(savedOrder);
          // Auto-print: if enabled, enqueue and attempt immediate delivery to connected agents
          try {
            const ENABLE_AUTO_PRINT = String(process.env.ENABLE_AUTO_PRINT || '').toLowerCase() === '1';
            if (ENABLE_AUTO_PRINT) {
              try {
                const queued = printQueue.enqueue({ order: savedOrder, storeId: savedOrder.storeId || null });
                console.log('[iFood Processor] Auto-print: job enqueued', queued.id);
                const io = app && app.locals && app.locals.io;
                if (io) {
                  // try storeId first
                  const toTry = savedOrder.storeId ? [savedOrder.storeId] : (function(){
                    const hs = new Set();
                    Array.from(io.sockets.sockets.values()).forEach(s => {
                      try {
                        const ha = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
                        const handshakeStoreIds = ha ? (Array.isArray(ha.storeIds) ? ha.storeIds : (ha.storeId ? [ha.storeId] : null)) : null;
                        if (Array.isArray(handshakeStoreIds)) handshakeStoreIds.forEach(id => hs.add(id));
                      } catch(e) {}
                    });
                    return Array.from(hs).length ? Array.from(hs) : null;
                  })();
                  if (toTry && toTry.length) {
                    try {
                      const r = await printQueue.processForStores(io, toTry);
                      if (r && r.ok) console.log('[iFood Processor] Auto-print: processed queue results:', r.results);
                    } catch (e) { console.warn('[iFood Processor] Auto-print: processForStores failed', e && e.message); }
                  }
                }
              } catch (e) { console.warn('[iFood Processor] Auto-print enqueue failed', e && e.message); }
            }
          } catch (e) { /* ignore auto-print errors */ }
        } else if (res && res.statusChanged) {
          console.log('[iFood Processor] status changed by webhook:', res.from, '->', res.to, 'orderId:', savedOrder && savedOrder.id);
          emitirPedidoAtualizado(savedOrder);
        } else {
          // No status change; still optionally emit a generic update for visibility
          console.log('[iFood Processor] no status change for order', savedOrder && savedOrder.id, 'current status:', savedOrder && savedOrder.status);
        }
      } catch (eEmit) {
        console.warn('[iFood Processor] emitir socket event failed:', eEmit && eEmit.message);
      }

    // Marca como processado (limpa eventual erro anterior)
    await prisma.webhookEvent.update({
      where: { id: evt.id },
      data: { status: 'PROCESSED', processedAt: new Date(), error: null },
    });
  } catch (err) {
    console.error('Erro ao processar evento iFood:', err);
    await prisma.webhookEvent.update({
      where: { id: evt.id },
      data: { status: 'ERROR', error: String(err) },
    });
  }
}