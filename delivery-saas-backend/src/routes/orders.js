import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { prisma } from '../prisma.js';
// Note: avoid static import of index.js to prevent circular dependency with index.js
// When we need to emit socket events, use dynamic import inside async handlers:
// const { emitirPedidoAtualizado } = await import('../index.js');
import { authMiddleware, requireRole } from '../auth.js';
import { requireModuleStrict } from '../modules.js';
import { upsertCustomerFromIfood, findOrCreateCustomer, normalizeDeliveryAddressFromPayload, buildConcatenatedAddress } from '../services/customers.js';
import { trackAffiliateSale } from '../services/affiliates.js';
import * as cashbackSvc from '../services/cashback.js';
import { canTransition } from '../stateMachine.js';
import { notifyRiderAssigned, notifyCustomerStatus, notifyCustomerOrderSummary } from '../services/notify.js';
import riderAccountService from '../services/riderAccount.js';
import { buildAndPersistStockMovementFromOrderItems, reverseStockMovementForOrder } from '../services/stockFromOrder.js';
import { createFinancialEntriesForOrder } from '../services/financial/orderFinancialBridge.js';
import { tryEmitIfoodChat } from '../services/ifoodChatEmitter.js';
import { nextDisplaySimple } from '../utils/displaySimple.js';
import { geocodeOrderIfNeeded } from '../utils/geocode.js';

const upload = multer({ storage: multer.memoryStorage() });

export const ordersRouter = express.Router();

ordersRouter.use(authMiddleware);
ordersRouter.use(requireModuleStrict('CARDAPIO_COMPLETO'));

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

// POST /orders/import — import sales from legacy system spreadsheet (.xlsx, .xls, .csv)
ordersRouter.post('/import', requireRole('ADMIN'), upload.single('file'), async (req, res) => {
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });
  if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado' });

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const dataRows = rows.slice(1).filter(r => r[0] !== '' && r[0] != null);
    if (!dataRows.length) return res.status(400).json({ message: 'Planilha vazia ou sem dados' });

    const riderCache = {};
    const customerCache = {};

    const existingRiders = await prisma.rider.findMany({ where: { companyId } });
    for (const r of existingRiders) riderCache[r.name.trim().toLowerCase()] = r;

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      try {
        const canal = String(r[5] || '').trim();
        const nomeLoja = String(r[2] || '').trim();
        const salesChannel = nomeLoja ? `${canal} - ${nomeLoja}` : canal;

        const externalId = String(r[6] || '').trim() || null;
        const displayId = String(r[7] || '').trim() || null;

        let createdAt = new Date();
        const rawDate = String(r[8] || '').trim();
        if (rawDate) {
          const m = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
          if (m) createdAt = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
        }

        const customerName = String(r[9] || '').trim() || null;
        const isCancelled = String(r[12] || '').trim().toUpperCase() === 'S';
        const status = isCancelled ? 'CANCELADO' : 'CONCLUIDO';

        const itemsValue = Number(r[14]) || 0;
        const deliveryFee = Number(r[15]) || 0;
        const riderFee = Number(r[16]) || 0;
        const riderName = String(r[17] || '').trim();
        const bairro = String(r[18] || '').trim() || null;
        const cep = String(r[19] || '').trim() || null;
        const acrescimo = Number(r[20]) || 0;
        const motivoAcrescimo = String(r[21] || '').trim() || null;
        const desconto = Number(r[22]) || 0;
        const motivoDesconto = String(r[23] || '').trim() || null;
        const total = Number(r[24]) || 0;
        const taxaServico = Number(r[25]) || 0;
        const pagamento = String(r[11] || '').trim() || null;
        const motivoCancelamento = String(r[13] || '').trim() || null;
        const temCupom = String(r[10] || '').trim().toUpperCase() === 'S';

        let riderId = null;
        if (riderName) {
          const key = riderName.toLowerCase();
          if (riderCache[key]) {
            riderId = riderCache[key].id;
          } else {
            const newRider = await prisma.rider.create({
              data: { companyId, name: riderName, whatsapp: '0000', active: false }
            });
            riderCache[key] = newRider;
            riderId = newRider.id;
          }
        }

        let customerId = null;
        if (customerName) {
          const ckey = customerName.toLowerCase();
          if (customerCache[ckey]) {
            customerId = customerCache[ckey].id;
          } else {
            const existing = await prisma.customer.findFirst({
              where: { companyId, fullName: { equals: customerName, mode: 'insensitive' } }
            });
            if (existing) {
              customerCache[ckey] = existing;
              customerId = existing.id;
            } else {
              const newCust = await prisma.customer.create({
                data: { companyId, fullName: customerName }
              });
              customerCache[ckey] = newCust;
              customerId = newCust.id;
            }
          }
        }

        const customerSource = canal.toLowerCase().includes('ifood') ? 'IFOOD'
          : canal.toLowerCase().includes('aiqfome') ? 'AIQFOME'
          : 'MANUAL';

        await prisma.order.create({
          data: {
            companyId,
            externalId,
            displayId,
            status,
            customerName,
            customerId,
            customerSource,
            deliveryFee,
            deliveryNeighborhood: bairro,
            couponDiscount: desconto > 0 ? desconto : undefined,
            total,
            riderId,
            createdAt,
            payload: {
              imported: true,
              salesChannel,
              turno: String(r[4] || '').trim() || null,
              pagamento,
              acrescimo,
              motivoAcrescimo,
              desconto,
              motivoDesconto,
              motivoCancelamento,
              taxaServico,
              riderFee,
              cep,
              temCupom,
            },
            items: {
              create: [{
                name: 'Itens importados',
                quantity: 1,
                price: itemsValue
              }]
            }
          }
        });

        created++;
      } catch (e) {
        errors.push({ row: i + 2, error: e.message });
        skipped++;
      }
    }

    res.json({ message: 'Importação concluída', created, skipped, errors: errors.slice(0, 20) });
  } catch (e) {
    console.error('[import] failed:', e);
    res.status(500).json({ message: 'Erro ao processar planilha', error: e.message });
  }
});

