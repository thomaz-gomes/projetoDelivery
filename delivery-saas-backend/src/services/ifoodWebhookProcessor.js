// src/services/ifoodWebhookProcessor.js
import { prisma } from '../prisma.js';
import { getIFoodOrderDetails } from '../integrations/ifood/orders.js';
import { emitirNovoPedido } from '../index.js';
import { canTransition } from '../stateMachine.js';

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

  return { companyId: integ.companyId || null, storeId: integ.storeId || null };
}

/**
 * Mapeia payload do iFood → nosso Order/OrderItem
 * (ajuste conforme o formato real recebido do iFood)
 */
function mapIFoodOrder(payload) {
  const order = payload?.order || payload; // alguns provedores envelopam em "order"

  // Coordenadas (se vierem no payload)
  const coords = order?.delivery?.deliveryAddress?.coordinates || {};
  const latitude = Number(coords.latitude ?? order?.latitude ?? 0) || null;
  const longitude = Number(coords.longitude ?? order?.longitude ?? 0) || null;

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
    latitude,
    longitude,
    total,
    deliveryFee: Number(order?.total?.deliveryFee || 0) || null,
    items,
    raw: payload,
  };
}

/**
 * Determina o status interno a partir de um evento/estado iFood
 */
function determineStatusFromIFoodEvent(payload, orderObj) {
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
    return isPaymentOnline(orderObj) ? 'CONCLUIDO' : 'CONFIRMACAO_PAGAMENTO';
  }
  if (code === 'CANCELLED' || code === 'CANCEL' || code === 'CAN') return 'CANCELADO';

  return null;
}

/**
 * Upsert do pedido no nosso banco
 */
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
    address: mapped.address,
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

    return prisma.order.create({
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
      include: { items: true },
    });
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
    if (incomingStatus && incomingStatus !== currentStatus) {
      // Only set status when a valid forward transition exists
      if (canTransition(currentStatus, incomingStatus)) {
        updateData.status = incomingStatus;
        // record history entry for status change
        updateData.histories = { create: { from: currentStatus, to: incomingStatus, reason: 'iFood webhook (update)' } };
      } else {
        // Do not overwrite status; keep existing
        delete updateData.status;
      }
    } else {
      // Ensure we don't unset status unintentionally
      delete updateData.status;
    }

    const updated = await prisma.order.update({
      where: { id: exists.id },
      data: updateData,
      include: { items: true, histories: true },
    });
    return updated;
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
      // If payload contains an iFood event code, prefer mapping its status
      try {
        const inferred = determineStatusFromIFoodEvent(payload, payload.order || payload);
        if (inferred) mapped.status = inferred;
      } catch (e) { /* ignore */ }
      const saved = await upsertOrder({ companyId, mapped, storeId });

      // Emite o novo pedido ao painel (Socket.IO) para evitar necessidade de refresh
      try {
        if (saved) {
          emitirNovoPedido(saved);
        }
      } catch (eEmit) {
        console.warn('[iFood Processor] emitirNovoPedido failed:', eEmit && eEmit.message);
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