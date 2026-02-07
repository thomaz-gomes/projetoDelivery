import express from 'express';
import { prisma } from '../prisma.js';
// Note: avoid static import of index.js to prevent circular dependency with index.js
// When we need to emit socket events, use dynamic import inside async handlers:
// const { emitirPedidoAtualizado } = await import('../index.js');
import { authMiddleware, requireRole } from '../auth.js';
import { upsertCustomerFromIfood, findOrCreateCustomer, normalizeDeliveryAddressFromPayload, buildConcatenatedAddress } from '../services/customers.js';
import { trackAffiliateSale } from '../services/affiliates.js';
import * as cashbackSvc from '../services/cashback.js';
import { canTransition } from '../stateMachine.js';
import { notifyRiderAssigned, notifyCustomerStatus } from '../services/notify.js';
import riderAccountService from '../services/riderAccount.js';
import { buildAndPersistStockMovementFromOrderItems } from '../services/stockFromOrder.js';

export const ordersRouter = express.Router();

ordersRouter.use(authMiddleware);

ordersRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  const status = req.query.status;
  const where = { companyId };
  if (status) where.status = status;

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { items: true, rider: true, histories: true, store: true, company: true, customer: { include: { addresses: true } } }
  });

  // compute a daily sequential visual id (displaySimple) per order date
  try {
    // If all orders already have a persisted numeric displaySimple, use it (format as 2-digit string).
    const allHavePersisted = orders.every((o) => o.displaySimple !== null && o.displaySimple !== undefined);
    if (allHavePersisted) {
      for (const o of orders) {
        o.displaySimple = String(o.displaySimple).padStart(2, '0');
      }
    } else {
      // Some orders lack persisted displaySimple. For stability we compute each missing
      // displaySimple based on the count of orders created up to that order on the same day
      // (this ensures the visual number does not depend on the filtered set returned).
      try {
        await Promise.all(orders.map(async (o) => {
          if (o.displaySimple != null) {
            o.displaySimple = String(o.displaySimple).padStart(2, '0');
            return;
          }
          const d = new Date(o.createdAt || o.updatedAt || Date.now());
          const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          const count = await prisma.order.count({ where: { companyId: o.companyId, createdAt: { gte: startOfDay, lte: d } } });
          o.displaySimple = String(count).padStart(2, '0');
        }));
      } catch (e) {
        console.warn('Failed to compute displaySimple for orders list (fallback to in-memory sequence)', e?.message || e);
        // fallback: assign sequential numbers by createdAt order (best-effort)
        const sorted = [...orders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const seqMap = new Map(); // key = yyyy-mm-dd, value = counter
        for (const o of sorted) {
          const d = new Date(o.createdAt || o.updatedAt || Date.now());
          const key = d.toISOString().slice(0, 10); // yyyy-mm-dd
          const cur = seqMap.get(key) || 0;
          const next = cur + 1;
          seqMap.set(key, next);
          o.displaySimple = String(next).padStart(2, '0');
        }
      }
    }
  } catch (e) {
    console.warn('Failed to compute displaySimple for orders list', e?.message || e);
  }

  return res.json(orders);
});

// POST atribuir entregador manualmente
// allow ADMIN and store-level users to assign riders
ordersRouter.post('/:id/assign', requireRole('ADMIN','STORE'), async (req, res) => {
  const { id } = req.params;
  const { riderId, riderPhone, alsoSetStatus } = req.body || {};
  if (!riderId && !riderPhone) return res.status(400).json({ message: 'Informe riderId ou riderPhone' });

  const data = {};
  if (riderId) data.riderId = riderId;

  // opcionalmente já muda status ao atribuir
  if (alsoSetStatus === true) data.status = 'SAIU_PARA_ENTREGA';

  // se também alterou status, registre histórico
  let order;
  if (data.status) {
    const existing = await prisma.order.findUnique({ where: { id } });
    order = await prisma.order.update({
      where: { id },
      data: {
        ...data,
        histories: {
          create: { from: existing?.status || null, to: data.status, byUserId: req.user.id, reason: 'Atribuição' }
        }
      },
      include: { histories: true }
    });
  } else {
    order = await prisma.order.update({ where: { id }, data, include: { histories: true } });
  }

  // notifica o rider (usa rider.phone ou o override riderPhone)
  notifyRiderAssigned(order.id, { overridePhone: riderPhone }).catch(() => {});

  // notifica cliente (stub)
  const newStatus = data.status || order.status;
  notifyCustomerStatus(order.id, newStatus).catch(() => {});

  // If status changed to SAIU_PARA_ENTREGA, notify iFood asynchronously
  if (newStatus === 'SAIU_PARA_ENTREGA') {
    (async () => {
      try {
        const integ = await prisma.apiIntegration.findFirst({ where: { companyId: order.companyId, provider: 'IFOOD', enabled: true } });
        if (!integ) return;
        const orderExternalId = order.externalId || (order.payload && (order.payload.orderId || (order.payload.order && order.payload.order.id)));
        if (!orderExternalId) {
          console.warn('[orders.assign] no externalId found on order; skipping iFood dispatch notify', { orderId: order.id });
          return;
        }
        const { updateIFoodOrderStatus } = await import('../integrations/ifood/orders.js');
        try {
          await updateIFoodOrderStatus(order.companyId, orderExternalId, 'DISPATCHED', { merchantId: integ.merchantUuid || integ.merchantId, fullCode: 'DISPATCHED' });
          console.log('[orders.assign] notified iFood of dispatch for order', orderExternalId);
        } catch (e) {
          console.warn('[orders.assign] failed to notify iFood of dispatch', { orderExternalId, err: e?.message || e });
        }
      } catch (e) {
        console.error('[orders.assign] error while attempting iFood notify', e?.message || e);
      }
    })();
  }

  return res.json({ ok: true, order });
});

