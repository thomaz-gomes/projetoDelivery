import express from 'express';
import { prisma } from '../prisma.js';
import { emitirPedidoAtualizado } from '../index.js';
import { authMiddleware, requireRole } from '../auth.js';
import { upsertCustomerFromIfood } from '../services/customers.js';
import { trackAffiliateSale } from '../services/affiliates.js';
import { canTransition } from '../stateMachine.js';
import { notifyRiderAssigned, notifyCustomerStatus } from '../services/notify.js';
import riderAccountService from '../services/riderAccount.js';

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
    include: { items: true, rider: true, histories: true, store: true, company: true }
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

  res.json(orders);
});

ordersRouter.patch('/:id/status', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const allowed = ['EM_PREPARO', 'SAIU_PARA_ENTREGA', 'CONCLUIDO', 'CANCELADO'];
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Status inválido' });

  // registra histórico com o status anterior
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: 'Pedido não encontrado' });

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status,
      histories: {
        create: { from: existing.status, to: status, byUserId: req.user.id, reason: 'Manual' }
      }
    },
    include: { histories: true }
  });

  // notificar cliente (stub pronto)
  notifyCustomerStatus(updated.id, status).catch(() => {});

  // emit order-updated socket so public clients can receive status changes
  try { emitirPedidoAtualizado(updated) } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e) }

  // If order was completed and has a rider, credit rider's account with riderFee and daily rate if needed
  try {
    if (status === 'CONCLUIDO' && updated.riderId) {
      // Detect neighborhoodName only by matching known Neighborhoods (name + aliases)
      // against the order address or any formatted address available in the payload.
      // NOTE: we intentionally DO NOT use customer.addresses here — neighborhoods are global per company.
      let neighborhoodName = null;

      // helper: try to extract human-readable address text from payload
      function extractAddressTextFromPayload(payload) {
        if (!payload) return null;
        try {
          // payload might be an object or JSON string
          const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
          // common locations used by integrators
          const candidates = [];
          if (p.delivery && p.delivery.deliveryAddress) {
            const d = p.delivery.deliveryAddress;
            if (d.formattedAddress) candidates.push(d.formattedAddress);
            if (d.formatted_address) candidates.push(d.formatted_address);
            if (d.address) candidates.push(typeof d.address === 'string' ? d.address : (d.address.formatted || ''));
          }
          // generic fallback: some payloads contain a top-level formattedAddress or address
          if (p.formattedAddress) candidates.push(p.formattedAddress);
          if (p.formatted_address) candidates.push(p.formatted_address);
          if (p.address) candidates.push(typeof p.address === 'string' ? p.address : (p.address.formatted || ''));

          const txt = candidates.filter(Boolean).join(' ');
          return txt || null;
        } catch (e) {
          return null;
        }
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
            } catch (e) {
              // ignore parse errors
            }
          }
          return false;
        });
        if (matched) neighborhoodName = matched.name;
      }

      await riderAccountService.addDeliveryAndDailyIfNeeded({
        companyId: updated.companyId,
        riderId: updated.riderId,
        orderId: updated.id,
        neighborhoodName,
        orderDate: updated.updatedAt || new Date(),
      });
    }
  } catch (e) {
    console.error('Failed to add rider transaction:', e?.message || e);
  }

  // If order was completed, attempt to track affiliate commission for coupon owner
  try {
    if (status === 'CONCLUIDO') {
      // avoid duplicate affiliate sales: only track if no affiliateSale exists for this order
      const existingCount = await prisma.affiliateSale.count({ where: { orderId: updated.id } });
      if (existingCount === 0) {
        try {
          await trackAffiliateSale(updated, updated.companyId);
        } catch (afErr) {
          console.warn('Failed to track affiliate sale on order completion', updated.id, afErr?.message || afErr);
        }
      }
    }
  } catch (e) {
    console.error('Error while attempting affiliate tracking on order status change:', e?.message || e);
  }

  return res.json(updated);
});

// POST atribuir entregador manualmente
ordersRouter.post('/:id/assign', requireRole('ADMIN'), async (req, res) => {
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

  return res.json({ ok: true, order });
});

// Rider: mark order as delivered (complete) - rider must be assigned to the order
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
        status: 'CONCLUIDO',
        histories: { create: { from: existing.status, to: 'CONCLUIDO', byRiderId: riderId, reason: 'Entregue pelo motoboy' } }
      },
      include: { rider: true }
    });

    // notify customer and emit socket
    notifyCustomerStatus(updated.id, 'CONCLUIDO').catch(() => {});
    try { emitirPedidoAtualizado(updated) } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e) }

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

  res.json(order);
});

// POST /orders/:id/associate-customer - associate or create a customer from the order payload
ordersRouter.post('/:id/associate-customer', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  const order = await prisma.order.findFirst({ where: { id, companyId } });
  if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });

  // allow caller to pass an override payload, otherwise use stored payload
  const payload = req.body?.payload ?? order.payload;
  if (!payload) return res.status(400).json({ message: 'Nenhum payload disponível para extrair cliente' });

  try {
    const { customer, addressId } = await upsertCustomerFromIfood({ companyId: order.companyId, payload });

    const updated = await prisma.order.update({
      where: { id },
      data: {
        customerId: customer.id,
        customerName: customer.fullName || order.customerName,
        customerPhone: customer.whatsapp || customer.phone || order.customerPhone,
      }
    });

    return res.json({ ok: true, customer, addressId, order: updated });
  } catch (e) {
    console.error('Failed to associate customer for order', id, e?.message || e);
    return res.status(500).json({ message: 'Falha ao associar cliente', error: String(e?.message || e) });
  }
});