// POST atribuir entregador manualmente
// allow ADMIN and store-level users to assign riders
ordersRouter.post('/:id/assign', requireRole('ADMIN', 'ATTENDANT', 'STORE'), async (req, res) => {
  const { id } = req.params;
  const { riderId, riderPhone, alsoSetStatus } = req.body || {};
  if (!riderId && !riderPhone) return res.status(400).json({ message: 'Informe riderId ou riderPhone' });

  const data = {};
  if (riderId) data.riderId = riderId;

  // opcionalmente já muda status ao atribuir
  if (alsoSetStatus === true) data.status = 'SAIU_PARA_ENTREGA';

  // se também alterou status, registre histórico
  const fullInclude = { histories: true, rider: true, items: true, store: true, company: true, customer: { include: { addresses: true } } };
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
      include: fullInclude
    });
  } else {
    order = await prisma.order.update({ where: { id }, data, include: fullInclude });
  }

  // notifica o rider (usa rider.phone ou o override riderPhone)
  notifyRiderAssigned(order.id, { overridePhone: riderPhone }).catch(() => {});

  // emitir evento de atualização via Socket.IO para todos os clientes conectados
  try { const idx = await import('../index.js'); idx.emitirPedidoAtualizado(order); } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e); }
  tryEmitIfoodChat(order, data.status || order.status).catch(() => {});

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
          const resp = await updateIFoodOrderStatus(order.companyId, orderExternalId, 'DISPATCHED', { merchantId: integ.merchantUuid || integ.merchantId, fullCode: 'DISPATCHED' });
          console.log('[orders.assign] notified iFood of dispatch for order', orderExternalId, 'response:', resp && (resp.ok ? 'ok' : resp));
        } catch (e) {
          console.warn('[orders.assign] failed to notify iFood of dispatch', { orderExternalId, message: e?.message || String(e), status: e?.response?.status || null, providerResponse: e?.response?.data || null });
        }
      } catch (e) {
        console.error('[orders.assign] error while attempting iFood notify', e?.message || e);
      }
    })();
  }

  // If status changed to SAIU_PARA_ENTREGA and order is from aiqfome, notify aiqfome
  if (newStatus === 'SAIU_PARA_ENTREGA' && order.customerSource === 'AIQFOME' && order.externalId) {
    (async () => {
      try {
        const { updateAiqfomeOrderStatus } = await import('../integrations/aiqfome/orders.js');
        await updateAiqfomeOrderStatus(order.companyId, order.externalId, 'SAIU_PARA_ENTREGA');
        console.log('[aiqfome] Notified dispatch for order', order.externalId);
      } catch (e) {
        console.warn('[aiqfome] failed to notify dispatch:', e?.message);
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
    // Detect if this is an iFood prepaid order
    const isIfood = existing.customerSource === 'IFOOD';
    const isPrepaid = (() => {
      const p = existing.payload;
      if (!p) return false;
      const payments = p.order?.payments || p.payments;
      if (payments && typeof payments === 'object' && !Array.isArray(payments)) {
        if (payments.prepaid === true) return true;
        const methods = payments.methods || [];
        if (methods.length > 0 && methods.every(m => m.prepaid === true)) return true;
      }
      if (p.payment?.prepaid === true) return true;
      return false;
    })();

    // iFood prepaid: rider confirms delivery but does NOT change order status.
    // Only record a RIDER_DELIVERED history entry for delivery time calculation.
    // The actual CONCLUIDO transition happens when iFood sends CONCLUDED webhook
    // or when the rider enters the delivery code.
    if (isIfood && isPrepaid) {
      await prisma.orderStatusHistory.create({
        data: {
          orderId: id,
          from: existing.status,
          to: 'RIDER_DELIVERED',
          byRiderId: riderId,
          reason: 'Entregue pelo motoboy (pagamento online — aguardando conclusão pelo iFood)',
        },
      });

      // Emit socket so frontend knows rider delivered
      try {
        const idx = await import('../index.js');
        const order = await prisma.order.findUnique({ where: { id }, include: { rider: true, items: true, histories: true } });
        idx.emitirPedidoAtualizado(order);
      } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e); }

      return res.json({ ok: true, riderDelivered: true, message: 'Entrega registrada. Pedido será concluído quando confirmado pelo iFood.' });
    }

    // Non-iFood prepaid: skip CONFIRMACAO_PAGAMENTO, go straight to CONCLUIDO
    // Non-prepaid: go to CONFIRMACAO_PAGAMENTO as usual
    const targetStatus = (!isIfood && isPrepaid) ? 'CONCLUIDO' : 'CONFIRMACAO_PAGAMENTO';
    const historyReason = (!isIfood && isPrepaid)
      ? 'Entregue pelo motoboy (pagamento online — concluído automaticamente)'
      : 'Entregue pelo motoboy (aguardando confirmação de pagamento)';

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: targetStatus,
        histories: { create: { from: existing.status, to: targetStatus, byRiderId: riderId, reason: historyReason } }
      },
      include: { rider: true }
    });

    // notify customer and emit socket
    notifyCustomerStatus(updated.id, targetStatus).catch(() => {});
    try { const idx = await import('../index.js'); idx.emitirPedidoAtualizado(updated); } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e) }

    // If this order belongs to an IFOOD integration, notify iFood
    if (!isPrepaid) {
      (async () => {
        try {
          const integ = await prisma.apiIntegration.findFirst({ where: { companyId: updated.companyId, provider: 'IFOOD', enabled: true } });
          if (!integ) return;
          const orderExternalId = updated.externalId || (updated.payload && (updated.payload.orderId || (updated.payload.order && updated.payload.order.id)));
          if (!orderExternalId) return;
          const { updateIFoodOrderStatus } = await import('../integrations/ifood/orders.js');
          try {
            await updateIFoodOrderStatus(updated.companyId, orderExternalId, 'CONCLUDED', { merchantId: integ.merchantUuid || integ.merchantId, fullCode: 'CONCLUDED' });
          } catch (e) {
            console.warn('[orders.complete] failed to notify iFood', { orderExternalId, message: e?.message });
          }
        } catch (e) {}
      })();
    }

    // Non-iFood prepaid: went straight to CONCLUIDO — run completion triggers
    if (!isIfood && isPrepaid) {
      try {
        if (updated.riderId) {
          await riderAccountService.addDeliveryAndDailyIfNeeded({ companyId: updated.companyId, riderId: updated.riderId, orderId: updated.id, orderDate: updated.updatedAt || new Date() });
        }
      } catch (e) { console.error('[complete/prepaid] rider credit error:', e?.message); }
      try { await createFinancialEntriesForOrder(updated); } catch (e) { console.error('[complete/prepaid] financial error:', e?.message); }
      try {
        const { findMatchingSession } = await import('../services/cash/sessionMatcher.js');
        const s = await findMatchingSession(updated, riderId);
        if (s) await prisma.order.update({ where: { id: updated.id }, data: { cashSessionId: s.id, outOfSession: false } });
        else await prisma.order.update({ where: { id: updated.id }, data: { outOfSession: true } });
      } catch (e) {}
      try { const c = await prisma.affiliateSale.count({ where: { orderId: updated.id } }); if (c === 0) await trackAffiliateSale(updated, updated.companyId); } catch (e) {}
      try { const cb = await import('../services/cashbackService.js').then(m => m.default || m); if (cb.creditWalletForOrder) await cb.creditWalletForOrder(updated); } catch (e) {}
    }

    return res.json({ ok: true, order: updated });
  } catch (e) {
    console.error('Failed to mark order complete', e);
    return res.status(500).json({ message: 'Falha ao marcar pedido como entregue' });
  }
});

