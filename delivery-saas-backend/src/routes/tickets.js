import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';
import { sha256 } from '../utils.js';
import { notifyRiderAssigned, notifyCustomerStatus } from '../services/notify.js';

export const ticketsRouter = express.Router();

/**
 * Claim de comanda via QR:
 * - valida token
 * - garante que o rider é da mesma empresa do pedido
 * - atribui rider ao pedido
 * - muda status para SAIU_PARA_ENTREGA
 * - grava histórico
 * - marca ticket como usado
 * - dispara notificações (rider e cliente)
 */
ticketsRouter.post('/:token/claim', authMiddleware, requireRole('RIDER'), async (req, res) => {
  const { token } = req.params;
  const tokenHash = sha256(token);

  const riderId = req.user.riderId;
  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider) return res.status(400).json({ message: 'Rider inválido' });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: {
          tokenHash,
          usedAt: null,
          // se utilizar expiração opcional, considere also: OR de expiresAt null
          expiresAt: { gt: new Date() },
        },
        include: { order: true },
      });

      if (!ticket) throw new Error('Token inválido ou expirado');

      if (ticket.order.companyId !== rider.companyId) {
        throw new Error('Empresa não corresponde');
      }

      const updatedOrder = await tx.order.update({
        where: { id: ticket.orderId },
        data: {
          riderId: rider.id,
          status: 'SAIU_PARA_ENTREGA',
          histories: {
            create: {
              from: ticket.order.status,
              to: 'SAIU_PARA_ENTREGA',
              byRiderId: rider.id,
              reason: 'QR claim',
            },
          },
        },
        include: { items: true, rider: true },
      });

      await tx.ticket.update({
        where: { id: ticket.id },
        data: { usedAt: new Date() },
      });

      return updatedOrder;
    });

    // resposta imediata
    res.json({ ok: true, order: result });

    // notificações assíncronas (não bloqueiam a resposta)
    notifyRiderAssigned(result.id).catch(() => {});
    notifyCustomerStatus(result.id, 'SAIU_PARA_ENTREGA').catch(() => {});
  } catch (e) {
    res.status(400).json({ message: e.message || 'Falha ao atribuir pedido' });
  }
});