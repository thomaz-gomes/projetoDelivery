import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';
import { sha256 } from '../utils.js';
import { notifyRiderAssigned, notifyCustomerStatus } from '../services/notify.js';
import { emitirPedidoAtualizado } from '../index.js';

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
      const now = new Date();
      console.log('[tickets.claim] incoming token:', token, 'tokenHash:', tokenHash, 'now:', now.toISOString(), 'riderId:', riderId);
      // Allow tickets that either have no expiresAt (non-expiring) or whose expiresAt is in the future
      const ticket = await tx.ticket.findFirst({
        where: {
          tokenHash,
          usedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
          ]
        },
        include: { order: true },
      });
      // If not found by tokenHash, allow a fallback where the provided value
      // is actually an orderId (some printed QR codes may embed the order id).
      let ticketFinal = ticket;
      if (!ticketFinal) {
        const alt = await tx.ticket.findFirst({
          where: {
            orderId: token,
            usedAt: null,
            OR: [ { expiresAt: null }, { expiresAt: { gt: now } } ]
          },
          include: { order: true }
        });
        if (alt) {
          console.log('[tickets.claim] fallback: found ticket by orderId', alt.id, 'orderId:', alt.orderId);
          ticketFinal = alt;
        }
      }
      if (!ticketFinal) throw new Error('Token inválido ou expirado');
      console.log('[tickets.claim] ticket lookup result:', !!ticket, ticket && { id: ticket.id, orderId: ticket.orderId, expiresAt: ticket.expiresAt, usedAt: ticket.usedAt });

      if (!ticket) throw new Error('Token inválido ou expirado');

      if (ticketFinal.order.companyId !== rider.companyId) {
        throw new Error('Empresa não corresponde');
      }

      const updatedOrder = await tx.order.update({
        where: { id: ticketFinal.orderId },
        data: {
          riderId: rider.id,
          status: 'SAIU_PARA_ENTREGA',
          histories: {
            create: {
              from: ticketFinal.order.status,
              to: 'SAIU_PARA_ENTREGA',
              byRiderId: rider.id,
              reason: 'QR claim',
            },
          },
        },
        include: { items: true, rider: true },
      });

      await tx.ticket.update({
        where: { id: ticketFinal.id },
        data: { usedAt: new Date() },
      });

      return updatedOrder;
    });

  // resposta imediata
  res.json({ ok: true, order: result });

  // Emit socket event so the admin panel updates immediately
  try { emitirPedidoAtualizado(result); } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e); }

  // notificações assíncronas (não bloqueiam a resposta)
  notifyRiderAssigned(result.id).catch(() => {});
  notifyCustomerStatus(result.id, 'SAIU_PARA_ENTREGA').catch(() => {});
  // If this order belongs to an IFOOD integration, notify iFood that it was dispatched
  (async () => {
    try {
      const integ = await prisma.apiIntegration.findFirst({ where: { companyId: result.companyId, provider: 'IFOOD', enabled: true } });
      if (!integ) return;
      // determine external iFood order id from order.externalId or payload
      const orderExternalId = result.externalId || (result.payload && (result.payload.orderId || (result.payload.order && result.payload.order.id)));
      if (!orderExternalId) {
        console.warn('[tickets.claim] no externalId found on order; skipping iFood dispatch notify', { orderId: result.id });
        return;
      }
      const { updateIFoodOrderStatus } = await import('../integrations/ifood/orders.js');
      try {
        await updateIFoodOrderStatus(result.companyId, orderExternalId, 'DISPATCHED', { merchantId: integ.merchantUuid || integ.merchantId, fullCode: 'DISPATCHED' });
        console.log('[tickets.claim] notified iFood of dispatch for order', orderExternalId);
      } catch (e) {
        console.warn('[tickets.claim] failed to notify iFood of dispatch', { orderExternalId, err: e?.message || e });
      }
    } catch (e) {
      console.error('[tickets.claim] error while attempting iFood notify', e?.message || e);
    }
  })();
  } catch (e) {
    res.status(400).json({ message: e.message || 'Falha ao atribuir pedido' });
  }
});