// Rider: notify customer that rider has arrived at the address (WhatsApp via Evolution)
ordersRouter.post('/:id/notify-arrival', requireRole('RIDER'), async (req, res) => {
  const { id } = req.params;
  const riderId = req.user.riderId;
  if (!riderId) return res.status(403).json({ message: 'Rider inválido' });

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });
  if (order.riderId !== riderId) return res.status(403).json({ message: 'Pedido não atribuído a este entregador' });

  // Check if notification was already sent (stored in order.payload.riderArrivalNotified)
  const payload = order.payload || {};
  if (payload.riderArrivalNotified) {
    return res.status(409).json({ message: 'Notificação já enviada para este pedido' });
  }

  // Need customer phone
  const phone = order.customerPhone || payload.customerPhone;
  if (!phone) return res.status(400).json({ message: 'Cliente sem telefone cadastrado' });

  try {
    const { pickConnectedInstance } = await import('../services/notify.js');
    const { evoSendText, normalizePhone } = await import('../wa.js');

    const instance = await pickConnectedInstance(order.companyId);
    if (!instance) return res.status(400).json({ message: 'Nenhuma instância WhatsApp conectada' });

    const to = normalizePhone(phone);
    const text = 'Olá! O motoboy se encontra no endereço. Por favor, dirija-se até o entregador para receber seu pedido. 🛵';
    await evoSendText({ instanceName: instance.instanceName, to, text });

    // Mark as notified so it can't be sent again
    await prisma.order.update({
      where: { id },
      data: { payload: { ...payload, riderArrivalNotified: true } },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[orders.notify-arrival] failed', e);
    return res.status(500).json({ message: 'Falha ao enviar notificação' });
  }
});

