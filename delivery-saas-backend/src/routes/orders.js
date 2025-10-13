import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';
import { canTransition } from '../stateMachine.js';
import { notifyRiderAssigned, notifyCustomerStatus } from '../services/notify.js';

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
    include: { items: true, rider: true }
  });

  res.json(orders);
});

ordersRouter.patch('/:id/status', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const allowed = ['EM_PREPARO', 'SAIU_PARA_ENTREGA', 'CONCLUIDO', 'CANCELADO'];
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Status inválido' });

  const updated = await prisma.order.update({
    where: { id },
    data: { status },
  });

  // notificar cliente (stub pronto)
  notifyCustomerStatus(updated.id, status).catch(() => {});

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

  const order = await prisma.order.update({
    where: { id },
    data,
  });

  // notifica o rider (usa rider.phone ou o override riderPhone)
  notifyRiderAssigned(order.id, { overridePhone: riderPhone }).catch(() => {});

  // notifica cliente (stub)
  const newStatus = data.status || order.status;
  notifyCustomerStatus(order.id, newStatus).catch(() => {});

  return res.json({ ok: true, order });
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

  const qrUrl = `${process.env.PUBLIC_FRONTEND_URL}/claim/${token}`;
  res.json({ qrUrl });
});

// GET /orders/:id - detalhe do pedido (inclui items, rider e payload)
ordersRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  const order = await prisma.order.findFirst({
    where: { id, companyId },
    include: { items: true, rider: true, company: true }
  });
  if (!order) return res.status(404).json({ message: 'Pedido não encontrado' });

  res.json(order);
});