// Rider: mark order as delivered (delivered by rider). Move to payment confirmation
// Rider must be assigned to the order
ordersRouter.post('/:id/complete', requireRole('RIDER'), async (req, res) => {
  const { id } = req.params;
  const riderId = req.user.riderId;
  if (!riderId) return res.status(403).json({ message: 'Rider inválido' });

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: 'Pedido não encontrado' });
  if (existing.riderId !== riderId) return res.status(403).json({ message: 'Pedido não atribuído a este entregador' });

  try {
    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: 'CONFIRMACAO_PAGAMENTO',
        histories: { create: { from: existing.status, to: 'CONFIRMACAO_PAGAMENTO', byRiderId: riderId, reason: 'Entregue pelo motoboy (aguardando confirmação de pagamento)' } }
      },
      include: { rider: true }
    });

    // notify customer and emit socket (use new status)
    notifyCustomerStatus(updated.id, 'CONFIRMACAO_PAGAMENTO').catch(() => {});
    try { const idx = await import('../index.js'); idx.emitirPedidoAtualizado(updated); } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e) }

    // If this order belongs to an IFOOD integration, notify iFood that payment confirmation/completion happened
    (async () => {
      try {
        const integ = await prisma.apiIntegration.findFirst({ where: { companyId: updated.companyId, provider: 'IFOOD', enabled: true } });
        if (!integ) return;
        const orderExternalId = updated.externalId || (updated.payload && (updated.payload.orderId || (updated.payload.order && updated.payload.order.id)));
        if (!orderExternalId) {
          console.warn('[orders.complete] no externalId found on order; skipping iFood notify', { orderId: updated.id });
          return;
        }
        const { updateIFoodOrderStatus } = await import('../integrations/ifood/orders.js');
        try {
          await updateIFoodOrderStatus(updated.companyId, orderExternalId, 'CONCLUDED', { merchantId: integ.merchantUuid || integ.merchantId, fullCode: 'CONCLUDED' });
          console.log('[orders.complete] notified iFood of conclusion for order', orderExternalId);
        } catch (e) {
          console.warn('[orders.complete] failed to notify iFood of conclusion', { orderExternalId, err: e?.message || e });
        }
      } catch (e) {
        console.error('[orders.complete] error while attempting iFood notify', e?.message || e);
      }
    })();

    // credit rider account (reuse same logic as status patch)
    try {
      let neighborhoodName = null;
      function extractAddressTextFromPayload(payload) {
        if (!payload) return null;
        try {
          const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
          const candidates = [];
          if (p.delivery && p.delivery.deliveryAddress) {
            const d = p.delivery.deliveryAddress;
            if (d.formattedAddress) candidates.push(d.formattedAddress);
            if (d.formatted_address) candidates.push(d.formatted_address);
            if (d.address) candidates.push(typeof d.address === 'string' ? d.address : (d.address.formatted || ''));
          }
          if (p.formattedAddress) candidates.push(p.formattedAddress);
          if (p.formatted_address) candidates.push(p.formatted_address);
          if (p.address) candidates.push(typeof p.address === 'string' ? p.address : (p.address.formatted || ''));
          const txt = candidates.filter(Boolean).join(' ');
          return txt || null;
        } catch (e) { return null; }
      }

      const addrCandidates = [];
      if (updated.address) addrCandidates.push(String(updated.address));
      const payloadText = extractAddressTextFromPayload(updated.payload);
      if (payloadText) addrCandidates.push(payloadText);

      if (addrCandidates.length) {
        const addrText = addrCandidates.join(' ').toLowerCase();
        const neighs = await prisma.neighborhood.findMany({ where: { companyId: updated.companyId } });
        const matched = neighs.find(n => {
          if (!n || !n.name) return false;
          const name = String(n.name).toLowerCase();
          if (addrText.includes(name)) return true;
          if (n.aliases) {
            try { const arr = Array.isArray(n.aliases) ? n.aliases : JSON.parse(n.aliases); if (arr.some(a => addrText.includes(String(a||'').toLowerCase()))) return true; } catch (e) {}
          }
          return false;
        });
        if (matched) neighborhoodName = matched.name;
      }

      await riderAccountService.addDeliveryAndDailyIfNeeded({ companyId: updated.companyId, riderId: updated.riderId, orderId: updated.id, neighborhoodName, orderDate: updated.updatedAt || new Date() });
    } catch (e) { console.error('Failed to add rider transaction on complete:', e?.message || e); }

    return res.json({ ok: true, order: updated });
  } catch (e) {
    console.error('Failed to mark order complete', e);
    return res.status(500).json({ message: 'Falha ao marcar pedido como entregue' });
  }
});

