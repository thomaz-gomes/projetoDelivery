import { prisma } from '../prisma.js';

/**
 * Compute the next per-day sequential number for a new order.
 * Returns an integer (e.g. 1, 2, 3...) to persist as displaySimple.
 */
export async function nextDisplaySimple(companyId) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const count = await prisma.order.count({
    where: { companyId, createdAt: { gte: startOfDay } },
  });
  return count + 1;
}