// Admin: edit order details (customer, address, items, payment, notes)
ordersRouter.patch('/:id', requireRole('ADMIN', 'ATTENDANT', 'STORE'), async (req, res) => {
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
          productId: it.productId || null,
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

// Accept or reject a pending iFood order (PENDENTE_ACEITE -> EM_PREPARO or CANCELADO)
ordersRouter.post('/:id/accept', requireRole('ADMIN', 'ATTENDANT', 'STORE'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  try {
    const order = await prisma.order.findFirst({ where: { id, companyId } });
    if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });
    if (order.status !== 'PENDENTE_ACEITE') return res.status(400).json({ message: 'Pedido não está pendente de aceite' });

    // Confirm on iFood
    let ifoodAcceptResult = null;
    if (order.externalId) {
      try {
        const { getIFoodAccessToken } = await import('../integrations/ifood/oauth.js');
        const token = await getIFoodAccessToken(companyId);
        console.log('[Orders] iFood accept: got token, length:', token ? token.length : 0, 'externalId:', order.externalId);
        const { default: axios } = await import('axios');
        const baseUrl = (process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br').replace(/\/+$/, '');
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        const oid = encodeURIComponent(order.externalId);

        // Step 1: confirm
        try {
          const r1 = await axios.post(`${baseUrl}/order/v1.0/orders/${oid}/confirm`, {}, { headers, timeout: 15000 });
          console.log('[Orders] iFood confirm OK, status:', r1.status);
        } catch (e1) {
          console.warn('[Orders] iFood confirm failed:', e1?.response?.status, JSON.stringify(e1?.response?.data));
          ifoodAcceptResult = { step: 'confirm', status: e1?.response?.status, data: e1?.response?.data };
        }

        // Step 2: startPreparation
        try {
          const r2 = await axios.post(`${baseUrl}/order/v1.0/orders/${oid}/startPreparation`, {}, { headers, timeout: 15000 });
          console.log('[Orders] iFood startPreparation OK, status:', r2.status);
        } catch (e2) {
          console.warn('[Orders] iFood startPreparation failed:', e2?.response?.status, JSON.stringify(e2?.response?.data));
          if (!ifoodAcceptResult) ifoodAcceptResult = { step: 'startPreparation', status: e2?.response?.status, data: e2?.response?.data };
        }

        if (!ifoodAcceptResult) console.log('[Orders] iFood accept OK for', order.externalId);
      } catch (e) {
        console.warn('[Orders] iFood accept failed:', e?.message);
        ifoodAcceptResult = { step: 'auth', error: e?.message };
      }
    } else {
      console.log('[Orders] accept: no externalId, skipping iFood notification');
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: 'EM_PREPARO',
        histories: { create: { from: 'PENDENTE_ACEITE', to: 'EM_PREPARO', byUserId: req.user.id, reason: 'Aceite manual' } },
      },
      include: { items: true, histories: true, rider: true },
    });

    try { const idx = await import('../index.js'); idx.emitirPedidoAtualizado(updated); } catch (e) {}
    tryEmitIfoodChat(updated, 'EM_PREPARO').catch(() => {});
    res.json(updated);
  } catch (e) {
    console.error('[Orders] accept failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// Reject a pending iFood order (PENDENTE_ACEITE -> CANCELADO)
ordersRouter.post('/:id/reject', requireRole('ADMIN', 'ATTENDANT', 'STORE'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  try {
    const order = await prisma.order.findFirst({ where: { id, companyId } });
    if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });
    if (order.status !== 'PENDENTE_ACEITE') return res.status(400).json({ message: 'Pedido não está pendente de aceite' });

    // Cancel on iFood (request cancellation)
    if (order.externalId) {
      try {
        const { getIFoodAccessToken } = await import('../integrations/ifood/oauth.js');
        const token = await getIFoodAccessToken(companyId);
        const { default: axios } = await import('axios');
        const baseUrl = (process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br').replace(/\/+$/, '');
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        const oid = encodeURIComponent(order.externalId);
        await axios.post(`${baseUrl}/order/v1.0/orders/${oid}/requestCancellation`, {
          reason: 'Pedido recusado pelo estabelecimento',
          cancellationCode: '501',
        }, { headers, timeout: 15000 });
        console.log('[Orders] iFood reject OK for', order.externalId);
      } catch (e) {
        console.warn('[Orders] iFood reject failed (continuing):', e?.response?.status, e?.response?.data || e?.message);
      }
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: 'CANCELADO',
        histories: { create: { from: 'PENDENTE_ACEITE', to: 'CANCELADO', byUserId: req.user.id, reason: 'Recusado manualmente' } },
      },
      include: { items: true, histories: true, rider: true },
    });

    try {
      await reverseStockMovementForOrder(prisma, updated.id, req?.user?.id || null);
    } catch (e) {
      console.warn('reverseStockMovementForOrder failed for order', updated.id, e?.message);
    }

    try { const idx = await import('../index.js'); idx.emitirPedidoAtualizado(updated); } catch (e) {}
    res.json(updated);
  } catch (e) {
    console.error('[Orders] reject failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// Admin: patch order status (manual change)
// allow ADMIN and store-level users to change status from the admin panel / PDV
ordersRouter.patch('/:id/status', requireRole('ADMIN', 'ATTENDANT', 'STORE'), async (req, res) => {
  const { id } = req.params;
  const { status, cancellationCode } = req.body || {};
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
      include: { histories: true, rider: true, items: true }
    });

    // notify customer and emit websocket update
    notifyCustomerStatus(updated.id, status).catch(() => {});
    try { const idx = await import('../index.js'); idx.emitirPedidoAtualizado(updated); } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e); }
    tryEmitIfoodChat(updated, status).catch(() => {});

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
            if (type === 'PICKUP' || type === 'TAKEOUT' || type === 'TAKE-OUT' || type === 'TAKEOUT' ) {
              if (t === 'EM_PREPARO') return 'PLACED';
              // For pickup orders, when the PDV marks the order as PRONTO,
              // notify iFood with READY_TO_PICKUP so the customer is informed.
              if (t === 'PRONTO') return 'READY_TO_PICKUP';
              // Payment-confirmation / concluded still map to CONCLUDED
              if (t === 'CONFIRMACAO_PAGAMENTO' || t === 'CONCLUIDO') return 'CONCLUDED';
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
              // iFood requires a valid cancellationCode for cancellation requests.
              // Normalize incoming cancellationCode (accept numeric or reason string) and
              // send both `cancellationCode` (numeric) and `metadata.cancellationReason`.
              let cancellationPayload = {};
              if (target === 'CANCELLED') {
                try {
                  const { normalizeCancellationCode } = await import('../integrations/ifood/cancellationCodes.js');
                  const normalized = normalizeCancellationCode(cancellationCode || null);
                  let safeCode = null;
                  let reason = null;
                  if (normalized) {
                    safeCode = normalized.code;
                    reason = normalized.reason;
                  } else {
                    const raw = cancellationCode == null ? null : String(cancellationCode).trim();
                    const low = raw ? raw.toLowerCase() : '';
                    // treat literal 'undefined'/'null'/'nan' and empty as missing
                    if (raw && !['undefined', 'null', 'nan', ''].includes(low)) {
                      safeCode = raw;
                    }
                  }
                  // Fallback default when nothing provided: use 501 (PROBLEMAS DE SISTEMA)
                  if (!safeCode) {
                    safeCode = '501';
                    reason = reason || 'PROBLEMAS DE SISTEMA';
                    console.log('[orders.patch.status] no valid cancellationCode provided; defaulting to', safeCode);
                  }
                  cancellationPayload.cancellationCode = safeCode;
                  if (reason) cancellationPayload.metadata = { ...(cancellationPayload.metadata || {}), cancellationReason: reason };
                } catch (eNorm) {
                  console.warn('[orders.patch.status] failed to normalize cancellationCode', eNorm && eNorm.message);
                }
              }
              const resp = await updateIFoodOrderStatus(updated.companyId, orderExternalId, target, { merchantId: integ.merchantUuid || integ.merchantId, ...cancellationPayload });
              console.log('Notified iFood of status change for order', orderExternalId, '->', target, 'response:', resp && (resp.ok ? 'ok' : resp));
            } catch (eNotify) {
              console.warn('Failed to notify iFood of status change for', orderExternalId, { message: eNotify?.message || String(eNotify), status: eNotify?.response?.status || null, providerResponse: eNotify?.response?.data || null });
            }
          }
        } catch (eImp) {
          console.warn('Failed to import iFood update function:', eImp && eImp.message);
        }
      }
    } catch (e) { console.warn('iFood notify attempt failed:', e && e.message); }

    // If this order belongs to an AIQFOME integration, notify aiqfome of the status change
    try {
      if (updated.customerSource === 'AIQFOME' && updated.externalId) {
        const { updateAiqfomeOrderStatus } = await import('../integrations/aiqfome/orders.js');
        await updateAiqfomeOrderStatus(companyId, updated.externalId, status);
        console.log('[aiqfome] Notified status change for order', updated.externalId, '->', status);
      }
    } catch (e) { console.warn('[aiqfome] notify attempt failed:', e?.message); }

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
              if (d.neighborhood) candidates.push(d.neighborhood);
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

        const neighs = await prisma.neighborhood.findMany({ where: { companyId: updated.companyId } });

        // Priority 1: use deliveryNeighborhood field stored on the order (set by iFood/AiqFome webhooks)
        if (updated.deliveryNeighborhood) {
          const stored = String(updated.deliveryNeighborhood).trim().toLowerCase();
          const m = neighs.find(n => {
            if (!n || !n.name) return false;
            if (String(n.name).toLowerCase() === stored) return true;
            if (n.aliases) {
              try {
                const arr = Array.isArray(n.aliases) ? n.aliases : JSON.parse(n.aliases);
                if (arr.some(a => String(a || '').toLowerCase() === stored)) return true;
              } catch (e) {}
            }
            return false;
          });
          if (m) neighborhoodName = m.name;
        }

        // Priority 2: fallback — substring search across address text and payload
        if (!neighborhoodName) {
          const addrCandidates = [];
          if (updated.address) addrCandidates.push(String(updated.address));
          const payloadText = extractAddressTextFromPayload(updated.payload);
          if (payloadText) addrCandidates.push(payloadText);

          if (addrCandidates.length) {
            const addrText = addrCandidates.join(' ').toLowerCase();
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
        }

        await riderAccountService.addDeliveryAndDailyIfNeeded({ companyId: updated.companyId, riderId: updated.riderId, orderId: updated.id, neighborhoodName, orderDate: updated.updatedAt || new Date() });
      }
    } catch (e) { console.error('Failed to add rider transaction:', e?.message || e); }

    // Check rider goals on order completion
    if (status === 'CONCLUIDO' && updated.riderId) {
      try {
        const { checkGoalsOnEvent } = await import('../services/riderGoals.js');
        await checkGoalsOnEvent('ORDER_COMPLETED', updated.riderId, updated.companyId);
      } catch (e) { console.warn('[goals] check on order completion failed:', e?.message || e); }
    }

    // If order was completed, attempt to track affiliate commission for coupon owner
    try {
      if (status === 'CONCLUIDO') {
        const existingCount = await prisma.affiliateSale.count({ where: { orderId: updated.id } });
        if (existingCount === 0) {
          try { await trackAffiliateSale(updated, updated.companyId); } catch (afErr) { console.warn('Failed to track affiliate sale on order completion', updated.id, afErr?.message || afErr); }
        }
      }
    } catch (e) { console.error('Error while attempting affiliate tracking on order status change:', e?.message || e); }

    // If order was completed, create financial entries (receivable, fees, deductions)
    try {
      if (status === 'CONCLUIDO') {
        await createFinancialEntriesForOrder(updated);
      }
    } catch (e) { console.error('Failed to create financial entries for order:', e?.message || e); }

    // If order was completed, link to matching cash session
    try {
      if (status === 'CONCLUIDO') {
        const { findMatchingSession, resolveOrderChannel } = await import('../services/cash/sessionMatcher.js');
        const matchedSession = await findMatchingSession(updated, req.user.id);

        if (matchedSession) {
          // Check if payment is immediate (cash/PIX)
          const payments = updated.payload?.paymentConfirmed || [];
          const paymentMethod = updated.payload?.payment?.method || '';
          const isImmediate = payments.length
            ? payments.every(p => /din|pix|cash|money/i.test(p.method))
            : /din|pix|cash|money/i.test(paymentMethod);

          await prisma.order.update({
            where: { id: updated.id },
            data: { cashSessionId: matchedSession.id, outOfSession: false },
          });

          // Update cash session balance for immediate payments
          if (isImmediate) {
            await prisma.cashSession.update({
              where: { id: matchedSession.id },
              data: { currentBalance: { increment: Number(updated.total) } },
            });
          }
        } else {
          // No matching session — mark as out-of-session
          await prisma.order.update({
            where: { id: updated.id },
            data: { outOfSession: true },
          });

          // Alert admins via Socket.IO
          const io = req.app.get('io');
          if (io) {
            io.to(`company_${companyId}`).emit('order:out-of-session', {
              orderId: updated.id,
              displayId: updated.displayId,
              total: updated.total,
              channel: resolveOrderChannel(updated),
            });
          }
        }
      }
    } catch (e) { console.error('[sessionMatcher] Error linking order to session:', e.message); }

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

    // Check rider goals on order cancellation
    if (status === 'CANCELADO' && updated.riderId) {
      try {
        const { checkGoalsOnEvent } = await import('../services/riderGoals.js');
        await checkGoalsOnEvent('ORDER_CANCELLED', updated.riderId, updated.companyId);
      } catch (e) { console.warn('[goals] check on cancellation failed:', e?.message || e); }
    }

    // Reversal of stock movement when order is cancelled (any prior state)
    if (status === 'CANCELADO' && existing.status !== 'CANCELADO') {
      try {
        await reverseStockMovementForOrder(prisma, updated.id, req?.user?.id || null);
      } catch (e) {
        console.warn('reverseStockMovementForOrder failed for order', updated.id, e?.message);
      }
    }

    // Reversal of financial entries when cancelling a completed order
    if (existing.status === 'CONCLUIDO' && status === 'CANCELADO') {
      try {
        const { reverseFinancialEntriesForOrder } = await import('../services/financial/reversalBridge.js');
        const result = await reverseFinancialEntriesForOrder(updated);

        if (result.reversed) {
          const io = req.app.get('io');
          if (io) {
            io.to(`company_${companyId}`).emit('order:reversed', {
              orderId: updated.id,
              displayId: updated.displayId,
              total: updated.total,
              reversedCount: result.count,
            });
          }
        }
      } catch (e) {
        console.error('[orders] reversal bridge error:', e.message);
      }
    }

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
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const order = await prisma.order.findFirst({
      where: { id, companyId },
      include: { items: true, rider: true, company: true, store: true }
    });
    if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });

    // Enrich order items: fetch highlightOnSlip from Product and Option models
    try {
      const productIds = (order.items || []).map(i => i.productId).filter(Boolean);
      const productMap = {};
      if (productIds.length) {
        const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, highlightOnSlip: true } });
        for (const p of products) productMap[p.id] = !!p.highlightOnSlip;
      }
      for (const item of (order.items || [])) {
        if (item.productId && productMap[item.productId]) item.highlightOnSlip = true;
        // options is JSON array with {id, name, price, ...}; enrich with highlightOnSlip from Option model
        if (item.options && Array.isArray(item.options)) {
          const optIds = item.options.map(o => o.id).filter(Boolean);
          if (optIds.length) {
            const opts = await prisma.option.findMany({ where: { id: { in: optIds } }, select: { id: true, highlightOnSlip: true } });
            const map = Object.fromEntries(opts.map(o => [o.id, !!o.highlightOnSlip]));
            for (const o of item.options) { if (o.id && map[o.id]) o.highlightOnSlip = true; }
          }
        }
      }
    } catch (e) { console.warn('Failed to enrich highlightOnSlip for order items', e?.message || e); }

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
  } catch (e) {
    console.error('GET /orders/:id failed', e?.message || e);
    return res.status(500).json({ message: 'Erro ao carregar pedido' });
  }
});