// Admin: edit order details (customer, address, items, payment, notes)
ordersRouter.patch('/:id', requireRole('ADMIN', 'STORE'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  const order = await prisma.order.findFirst({ where: { id, companyId }, include: { items: true } });
  if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });

  const { customerName, customerPhone, notes, address, items, payment } = req.body || {};
  const data = {};
  if (customerName !== undefined) data.customerName = customerName;
  if (customerPhone !== undefined) data.customerPhone = customerPhone;
  if (address !== undefined) data.address = address;

  // Build payload updates
  const payload = (order.payload && typeof order.payload === 'object') ? { ...order.payload } : {};
  let payloadChanged = false;
  if (notes !== undefined) { payload.notes = notes; payloadChanged = true; }
  if (payment !== undefined) { payload.payment = { ...(payload.payment || {}), ...payment }; payloadChanged = true; }
  if (payloadChanged) data.payload = payload;

  // Update items: delete existing and recreate
  if (Array.isArray(items)) {
    await prisma.orderItem.deleteMany({ where: { orderId: id } });
    if (items.length > 0) {
      await prisma.orderItem.createMany({
        data: items.map(it => ({
          orderId: id,
          name: it.name || '',
          quantity: Number(it.quantity) || 1,
          price: Number(it.price) || 0,
          notes: it.notes || null,
          options: it.options || null,
        }))
      });
    }
    // Recalculate total from items
    let total = items.reduce((s, it) => {
      const qty = Number(it.quantity) || 1;
      const price = Number(it.price) || 0;
      let optsSum = 0;
      if (Array.isArray(it.options)) {
        for (const o of it.options) optsSum += (Number(o.price) || 0) * (Number(o.quantity) || 1);
      }
      return s + (price * qty) + (optsSum * qty);
    }, 0);
    data.total = total;
  }

  const updated = await prisma.order.update({
    where: { id },
    data,
    include: { items: true, rider: true, histories: true, store: true, company: true, customer: { include: { addresses: true } } }
  });

  return res.json(updated);
});

