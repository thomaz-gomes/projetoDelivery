import { prisma } from '../../prisma.js';

/**
 * Identifies order channel based on source.
 */
export function resolveOrderChannel(order) {
  const source = order.customerSource?.toUpperCase();
  if (source === 'IFOOD') return 'IFOOD';
  if (source === 'AIQFOME') return 'AIQFOME';

  const payloadSource = order.payload?.source?.toLowerCase();
  if (payloadSource === 'whatsapp') return 'WHATSAPP';

  return 'BALCAO';
}

/**
 * Finds an open CashSession matching the order's channel and store.
 * Prioritizes session where the logged-in user is owner or operator.
 */
export async function findMatchingSession(order, userId) {
  const channel = resolveOrderChannel(order);
  const companyId = order.companyId;

  const where = {
    companyId,
    status: 'OPEN',
    channels: { has: channel },
  };

  // If order has a store, filter by sessions covering that store
  if (order.storeId) {
    where.stores = { some: { storeId: order.storeId } };
  }

  const candidates = await prisma.cashSession.findMany({
    where,
    include: { operators: true },
  });

  if (candidates.length === 0) return null;

  // Prioritize session of the user (owner or operator)
  const userSession = candidates.find(
    s => s.ownerId === userId || s.operators.some(op => op.userId === userId)
  );

  return userSession || candidates[0];
}