// POST /orders/:id/refresh-ifood — busca detalhes frescos do iFood e atualiza o payload do pedido
ordersRouter.post('/:id/refresh-ifood', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  try {
    const order = await prisma.order.findFirst({ where: { id, companyId } });
    if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });

    const ifoodId = order.externalId || order.payload?.orderId || order.payload?.order?.id || null;
    if (!ifoodId) return res.status(400).json({ message: 'Pedido sem ID do iFood' });

    const { getIFoodOrderDetails } = await import('../integrations/ifood/orders.js');
    const details = await getIFoodOrderDetails(companyId, ifoodId);
    if (!details) return res.status(502).json({ message: 'iFood não retornou detalhes do pedido' });

    const updatedPayload = Object.assign({}, order.payload || {}, { order: details });
    const updated = await prisma.order.update({
      where: { id },
      data: { payload: updatedPayload },
      include: { items: true, rider: true, company: true, store: true },
    });
    return res.json(updated);
  } catch (e) {
    console.error('[refresh-ifood] erro:', e?.message || e);
    return res.status(500).json({ message: 'Erro ao buscar dados do iFood', error: e?.message });
  }
});

// PDV create route (previously the opening wrapper was missing)
ordersRouter.post('/', requireRole('ADMIN', 'ATTENDANT'), async (req, res) => {
  const companyId = req.user.companyId;
  try {
    // Aceitar tanto `type` (legado) quanto `orderType` (frontend atual)
    const { items = [], address: _rawAddress = {}, coupon, payment, type: _type, orderType: _orderType, customerPhone, customerName, requestedStoreId, discountMerchant: _discountMerchant, additionalFees: _additionalFees } = req.body || {};
    const type = _type || _orderType;
    // address pode chegar como objeto {street,number,...} ou como string formatada (finalize envia string quando persiste no cliente)
    const address = typeof _rawAddress === 'string'
      ? { formatted: _rawAddress }
      : (_rawAddress || {});

    // Dev: log a compact summary to help debug PDV create 500s (safe, non-sensitive fields)
    try { console.log('PDV create payload summary:', { type, customerPhone, customerName, itemsCount: Array.isArray(items) ? items.length : 0, addressProvided: address && Object.keys(address).length > 0 }); } catch (e) {}

    const orderType = String(type || '').toUpperCase();
    const neigh = String(address?.neighborhood || address?.neigh || '').trim();
    const street = String(address?.street || address?.formatted || '').trim();
    // Validar apenas se não houver nenhum dado de endereço (formatted também é aceito)
    const hasAddress = street || neigh || address?.formatted;
    if (orderType === 'DELIVERY' && !hasAddress) return res.status(400).json({ message: 'Endereço obrigatório para entrega' });

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

    // Apply free delivery when subtotal meets the configured threshold
    if (deliveryFee > 0) {
      try {
        const comp = await prisma.company.findUnique({ where: { id: companyId }, select: { freeDeliveryEnabled: true, freeDeliveryMinOrder: true } });
        if (comp?.freeDeliveryEnabled && comp?.freeDeliveryMinOrder != null && subtotal >= Number(comp.freeDeliveryMinOrder)) {
          deliveryFee = 0;
        }
      } catch(e) { /* non-blocking */ }
    }

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
        // Fallback: use first store of the company (all orders must have a storeId)
        resolvedStore = await prisma.store.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
        if (resolvedStore) console.log('PDV: storeId não informado, usando primeira loja:', resolvedStore.id);
      }
    } catch (e) { /* ignore */ }

    // normalize delivery address into a consistent shape and persist it under payload.delivery.deliveryAddress
    const normalizedDelivery = (type === 'DELIVERY' && address && Object.keys(address).length) ? normalizeDeliveryAddressFromPayload({ delivery: { deliveryAddress: address } }) : null;
    const pdvDenormNeighborhood = (normalizedDelivery && normalizedDelivery.neighborhood) || (address && (address.neighborhood || address.neigh)) || null;

    const displaySimple = await nextDisplaySimple(companyId);
    const created = await prisma.order.create({
      data: {
        companyId,
        displaySimple,
        customerSource: 'MANUAL',
        customerId: persistedCustomer ? persistedCustomer.id : undefined,
        customerName: customerName || (persistedCustomer ? persistedCustomer.fullName : null),
        customerPhone: customerPhone || (persistedCustomer ? (persistedCustomer.whatsapp || persistedCustomer.phone) : null),
        address: type === 'DELIVERY' ? (buildConcatenatedAddress({ delivery: { deliveryAddress: address } }) || (normalizedDelivery && normalizedDelivery.formattedAddress) || (address.formatted || [address.street, address.number].filter(Boolean).join(', '))) : null,
        deliveryNeighborhood: pdvDenormNeighborhood || (normalizedDelivery && normalizedDelivery.neighborhood) || null,
        total,
        couponCode,
        couponDiscount: Number(couponDiscount || 0),
        discountMerchant: _discountMerchant != null && Number(_discountMerchant) > 0 ? Number(_discountMerchant) : undefined,
        additionalFees: _additionalFees != null && Number(_additionalFees) > 0 ? Number(_additionalFees) : undefined,
        orderType: type,
        deliveryFee,
        status: 'EM_PREPARO',
        ...(resolvedStore ? { storeId: resolvedStore.id } : {}),
        payload: {
          payment: paymentPayload,
          orderType: type,
          rawPayload: { source: 'PDV', items: cleanItems, customer: { name: customerName || null, contact: customerPhone || null }, address: (orderType === 'DELIVERY' && address && Object.keys(address).length > 0) ? address : null },
          // persist normalized delivery address for consistency across flows
          delivery: normalizedDelivery ? { deliveryAddress: normalizedDelivery } : (address && Object.keys(address).length ? { deliveryAddress: normalizeDeliveryAddressFromPayload({ delivery: { deliveryAddress: address } }) } : undefined),
          // persist computed and chosen totals for clarity
          computedTotal: computedTotal,
          total: total
        },
        items: {
          create: cleanItems.map(it => ({ ...(it.productId ? { productId: it.productId } : {}), name: it.name, quantity: it.quantity, price: it.price, notes: it.notes, options: it.options || null }))
        },
        histories: { create: { from: null, to: 'EM_PREPARO', byUserId: req.user.id, reason: 'Criação PDV' } }
      },
      include: { items: true, histories: true }
    });

    // Check if there's an open cash session — mark outOfSession if not
    try {
      const { findMatchingSession } = await import('../services/cash/sessionMatcher.js');
      const matchedSession = await findMatchingSession(created, req.user.id);
      if (matchedSession) {
        await prisma.order.update({ where: { id: created.id }, data: { cashSessionId: matchedSession.id, outOfSession: false } });
        created.cashSessionId = matchedSession.id;
        created.outOfSession = false;
      } else {
        await prisma.order.update({ where: { id: created.id }, data: { outOfSession: true } });
        created.outOfSession = true;
      }
    } catch (e) { console.warn('[orders.create] cash session check failed:', e?.message); }

    // Async geocode if order has address but no coordinates (PDV orders)
    if (created.address && created.latitude == null) {
      geocodeOrderIfNeeded(created.id).catch(() => {});
    }

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

    // Send order summary to customer (best-effort, non-blocking)
    try { notifyCustomerOrderSummary(created.id).catch(() => {}); } catch (e) { /* ignore */ }

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

// Retroactively fix rider delivery fees for completed orders where neighborhood was not matched
// (i.e., DELIVERY_FEE transactions with amount = 0 that can now be matched)
// Body: { dryRun?: boolean, startDate?: string, endDate?: string }
ordersRouter.post('/retroactive-rider-fees', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { dryRun = false, startDate, endDate } = req.body || {};

  try {
    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) {
      // include the full end day
      const end = new Date(endDate);
      end.setDate(end.getDate() + 1);
      dateFilter.lte = end;
    }

    // Fetch all completed orders with a rider for this company in the date range
    const orders = await prisma.order.findMany({
      where: {
        companyId,
        status: 'CONCLUIDO',
        riderId: { not: null },
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
      select: {
        id: true,
        riderId: true,
        deliveryNeighborhood: true,
        address: true,
        payload: true,
        createdAt: true,
        riderTransactions: {
          where: { type: 'DELIVERY_FEE' },
          select: { id: true, amount: true },
        },
      },
    });

    // Only keep orders that have no DELIVERY_FEE transaction OR have one with amount <= 0
    const candidates = orders.filter(o =>
      o.riderTransactions.length === 0 || o.riderTransactions.some(t => Number(t.amount) <= 0)
    );

    // Load all neighborhoods once to avoid N+1
    const allNeighs = await prisma.neighborhood.findMany({ where: { companyId } });

    function matchNeighborhood(deliveryNeighborhood, address, payload) {
      if (deliveryNeighborhood) {
        const needle = String(deliveryNeighborhood).trim().toLowerCase();
        const m = allNeighs.find(n => {
          if (!n?.name) return false;
          if (String(n.name).trim().toLowerCase() === needle) return true;
          if (n.aliases) {
            try {
              const arr = Array.isArray(n.aliases) ? n.aliases : JSON.parse(n.aliases);
              return arr.some(a => String(a || '').trim().toLowerCase() === needle);
            } catch (e) { return false; }
          }
          return false;
        });
        if (m) return m;
      }

      const addrCandidates = [];
      if (address) addrCandidates.push(String(address));
      try {
        const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
        // Handle both iFood wrapper format (p.order.delivery) and flat format (p.delivery)
        const d = p?.order?.delivery?.deliveryAddress || p?.delivery?.deliveryAddress || null;
        if (d) {
          if (d.neighborhood) addrCandidates.push(d.neighborhood);
          if (d.formattedAddress) addrCandidates.push(d.formattedAddress);
          if (d.formatted_address) addrCandidates.push(d.formatted_address);
          if (d.streetName) addrCandidates.push(d.streetName);
        }
      } catch (e) {}
      if (!addrCandidates.length) return null;

      const addrText = addrCandidates.join(' ').toLowerCase();
      return allNeighs.find(n => {
        if (!n?.name) return false;
        const name = String(n.name).toLowerCase();
        if (addrText.includes(name)) return true;
        if (n.aliases) {
          try {
            const arr = Array.isArray(n.aliases) ? n.aliases : JSON.parse(n.aliases);
            return arr.some(a => addrText.includes(String(a || '').toLowerCase()));
          } catch (e) { return false; }
        }
        return false;
      }) || null;
    }

    const results = [];
    let totalCredited = 0;

    for (const order of candidates) {
      const neigh = matchNeighborhood(order.deliveryNeighborhood, order.address, order.payload);
      const riderFee = neigh ? Number(neigh.riderFee || 0) : 0;
      const existingTxn = order.riderTransactions.find(t => Number(t.amount) <= 0) || null;

      results.push({
        orderId: order.id,
        transactionId: existingTxn?.id || null,
        riderId: order.riderId,
        deliveryNeighborhood: order.deliveryNeighborhood,
        matchedNeighborhood: neigh?.name || null,
        riderFee,
        willCredit: riderFee > 0,
        missingTransaction: !existingTxn,
      });

      if (!dryRun && riderFee > 0) {
        if (existingTxn) {
          // Update existing zero-value transaction
          await prisma.$transaction([
            prisma.riderTransaction.update({
              where: { id: existingTxn.id },
              data: { amount: riderFee, note: `Taxa de entrega - ${neigh.name} (retroativo)` },
            }),
            prisma.riderAccount.upsert({
              where: { riderId: order.riderId },
              update: { balance: { increment: riderFee } },
              create: { riderId: order.riderId, balance: riderFee },
            }),
          ]);
        } else {
          // Create missing transaction from scratch
          await prisma.$transaction([
            prisma.riderTransaction.create({
              data: {
                riderId: order.riderId,
                orderId: order.id,
                type: 'DELIVERY_FEE',
                amount: riderFee,
                date: order.createdAt || new Date(),
                note: `Taxa de entrega - ${neigh.name} (retroativo)`,
              },
            }),
            prisma.riderAccount.upsert({
              where: { riderId: order.riderId },
              update: { balance: { increment: riderFee } },
              create: { riderId: order.riderId, balance: riderFee },
            }),
          ]);
        }
      }

      if (riderFee > 0) totalCredited += riderFee;
    }

    return res.json({
      dryRun: !!dryRun,
      checked: candidates.length,
      corrected: results.filter(r => r.willCredit).length,
      skipped: results.filter(r => !r.willCredit).length,
      totalCredited,
      results,
    });
  } catch (e) {
    console.error('[retroactive-rider-fees] error:', e?.message || e);
    return res.status(500).json({ message: 'Erro ao processar taxas retroativas', error: e?.message });
  }
});