// Admin: patch order status (manual change)
// allow ADMIN and store-level users to change status from the admin panel / PDV
ordersRouter.patch('/:id/status', requireRole('ADMIN', 'STORE'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  try {
    const existing = await prisma.order.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Pedido não encontrado' });

    // If moving from CONFIRMACAO_PAGAMENTO -> CONCLUIDO, record a payment confirmation history
    const historyCreate = { from: existing.status, to: status, byUserId: req.user.id, reason: 'Manual' };
    // support multiple payments payload { payments: [{ method, amount }, ...] } or legacy paymentMethod
    let payments = null;
    if (req.body && Array.isArray(req.body.payments) && req.body.payments.length) payments = req.body.payments;
    else if (req.body && req.body.paymentMethod) payments = [{ method: String(req.body.paymentMethod), amount: req.body.amount != null ? Number(req.body.amount) : null }];

    if (existing.status === 'CONFIRMACAO_PAGAMENTO' && status === 'CONCLUIDO') {
      historyCreate.reason = 'Confirmação de pagamento manual';
      if (payments) {
        try {
          const summary = payments.map(p => `${String(p.method)}:${Number(p.amount||0).toFixed(2)}`).join(', ');
          historyCreate.reason += ` (métodos: ${summary})`;
        } catch (e) {}
      } else if (req.body && req.body.paymentMethod) {
        historyCreate.reason += ` (método: ${String(req.body.paymentMethod)})`;
      }
    }

    // If payments provided, persist them into payload.paymentConfirmed (merge with existing payload)
    let updateData = { status, histories: { create: historyCreate } };
    if (payments) {
      try {
        const current = await prisma.order.findUnique({ where: { id }, select: { payload: true } });
        const currentPayload = (current && current.payload) ? current.payload : {};
        const newPayload = Object.assign({}, currentPayload, { paymentConfirmed: payments });
        updateData.payload = newPayload;
      } catch (e) { console.warn('Failed to merge paymentConfirmed into payload', e && e.message); }
    }

    const updated = await prisma.order.update({
      where: { id },
      data: updateData,
      include: { histories: true, rider: true }
    });

    // notify customer and emit websocket update
    notifyCustomerStatus(updated.id, status).catch(() => {});
    try { const idx = await import('../index.js'); idx.emitirPedidoAtualizado(updated); } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e); }

    // If this order belongs to an IFOOD integration, attempt to notify iFood of the status change
    try {
      const integ = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD', enabled: true } });
      const orderExternalId = updated.externalId || (updated.payload && (updated.payload.orderId || updated.payload.id));
      if (integ && orderExternalId) {
        try {
          const { updateIFoodOrderStatus } = await import('../integrations/ifood/orders.js');

          function mapLocalToIFood(localStatus, orderObj) {
            const t = String(localStatus || '').toUpperCase();
            const type = String((orderObj && (orderObj.orderType || orderObj.order_type)) || (orderObj && orderObj.payload && orderObj.payload.orderType) || (orderObj && orderObj.orderType) || '').toUpperCase();
            // Delivery mapping
            if (type === 'DELIVERY' || !type) {
              if (t === 'EM_PREPARO') return 'PLACED';
              if (t === 'SAIU_PARA_ENTREGA') return 'DISPATCHED';
              if (t === 'CONFIRMACAO_PAGAMENTO' || t === 'CONCLUIDO') return 'CONCLUDED';
              if (t === 'CANCELADO') return 'CANCELLED';
            }
            // Pickup mapping
            if (type === 'PICKUP' || type === 'TAKEOUT' || type === 'TAKE-OUT') {
              if (t === 'EM_PREPARO' || t === 'PRONTO') return 'PLACED';
              if (t === 'CONFIRMACAO_PAGAMENTO' || t === 'CONCLUIDO') return 'READY_TO_PICKUP';
              if (t === 'SAIU_PARA_ENTREGA' || t === 'DESPACHADO') return 'DISPATCHED';
              if (t === 'CANCELADO') return 'CANCELLED';
            }
            // Fallback
            if (t === 'CONCLUIDO') return 'CONCLUDED';
            return null;
          }

          const target = mapLocalToIFood(status, updated);
          if (target) {
            try {
              await updateIFoodOrderStatus(updated.companyId, orderExternalId, target, { merchantId: integ.merchantUuid || integ.merchantId });
              console.log('Notified iFood of status change for order', orderExternalId, '->', target);
            } catch (eNotify) {
              console.warn('Failed to notify iFood of status change for', orderExternalId, eNotify && eNotify.message);
            }
          }
        } catch (eImp) {
          console.warn('Failed to import iFood update function:', eImp && eImp.message);
        }
      }
    } catch (e) { console.warn('iFood notify attempt failed:', e && e.message); }

    // If order was completed and has a rider, credit rider's account
    try {
      if (status === 'CONCLUIDO' && updated.riderId) {
        // attempt to detect neighborhood name from address/payload (best-effort)
        let neighborhoodName = null;
        function extractAddressTextFromPayload(payload) {
          if (!payload) return null;
          try {
            const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
            const candidates = [];
            if (p.delivery && p.delivery.deliveryAddress) {
              const d = p.delivery.deliveryAddress;
              if (d.formattedAddress) candidates.push(d.formattedAddress);
              if (d.formatted_address) candidates.push(d.formatted_address);
              if (d.address) candidates.push(typeof d.address === 'string' ? d.address : (d.address.formatted || ''));
            }
            if (p.formattedAddress) candidates.push(p.formattedAddress);
            if (p.formatted_address) candidates.push(p.formatted_address);
            if (p.address) candidates.push(typeof p.address === 'string' ? p.address : (p.address.formatted || ''));
            const txt = candidates.filter(Boolean).join(' ');
            return txt || null;
          } catch (e) { return null; }
        }

        const addrCandidates = [];
        if (updated.address) addrCandidates.push(String(updated.address));
        const payloadText = extractAddressTextFromPayload(updated.payload);
        if (payloadText) addrCandidates.push(payloadText);

        if (addrCandidates.length) {
          const addrText = addrCandidates.join(' ').toLowerCase();
          const neighs = await prisma.neighborhood.findMany({ where: { companyId: updated.companyId } });
          const matched = neighs.find(n => {
            if (!n || !n.name) return false;
            const name = String(n.name).toLowerCase();
            if (addrText.includes(name)) return true;
            if (n.aliases) {
              try {
                const arr = Array.isArray(n.aliases) ? n.aliases : JSON.parse(n.aliases);
                if (arr.some(a => addrText.includes(String(a || '').toLowerCase()))) return true;
              } catch (e) {}
            }
            return false;
          });
          if (matched) neighborhoodName = matched.name;
        }

        await riderAccountService.addDeliveryAndDailyIfNeeded({ companyId: updated.companyId, riderId: updated.riderId, orderId: updated.id, neighborhoodName, orderDate: updated.updatedAt || new Date() });
      }
    } catch (e) { console.error('Failed to add rider transaction:', e?.message || e); }

    // If order was completed, attempt to track affiliate commission for coupon owner
    try {
      if (status === 'CONCLUIDO') {
        const existingCount = await prisma.affiliateSale.count({ where: { orderId: updated.id } });
        if (existingCount === 0) {
          try { await trackAffiliateSale(updated, updated.companyId); } catch (afErr) { console.warn('Failed to track affiliate sale on order completion', updated.id, afErr?.message || afErr); }
        }
      }
    } catch (e) { console.error('Error while attempting affiliate tracking on order status change:', e?.message || e); }

    // If order was completed, attempt to credit cashback to customer wallet
    try {
      if (status === 'CONCLUIDO') {
        (async () => {
          try {
            let clientId = updated.customerId || null;
            // try to derive clientId from order data (phone or payload) when customerId missing
            if (!clientId) {
              try {
                const phone = updated.customerPhone || (updated.payload && (updated.payload.customer && (updated.payload.customer.contact || updated.payload.customer.phone))) || null;
                if (phone) {
                  const cust = await prisma.customer.findFirst({ where: { companyId: updated.companyId, OR: [{ whatsapp: phone }, { phone }] } });
                  if (cust) clientId = cust.id;
                }
              } catch (eFind) { /* ignore */ }
            }
            if (clientId) {
              try{
                const res = await cashbackSvc.creditWalletForOrder(updated.companyId, clientId, updated, 'Cashback automático de compra')
                if(res && res.amount){
                  console.log('Cashback credited for order', updated.id, 'amount', res.amount)
                } else {
                  console.log('No cashback created for order (service returned null) for order', updated.id)
                }
              }catch(e){ console.error('Failed to credit cashback for order (service error)', updated.id, e?.message || e) }
            } else {
              console.log('No clientId found for order; skipping cashback credit for order', updated.id)
            }
          } catch (e) { console.error('Failed to credit cashback for order', updated.id, e?.message || e) }
        })()
      }
    } catch (e) { console.error('Error while attempting to credit cashback on order status change:', e?.message || e); }

    return res.json(updated);
  } catch (e) {
    console.error('Failed to update order status', e);
    return res.status(500).json({ message: 'Falha ao atualizar status do pedido' });
  }
});

