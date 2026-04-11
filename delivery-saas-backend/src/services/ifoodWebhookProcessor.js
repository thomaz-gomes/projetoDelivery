// src/services/ifoodWebhookProcessor.js
import { prisma } from '../prisma.js';
import { getIFoodOrderDetails } from '../integrations/ifood/orders.js';
import { upsertCustomerFromIfood } from '../services/customers.js';
import { emitirNovoPedido, emitirPedidoAtualizado, app } from '../index.js';
import { notifyCustomerStatus, notifyCustomerOrderSummary } from './notify.js';
import { tryEmitIfoodChat } from './ifoodChatEmitter.js';
import buildAndPersistStockMovementFromOrderItems from './stockFromOrder.js';
import { canTransition } from '../stateMachine.js';
import printQueue from '../printQueue.js'
import { matchItemsToLocalProducts } from '../utils/integrationMatcher.js'

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
  // Select includes fields reused downstream (auto-populate merchantId, autoAccept check)
  // to avoid separate queries later.
  const integ = await prisma.apiIntegration.findFirst({
    where: {
      provider: 'IFOOD',
      OR: [
        { merchantId: { in: candidates } },
        { merchantUuid: { in: candidates } }
      ]
    },
    select: { id: true, companyId: true, storeId: true, merchantId: true, merchantUuid: true, autoAccept: true },
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
        return { companyId: all[0].companyId || null, storeId: all[0].storeId || null, _integ: all[0] };
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
        if (s) return { companyId: integ.companyId || null, storeId: s.id || null, _integ: integ };
      }
      if (payloadStoreName) {
        const s2 = await prisma.store.findFirst({ where: { companyId: integ.companyId, name: payloadStoreName }, select: { id: true } });
        if (s2) return { companyId: integ.companyId || null, storeId: s2.id || null, _integ: integ };
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
  return { companyId: integ.companyId || null, storeId: resolvedStoreId, _integ: integ };
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

  // Itens — iFood sends unitPrice (per-unit) and totalPrice (unit * qty).
  // We always store the UNIT price so the frontend can multiply by quantity consistently.
  const items = (order?.items || []).map((it) => {
    const qty = Number(it?.quantity || 1)
    let unitPrice = Number(it?.unitPrice || it?.price || 0)
    // if only totalPrice is available, derive unit price
    if (!unitPrice && it?.totalPrice) unitPrice = Number(it.totalPrice) / (qty || 1)
    return {
      name: it?.name || it?.description || 'Item',
      quantity: qty,
      price: unitPrice,
      notes: it?.observations || null,
      externalCode: it?.externalCode || null,
      subItems: it?.subItems || it?.subitems || it?.garnishItems || it?.options || null,
    }
  });

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

  // Extrair desconto dos benefits do iFood (cupons/promoções do parceiro)
  let couponDiscount = 0;
  let couponCode = null;
  const benefits = order?.benefits || [];
  if (Array.isArray(benefits) && benefits.length > 0) {
    for (const b of benefits) {
      const val = Number(b.value || 0);
      if (val > 0) couponDiscount += val;
    }
    // Tentar extrair nome/código do benefício
    const firstBenefit = benefits[0];
    if (firstBenefit?.description || firstBenefit?.title) {
      couponCode = firstBenefit.description || firstBenefit.title;
    }
  }

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
    couponDiscount: couponDiscount > 0 ? couponDiscount : null,
    couponCode,
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
  // PLACED = order just arrived, NOT yet accepted — always starts as PENDENTE_ACEITE.
  // Auto-accept (when enabled) will call confirm + startPreparation and move to EM_PREPARO.
  if (code === 'PLACED') return 'PENDENTE_ACEITE';
  // CONFIRMED = merchant accepted the order on iFood — move to EM_PREPARO
  if (code === 'CONFIRMED' || code === 'CFM') return 'EM_PREPARO';
  if (code === 'DISPATCHED' || code === 'DSP') return 'SAIU_PARA_ENTREGA';
  if (code === 'CONCLUDED' || code === 'CON') {
    // iFood CONCLUDED means the order was confirmed via delivery code or system —
    // always move to CONCLUIDO regardless of payment type
    return 'CONCLUIDO';
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

  // Negotiation platform events — these are not status changes but require
  // merchant response. Return a special prefix so callers can detect them.
  if (code === 'CONSUMER_CANCELLATION_REQUESTED' || code === 'CRR') return 'NEGOTIATION:CONSUMER_CANCELLATION_REQUESTED';
  if (code === 'CONSUMER_CANCELLATION_ACCEPTED') return 'NEGOTIATION:CONSUMER_CANCELLATION_ACCEPTED';
  if (code === 'CONSUMER_CANCELLATION_DENIED') return 'NEGOTIATION:CONSUMER_CANCELLATION_DENIED';

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
    customerId: mapped.customerId || null,
    customerPhone: mapped.customerPhone,
    address: buildConcatenatedAddress(mapped.raw) || mapped.address,
    deliveryNeighborhood: (mapped.raw && (mapped.raw.delivery && mapped.raw.delivery.deliveryAddress && mapped.raw.delivery.deliveryAddress.neighborhood)) || (normalizeDeliveryAddressFromPayload(mapped.raw || {})?.neighborhood) || mapped.raw?.neighborhood || null,
    latitude: mapped.latitude,
    longitude: mapped.longitude,
    total: mapped.total,
    deliveryFee: mapped.deliveryFee,
    couponDiscount: mapped.couponDiscount || null,
    couponCode: mapped.couponCode || null,
    orderType: mapped.orderType || null,
    payload: mapped.raw,
    ...(mapped.closedByIfoodCode ? { closedByIfoodCode: true } : {}),
  };

  // If the order is linked to an existing customer and the payload contains
  // a delivery address, ensure the customer's addresses include this exact
  // address. If not present, create it and mark it as default so the
  // incoming order address will prevail for printing and views.
  try {
    if (mapped.customerId && mapped.raw) {
      const normalized = normalizeDeliveryAddressFromPayload(mapped.raw || {});
      if (normalized && (normalized.formattedAddress || normalized.streetName)) {
        // try to detect an existing customerAddress matching formatted or street+number+postalCode
        const whereOr = [];
        if (normalized.formattedAddress) whereOr.push({ formatted: normalized.formattedAddress });
        if (normalized.postalCode) whereOr.push({ postalCode: normalized.postalCode });
        if (normalized.streetName && normalized.streetNumber) whereOr.push({ AND: [{ street: normalized.streetName }, { number: normalized.streetNumber }] });

        const existsAddr = whereOr.length ? await prisma.customerAddress.findFirst({ where: { customerId: mapped.customerId, OR: whereOr } }) : null;
        if (!existsAddr) {
          // unset previous default(s) and create a new default address for this customer
          try {
            await prisma.customerAddress.updateMany({ where: { customerId: mapped.customerId, isDefault: true }, data: { isDefault: false } }).catch(() => {});
            await prisma.customerAddress.create({ data: {
              customerId: mapped.customerId,
              formatted: normalized.formattedAddress || null,
              street: normalized.streetName || null,
              number: normalized.streetNumber || null,
              complement: normalized.complement || null,
              neighborhood: normalized.neighborhood || null,
              reference: normalized.reference || null,
              observation: normalized.observation || null,
              city: normalized.city || null,
              state: normalized.state || null,
              postalCode: normalized.postalCode || null,
              country: normalized.country || null,
              latitude: normalized.latitude ?? null,
              longitude: normalized.longitude ?? null,
              isDefault: true,
            } }).catch((e) => { console.warn('[iFood Processor] failed to create customerAddress:', e && e.message); });
          } catch (e) {
            console.warn('[iFood Processor] ensure-customer-address failed:', e && e.message);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[iFood Processor] address persistence check failed:', e && e.message);
  }

  if (!exists) {
    // Do not create new orders for terminal statuses (CANCELADO, CONCLUIDO, etc.)
    // These events refer to orders that were never in our system — no point creating them.
    const terminalStatuses = ['CANCELADO', 'CONCLUIDO', 'CONFIRMACAO_PAGAMENTO'];
    if (terminalStatuses.includes(mapped.status)) {
      console.log('[iFood Processor] skipping creation of order with terminal status:', mapped.status, 'externalId:', mapped.externalId);
      return { order: null, created: false, statusChanged: false, from: null, to: null };
    }

    // compute displaySimple for today's orders for this company
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const existingCount = await prisma.order.count({ where: { companyId, createdAt: { gte: startOfDay } } });
    const displaySimple = existingCount + 1;

    const initialStatus = mapped.status || 'EM_PREPARO';
    const created = await prisma.order.create({
      data: {
        ...baseData,
        status: initialStatus,
        storeId: storeId || null,
        displaySimple,
        items: {
          create: mapped.items.map((i) => {
            const subs = i.subItems || i.subitems || i.garnishItems || []
            const options = subs.length > 0 ? subs.map(s => ({
              name: s.name,
              quantity: Number(s.quantity || 1),
              price: Number(s.unitPrice || s.price || 0) || (Number(s.totalPrice || 0) / (Number(s.quantity || 1) || 1)),
              _matchedProductId: s._matchedProductId || null,
            })) : null
            return {
              name: i.name,
              quantity: i.quantity,
              price: i.price,
              notes: i.notes || null,
              productId: i.productId || i._matchedProductId || null,
              options: options,
            }
          }),
        },
        histories: {
          create: [{ from: null, to: initialStatus, reason: 'iFood webhook' }],
        },
      },
      include: { items: true, histories: true },
    });
    return { order: created, created: true, statusChanged: true, from: null, to: initialStatus };
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

    // If items have matched integration codes, replace existing items
    const hasMatchedItems = mapped.items && mapped.items.some(i => i._matchedProductId || i.productId)
    if (hasMatchedItems) {
      await prisma.orderItem.deleteMany({ where: { orderId: exists.id } })
      updateData.items = {
        create: mapped.items.map(i => {
          const subs = i.subItems || i.subitems || i.garnishItems || []
          const options = subs.length > 0 ? subs.map(s => ({
            name: s.name,
            quantity: Number(s.quantity || 1),
            price: Number(s.unitPrice || s.price || 0) || (Number(s.totalPrice || 0) / (Number(s.quantity || 1) || 1)),
            _matchedProductId: s._matchedProductId || null,
          })) : null
          return {
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            notes: i.notes || null,
            productId: i.productId || i._matchedProductId || null,
            options: options,
          }
        })
      }
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
  // Skip events that were already successfully processed (prevents re-emit on ACK failure + re-poll)
  if (evt.status === 'PROCESSED') {
    console.log('[iFood Processor] skipping already-processed event', eventId, 'eventId:', evt.eventId);
    return;
  }

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

      // Reuse the integration record fetched by resolveCompanyIdFromPayload
      // (already includes id, merchantId, merchantUuid, autoAccept — no extra query needed)
      const cachedInteg = resolved._integ || null;

      // Auto-populate merchantId on the integration if missing (fixes x-polling-merchants warning)
      try {
        const payloadMerchantId = payload?.merchantId || payload?.order?.merchant?.id || null;
        if (payloadMerchantId && cachedInteg && !cachedInteg.merchantId && !cachedInteg.merchantUuid) {
          await prisma.apiIntegration.update({
            where: { id: cachedInteg.id },
            data: { merchantId: String(payloadMerchantId) },
          });
          console.log('[iFood Processor] auto-populated merchantId:', payloadMerchantId);
        }
      } catch (e) { /* non-fatal */ }

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

      // Upsert customer from payload so we link orders to customers
      try {
        const orderForCustomer = payload?.order || payload;
        const up = await upsertCustomerFromIfood({ companyId, payload: orderForCustomer });
        if (up && up.customer) {
          try {
            payload._upsertedCustomer = { id: up.customer.id, whatsapp: up.customer.whatsapp || up.customer.phone, fullName: up.customer.fullName };
            console.log('[iFood Processor] upsertCustomerFromIfood created/found customer:', payload._upsertedCustomer);
          } catch (e) {}
        }
      } catch (e) {
        console.warn('[iFood Processor] upsertCustomerFromIfood failed:', e?.message || e);
      }

      // Mapeia e upsert (propaga storeId quando disponível)
      const mapped = mapIFoodOrder(payload);
      // if we persisted a customer on payload, copy it to mapped so upsertOrder links it
      try { if (payload && payload._upsertedCustomer && payload._upsertedCustomer.id) mapped.customerId = payload._upsertedCustomer.id; } catch(e){}
      // If we upserted/located a customer and that customer has a whatsapp stored,
      // prefer using that whatsapp as the order contact so customer notifications
      // are delivered to the stored WhatsApp number rather than a temporary
      // channel-provided phone.
      try {
        if (mapped.customerId && payload && payload._upsertedCustomer && payload._upsertedCustomer.whatsapp) {
          mapped.customerPhone = payload._upsertedCustomer.whatsapp;
        }
      } catch (e) { /* non-fatal */ }
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
      // Enrich payment method labels using company's iFood payment mappings
      try {
        const { resolveIfoodPaymentLabel } = await import('../routes/integrations.js');
        const ifoodPay = (payload.order || payload)?.payments;
        const methods = ifoodPay?.methods || [];
        if (methods.length > 0) {
          for (const m of methods) {
            const label = await resolveIfoodPaymentLabel(companyId, m.method, m.card?.brand);
            if (label) m._systemLabel = label;
          }
        }
      } catch (e) { /* non-fatal */ }

      // If payload contains an iFood event code, prefer mapping its status
      let inferred = null;
      try {
        const codeRaw = payload && (payload.fullCode || payload.code || (payload.order && (payload.order.fullCode || payload.order.code)));
        const eventCode = codeRaw ? String(codeRaw).toUpperCase() : null;
        inferred = determineStatusFromIFoodEvent(payload, payload.order || payload);

        // Negotiation platform events: emit to frontend and mark processed, but do NOT change order status
        if (inferred && String(inferred).startsWith('NEGOTIATION:')) {
          const negotiationType = inferred.replace('NEGOTIATION:', '');
          const orderId = payload?.orderId || payload?.order?.id || payload?.id || null;
          console.log('[iFood Processor] negotiation event:', negotiationType, 'orderId:', orderId);

          // Find the local order to attach the negotiation event
          let localOrder = null;
          if (orderId) {
            localOrder = await prisma.order.findUnique({ where: { externalId: orderId } });
          }

          // Emit negotiation event to frontend via Socket.IO
          try {
            const io = app && app.locals && app.locals.io;
            if (io) {
              io.to(`company:${companyId}`).emit('ifood-negotiation', {
                type: negotiationType,
                orderId: localOrder?.id || null,
                externalId: orderId,
                displayId: localOrder?.displayId || payload?.order?.displayId || null,
                payload: payload,
                companyId,
              });
              console.log('[iFood Processor] emitted ifood-negotiation to company room:', companyId);
            }
          } catch (eEmit) {
            console.warn('[iFood Processor] failed to emit negotiation event:', eEmit?.message);
          }

          // Mark webhook event as processed
          await prisma.webhookEvent.update({
            where: { id: evt.id },
            data: { status: 'PROCESSED', processedAt: new Date(), error: null },
          });
          return;
        }

        if (inferred) mapped.status = inferred;
        // Track when iFood sends the CONCLUDED event so we know the order was
        // closed via iFood confirmation code (as opposed to manual rider completion).
        if (eventCode === 'CONCLUDED' || eventCode === 'CON') {
          mapped.closedByIfoodCode = true;
        }
        console.log('[iFood Processor] eventCode:', eventCode, '-> inferred status:', inferred, 'mapped.status:', mapped.status);
      } catch (e) {
        console.warn('[iFood Processor] failed to infer status from payload:', e?.message || e);
      }

      // Match integration items to local products by integrationCode
      // Local product name replaces integration name; price kept from integration
      // Called ONCE — result reused for both mapped.items and raw payload items
      try {
        if (mapped.items && mapped.items.length > 0) {
          const matchedItems = await matchItemsToLocalProducts(mapped.items, companyId)
          mapped.items = matchedItems.map(it => ({
            ...it,
            productId: it._matchedProductId || null,
          }))
          // Propagate matched names to raw payload for print agent using lookup (no extra DB call)
          const rawItems = mapped.raw?.order?.items || mapped.raw?.items || null
          if (rawItems) {
            const matchedByCode = new Map()
            for (const mi of matchedItems) {
              const code = mi.externalCode || mi.externalId || mi.sku || mi.productId || null
              if (code) matchedByCode.set(String(code), mi)
            }
            const matchedRaw = rawItems.map(ri => {
              const code = ri.externalCode || ri.externalId || ri.sku || ri.productId || null
              const match = code ? matchedByCode.get(String(code)) : null
              const result = match ? { ...ri, name: match.name, _matchedProductId: match._matchedProductId } : { ...ri }
              const subs = ri.subItems || ri.subitems || ri.garnishItems || ri.options || []
              if (subs.length > 0) {
                const matchedSubs = match?.subItems || match?.subitems || match?.garnishItems || match?.options || []
                if (matchedSubs.length > 0) {
                  const subKey = ri.subItems ? 'subItems' : ri.subitems ? 'subitems' : ri.garnishItems ? 'garnishItems' : 'options'
                  result[subKey] = subs.map((sub, idx) => {
                    const ms = matchedSubs[idx]
                    return ms ? { ...sub, name: ms.name || sub.name, _matchedProductId: ms._matchedProductId || null } : sub
                  })
                }
              }
              return result
            })
            if (mapped.raw.order && mapped.raw.order.items) mapped.raw.order.items = matchedRaw
            else if (mapped.raw.items) mapped.raw.items = matchedRaw
          }
        }
      } catch (e) {
        console.warn('[iFood Processor] integration code matching failed (continuing):', e?.message || e)
      }

      // Check autoAccept setting (reuses cachedInteg fetched earlier)
      const autoAcceptEnabled = !!(cachedInteg && cachedInteg.autoAccept);

      // PLACED always maps to PENDENTE_ACEITE (order not yet accepted on iFood).
      // The status stays PENDENTE_ACEITE for upsert — auto-accept will promote to EM_PREPARO after confirming on iFood.

      const res = await upsertOrder({ companyId, mapped, storeId });
      const savedOrder = res && res.order ? res.order : res;

      // If upsertOrder skipped creation (e.g. terminal status for non-existing order), mark as processed and return
      if (!savedOrder || !savedOrder.id) {
        await prisma.webhookEvent.update({ where: { id: evt.id }, data: { status: 'PROCESSED', processedAt: new Date(), error: null } });
        return;
      }

      // Auto-accept on iFood: if enabled and order is PENDENTE_ACEITE (just placed),
      // call confirm + startPreparation on iFood API, then update internal status to EM_PREPARO
      console.log('[iFood Auto-accept] check:', { autoAcceptEnabled, orderStatus: savedOrder.status, externalId: savedOrder.externalId, created: res.created });
      if (autoAcceptEnabled && savedOrder.status === 'PENDENTE_ACEITE' && savedOrder.externalId) {
        let confirmOk = false;
        try {
          const { getIFoodAccessToken } = await import('../integrations/ifood/oauth.js');
          const token = await getIFoodAccessToken(cachedInteg?.id ? { integrationId: cachedInteg.id } : companyId);
          console.log('[iFood Auto-accept] token obtained, length:', token ? token.length : 0);
          const { default: axios } = await import('axios');
          const baseUrl = (process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br').replace(/\/+$/, '');
          const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
          const oid = encodeURIComponent(savedOrder.externalId);
          try {
            const r1 = await axios.post(`${baseUrl}/order/v1.0/orders/${oid}/confirm`, {}, { headers, timeout: 15000 });
            console.log('[iFood Auto-accept] confirm OK, status:', r1.status);
            confirmOk = true;
          } catch (e) { console.warn('[iFood Auto-accept] confirm failed:', e?.response?.status, JSON.stringify(e?.response?.data)); }
          if (confirmOk) {
            try {
              const r2 = await axios.post(`${baseUrl}/order/v1.0/orders/${oid}/startPreparation`, {}, { headers, timeout: 15000 });
              console.log('[iFood Auto-accept] startPreparation OK, status:', r2.status);
            } catch (e) { console.warn('[iFood Auto-accept] startPreparation failed:', e?.response?.status, JSON.stringify(e?.response?.data)); }
          }
        } catch (e) {
          console.error('[iFood Auto-accept] exception:', e?.message);
        }

        // After successful confirm, update internal status to EM_PREPARO
        if (confirmOk) {
          try {
            const freshOrder = await prisma.order.update({
              where: { id: savedOrder.id },
              data: {
                status: 'EM_PREPARO',
                histories: { create: { from: 'PENDENTE_ACEITE', to: 'EM_PREPARO', reason: 'iFood auto-accept' } },
              },
              include: { items: true, histories: true, rider: true },
            });
            // Replace savedOrder reference so socket emit uses the updated object
            Object.assign(savedOrder, freshOrder);
            console.log('[iFood Auto-accept] internal status updated to EM_PREPARO for order', savedOrder.id);
          } catch (e) {
            console.warn('[iFood Auto-accept] failed to update internal status:', e?.message);
          }
        }
      }

      // attempt to decrement stock for items that reference technical sheets (best-effort)
      try {
        await buildAndPersistStockMovementFromOrderItems(prisma, savedOrder);
      } catch (e) {
        console.warn('[iFood Processor] failed to create stock movement for order', savedOrder && savedOrder.id, e && e.message);
      }

      // Emit socket events depending on create vs update
      try {
        if (res && res.created) {
          console.log('[iFood Processor] emitting novo-pedido for created order', savedOrder && savedOrder.id, 'status:', savedOrder && savedOrder.status);
          emitirNovoPedido(savedOrder);
          // Send iFood chat message for new order (e.g. CONFIRMED after auto-accept)
          // Extension handles missing conversations by opening chat via order card details
          tryEmitIfoodChat(savedOrder, savedOrder.status).catch(() => {});
          // Notify customer with order summary on new orders
          try { await notifyCustomerOrderSummary(savedOrder.id); } catch (e) { console.warn('[iFood Processor] notifyCustomerOrderSummary failed', e && e.message); }
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
          tryEmitIfoodChat(savedOrder, res.to).catch(() => {});
          // Notify customer about status change for relevant statuses
          try { await notifyCustomerStatus(savedOrder.id, res.to); } catch (e) { console.warn('[iFood Processor] notifyCustomerStatus failed', e && e.message); }

          // When iFood webhook moves order to CONCLUIDO, run financial completion triggers
          if (res.to === 'CONCLUIDO') {
            try {
              const { createFinancialEntriesForOrder } = await import('./financial/orderFinancialBridge.js');
              await createFinancialEntriesForOrder(savedOrder);
            } catch (e) { console.error('[iFood Processor] financial entries error:', e?.message); }

            // Rider account credit
            try {
              if (savedOrder.riderId) {
                const riderAccountService = await import('./riderAccountService.js').then(m => m.default || m);
                await riderAccountService.addDeliveryAndDailyIfNeeded({ companyId, riderId: savedOrder.riderId, orderId: savedOrder.id, orderDate: savedOrder.updatedAt || new Date() });
              }
            } catch (e) { console.error('[iFood Processor] rider credit error:', e?.message); }

            // Cash session link
            try {
              const { findMatchingSession } = await import('./cash/sessionMatcher.js');
              const session = await findMatchingSession(savedOrder, null);
              if (session) await prisma.order.update({ where: { id: savedOrder.id }, data: { cashSessionId: session.id, outOfSession: false } });
              else await prisma.order.update({ where: { id: savedOrder.id }, data: { outOfSession: true } });
            } catch (e) { console.error('[iFood Processor] session link error:', e?.message); }

            // Affiliate tracking
            try {
              const { trackAffiliateSale } = await import('../routes/orders.js').catch(() => ({}));
              if (trackAffiliateSale) {
                const c = await prisma.affiliateSale.count({ where: { orderId: savedOrder.id } });
                if (c === 0) await trackAffiliateSale(savedOrder, companyId);
              }
            } catch (e) {}
          }
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