ordersRouter.post('/:id/tickets', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  const order = await prisma.order.findFirst({ where: { id, companyId } });
  if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });

  const { randomToken, sha256 } = await import('../utils.js');
  const token = randomToken(24);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

  await prisma.ticket.create({ data: { orderId: id, tokenHash, expiresAt } });

  // Generate a rider-specific claim URL so that when a logged-in rider opens it
  // the frontend will call the authenticated claim endpoint and assign the order
  // to the currently logged-in rider. Keep the public /claim route for other flows.
  const qrUrl = `${process.env.PUBLIC_FRONTEND_URL}/rider/claim/${token}`;
  res.json({ qrUrl });
});

// GET /orders/:id - detalhe do pedido (inclui items, rider e payload)
ordersRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  const order = await prisma.order.findFirst({
    where: { id, companyId },
    include: { items: true, rider: true, company: true, store: true }
  });
  if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });

  // compute displaySimple for this order (position within same day)
  try {
    if (order.displaySimple != null) {
      order.displaySimple = String(order.displaySimple).padStart(2, '0');
    } else {
      const createdAt = order.createdAt || new Date();
      const startOfDay = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
      const count = await prisma.order.count({
        where: {
          companyId: order.companyId,
          createdAt: { gte: startOfDay, lte: createdAt }
        }
      });
      order.displaySimple = String(count).padStart(2, '0');
    }
  } catch (e) {
    console.warn('Failed to compute displaySimple for order detail', e?.message || e);
  }
  return res.json(order);
});

// PDV create route (previously the opening wrapper was missing)
ordersRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  try {
    const { items = [], address = {}, coupon, payment, type, customerPhone, customerName, requestedStoreId } = req.body || {};

    // Dev: log a compact summary to help debug PDV create 500s (safe, non-sensitive fields)
    try { console.log('PDV create payload summary:', { type, customerPhone, customerName, itemsCount: Array.isArray(items) ? items.length : 0, addressProvided: address && Object.keys(address).length > 0 }); } catch (e) {}

    const orderType = String(type || '').toUpperCase();
    const neigh = String(address?.neighborhood || address?.neigh || '').trim();
    const street = String(address?.street || '').trim();
    if (orderType === 'DELIVERY' && (!neigh || !street)) return res.status(400).json({ message: 'Endereço (rua e bairro) obrigatório para entrega' });

    // sanitize items
    const cleanItems = items.map(it => ({
      name: String(it.name || it.productName || 'Item'),
      quantity: Number(it.quantity || 1),
      price: Number(it.price || 0),
      notes: it.notes ? String(it.notes) : null,
      // preserve option quantity/id when provided so frontend displays totals correctly
      options: Array.isArray(it.options) ? it.options.map(o => ({ id: o.id ?? null, name: String(o.name || ''), price: Number(o.price || 0), quantity: Number(o.quantity ?? o.qty ?? 1) })) : null
    }));
    const subtotal = cleanItems.reduce((s, it) => s + (Number(it.price || 0) * Number(it.quantity || 1)), 0);

    // neighborhood delivery fee
    let deliveryFee = 0;
    try {
      const neighName = String(address.neighborhood || address.neigh || '').trim().toLowerCase();
      if (neighName) {
        const neighRows = await prisma.neighborhood.findMany({ where: { companyId } });
        const matched = neighRows.find(n => {
          if (!n) return false;
          const nm = String(n.name || '').toLowerCase();
          if (nm === neighName) return true;
          if (n.aliases && Array.isArray(n.aliases) && n.aliases.map(a => String(a).toLowerCase()).includes(neighName)) return true;
          return false;
        });
        if (matched) deliveryFee = Number(matched.deliveryFee || 0);
      }
    } catch (e) { deliveryFee = 0; }

    // coupon handling (optional) — mimic public logic simplified
    let couponDiscount = 0;
    let couponCode = null;
    if (coupon && coupon.code) {
      couponCode = String(coupon.code).trim();
      try {
        const row = await prisma.coupon.findFirst({ where: { companyId, code: couponCode, isActive: true } });
        if (row) {
          const rawVal = Number(row.value || 0);
            if (row.isPercentage) {
              couponDiscount = rawVal > 0 && rawVal <= 1 ? subtotal * rawVal : (subtotal * rawVal) / 100;
            } else {
              couponDiscount = rawVal;
            }
            if (couponDiscount > subtotal) couponDiscount = subtotal;
            couponDiscount = Math.round(couponDiscount * 100) / 100;
        }
      } catch (e) { couponDiscount = 0; }
    }

    const computedTotal = Math.max(0, subtotal - couponDiscount) + Number(deliveryFee || 0);

    // Prefer payment amount when provided by PDV client as authoritative total
    const total = (payment && Number.isFinite(Number(payment.amount)) && Number(payment.amount) > 0) ? Number(payment.amount) : computedTotal;

    // validate payment method if provided
    let paymentPayload = null;
    if (payment && (payment.methodCode || payment.method)) {
      const code = String(payment.methodCode || payment.method).trim();
      const pm = await prisma.paymentMethod.findFirst({ where: { companyId, isActive: true, OR: [{ code }, { name: code }] } });
      if (!pm) return res.status(400).json({ message: 'Método de pagamento inválido' });
      paymentPayload = {
        method: pm.name,
        methodCode: pm.name,
        amount: Number(payment.amount || total),
        changeFor: payment.changeFor != null ? Number(payment.changeFor) : null,
        raw: payment.raw || null
      };
    }

    // find or create customer (best-effort). If client provided an explicit customerId, prefer it.
    let persistedCustomer = null;
    try {
      if (req.body && req.body.customerId) {
        const c = await prisma.customer.findFirst({ where: { id: req.body.customerId, companyId } });
        if (c) persistedCustomer = c;
      }
      if (!persistedCustomer) {
        const contact = String(customerPhone || '').trim();
        const name = String(customerName || '').trim();
        if (contact || name) {
          const addressPayload = address && type === 'DELIVERY' ? {
            delivery: { deliveryAddress: { formattedAddress: address.formatted || [address.street, address.number].filter(Boolean).join(', '), streetName: address.street || null, streetNumber: address.number || null, neighborhood: address.neighborhood || null, city: address.city || null } }
          } : null;
          persistedCustomer = await findOrCreateCustomer({ companyId, fullName: name || null, whatsapp: contact || null, phone: contact || null, addressPayload });
        }
      }
    } catch (e) { console.warn('PDV: falha ao criar/achar cliente', e?.message || e); }

    // resolve store: prefer explicit `storeId` from request (validate belongs to company),
    // otherwise fallback to single-store companies like the public route
    let resolvedStore = null;
    try {
      if (requestedStoreId) {
        const s = await prisma.store.findFirst({ where: { id: requestedStoreId, companyId }, select: { id: true } });
        if (s) {
          resolvedStore = s;
          console.log('PDV: using requested storeId for order creation:', requestedStoreId);
        } else {
          console.warn('PDV: requested storeId does not belong to company, ignoring:', requestedStoreId);
        }
      }
      if (!resolvedStore) {
        const count = await prisma.store.count({ where: { companyId } });
        if (count === 1) {
          resolvedStore = await prisma.store.findFirst({ where: { companyId } });
        }
      }
    } catch (e) { /* ignore */ }

    // normalize delivery address into a consistent shape and persist it under payload.delivery.deliveryAddress
    const normalizedDelivery = (type === 'DELIVERY' && address && Object.keys(address).length) ? normalizeDeliveryAddressFromPayload({ delivery: { deliveryAddress: address } }) : null;
    const pdvDenormNeighborhood = (normalizedDelivery && normalizedDelivery.neighborhood) || (address && (address.neighborhood || address.neigh)) || null;

    const created = await prisma.order.create({
      data: {
        companyId,
        customerSource: 'MANUAL',
        customerId: persistedCustomer ? persistedCustomer.id : undefined,
        customerName: customerName || (persistedCustomer ? persistedCustomer.fullName : null),
        customerPhone: customerPhone || (persistedCustomer ? (persistedCustomer.whatsapp || persistedCustomer.phone) : null),
        address: type === 'DELIVERY' ? (buildConcatenatedAddress({ delivery: { deliveryAddress: address } }) || (normalizedDelivery && normalizedDelivery.formattedAddress) || (address.formatted || [address.street, address.number].filter(Boolean).join(', '))) : null,
        deliveryNeighborhood: pdvDenormNeighborhood || (normalizedDelivery && normalizedDelivery.neighborhood) || null,
        total,
        couponCode,
        couponDiscount: Number(couponDiscount || 0),
        orderType: type,
        deliveryFee,
        status: 'EM_PREPARO',
        ...(resolvedStore ? { storeId: resolvedStore.id } : {}),
        payload: {
          payment: paymentPayload,
          orderType: type,
          rawPayload: { source: 'PDV', items: cleanItems, customer: { name: customerName || null, contact: customerPhone || null }, address },
          // persist normalized delivery address for consistency across flows
          delivery: normalizedDelivery ? { deliveryAddress: normalizedDelivery } : (address && Object.keys(address).length ? { deliveryAddress: normalizeDeliveryAddressFromPayload({ delivery: { deliveryAddress: address } }) } : undefined),
          // persist computed and chosen totals for clarity
          computedTotal: computedTotal,
          total: total
        },
        items: {
          create: cleanItems.map(it => ({ name: it.name, quantity: it.quantity, price: it.price, notes: it.notes, options: it.options || null }))
        },
        histories: { create: { from: null, to: 'EM_PREPARO', byUserId: req.user.id, reason: 'Criação PDV' } }
      },
      include: { items: true, histories: true }
    });

    try {
      // generate QR for delivery orders so agents can print the QR on comanda
      try {
        if (String(type || '').toUpperCase() === 'DELIVERY') {
          try {
            const QRLib = await import('qrcode');
            const frontend = (process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
            const qrTarget = `${frontend}/orders/${created.id}`;
            const dataUrl = await QRLib.toDataURL(qrTarget, { width: 240 });
            try {
              // check prisma model fields to avoid Unknown argument errors
              const hasField = (() => {
                try {
                  const model = prisma && prisma._dmmf && prisma._dmmf.modelMap && prisma._dmmf.modelMap.Order;
                  if (!model || !Array.isArray(model.fields)) return false;
                  return model.fields.some(f => ['qrDataUrl', 'qrText', 'rasterDataUrl'].includes(f.name));
                } catch (e) { return false; }
              })();
              if (hasField) {
                await prisma.order.update({ where: { id: created.id }, data: { qrDataUrl: dataUrl, qrText: qrTarget, rasterDataUrl: dataUrl } });
                created.qrDataUrl = dataUrl;
                created.qrText = qrTarget;
                created.rasterDataUrl = dataUrl;
              } else {
                const current = await prisma.order.findUnique({ where: { id: created.id }, select: { payload: true } });
                const currentPayload = (current && current.payload) ? current.payload : {};
                currentPayload.qrDataUrl = dataUrl;
                currentPayload.qrText = qrTarget;
                currentPayload.rasterDataUrl = dataUrl;
                await prisma.order.update({ where: { id: created.id }, data: { payload: currentPayload } });
                created.payload = currentPayload;
                created.qrText = qrTarget;
                created.rasterDataUrl = dataUrl;
              }
            } catch (eUp) { console.warn('PDV: failed to persist qrDataUrl for order', created.id, eUp && eUp.message); }
          } catch (eQr) { console.warn('PDV: failed to generate QR for order', created.id, eQr && eQr.message); }
        }
      } catch (eInner) { /* ignore */ }
      // emit novo-pedido so connected agents can receive and print immediately
      try {
        const emitObj = {
          id: created.id,
          companyId: created.companyId || null,
          storeId: created.storeId || (created.payload && created.payload.storeId) || null,
          qrDataUrl: created.qrDataUrl || (created.payload && created.payload.qrDataUrl) || null,
          rasterDataUrl: created.rasterDataUrl || (created.payload && created.payload.rasterDataUrl) || null,
          qrText: created.qrText || (created.payload && created.payload.qrText) || null,
          payload: created.payload || null,
          items: created.items || null,
          // include address when available to help frontends render immediately
          address: created.address || (created.payload && (created.payload.delivery && created.payload.delivery.deliveryAddress && created.payload.delivery.deliveryAddress.formattedAddress)) || (created.payload && (created.payload.rawPayload?.address || created.payload.deliveryAddress?.formattedAddress)) || null,
          // include structured deliveryAddress so consumers always receive a normalized object when present
          deliveryAddress: created.payload && created.payload.delivery ? created.payload.delivery.deliveryAddress : null
        };
        try { const idx = await import('../index.js'); idx.emitirNovoPedido(emitObj); } catch (e) { console.warn('emitirNovoPedido failed for created order', emitObj && emitObj.id, e && e.message); }
      } catch (eEmit) {
        console.warn('emitirNovoPedido failed for created order', created && created.id, eEmit && eEmit.message);
        try { const idx = await import('../index.js'); idx.emitirNovoPedido(created); } catch (e) { console.warn('emitirNovoPedido failed for created order', created && created.id, e && e.message); }
      }
    } catch (e) { console.warn('Emitir novo pedido falhou:', e && e.message); }
    try { const idx = await import('../index.js'); idx.emitirPedidoAtualizado(created); } catch (e) { /* ignore */ }

    // attempt to decrement stock for items that reference technical sheets (best-effort)
    (async () => {
      try {
        await buildAndPersistStockMovementFromOrderItems(prisma, created);
      } catch (e) {
        console.warn('[orders.create] failed to create stock movement for order', created && created.id, e && e.message);
      }
    })();

    return res.status(201).json(created);
  } catch (e) {
    console.error('Erro ao criar pedido PDV', e && (e.stack || e.message || e));
    // In development, return the actual error for easier debugging.
    if (process.env.NODE_ENV !== 'production') {
      return res.status(500).json({ message: e && e.message ? e.message : 'Erro interno ao criar pedido PDV', stack: e && e.stack ? e.stack : null });
    }
    return res.status(500).json({ message: 'Erro interno ao criar pedido PDV' });
  }
});
