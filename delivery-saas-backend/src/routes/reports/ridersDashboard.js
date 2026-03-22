import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware } from '../../auth.js';

const router = express.Router();
router.use(authMiddleware);

function parseDateRange(query) {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = query.from ? new Date(query.from) : firstDay;
  const to = query.to ? new Date(query.to) : new Date();
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

// GET /reports/riders-dashboard
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { from, to } = parseDateRange(req.query);
    const riderId = req.query.riderId || null;

    // Find all completed orders in the period that had a rider assigned
    const orderWhere = {
      companyId,
      status: 'CONCLUIDO',
      riderId: riderId ? riderId : { not: null },
      createdAt: { gte: from, lte: to },
    };

    const orders = await prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        riderId: true,
        rider: { select: { id: true, name: true } },
        histories: {
          where: {
            to: { in: ['SAIU_PARA_ENTREGA', 'CONFIRMACAO_PAGAMENTO', 'CONCLUIDO'] },
          },
          select: { to: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // Calculate delivery times per order
    const riderMap = {}; // riderId -> { name, times: [minutes], deliveries: count }

    for (const order of orders) {
      if (!order.rider) continue;

      const departed = order.histories.find(h => h.to === 'SAIU_PARA_ENTREGA');
      // Use the first status after departure: CONFIRMACAO_PAGAMENTO or CONCLUIDO
      const completed = order.histories.find(h => h.to === 'CONFIRMACAO_PAGAMENTO')
        || order.histories.find(h => h.to === 'CONCLUIDO');

      if (!departed || !completed) continue;

      const diffMs = new Date(completed.createdAt) - new Date(departed.createdAt);
      const diffMin = diffMs / 60000;

      // Skip negative or absurdly large values (> 24h)
      if (diffMin <= 0 || diffMin > 1440) continue;

      if (!riderMap[order.rider.id]) {
        riderMap[order.rider.id] = { name: order.rider.name, times: [], deliveries: 0 };
      }
      riderMap[order.rider.id].times.push(diffMin);
      riderMap[order.rider.id].deliveries++;
    }

    // Build per-rider stats
    const avgDeliveryTimeByRider = Object.entries(riderMap).map(([id, data]) => {
      const avg = data.times.reduce((a, b) => a + b, 0) / data.times.length;
      return {
        riderId: id,
        riderName: data.name,
        avgTime: Math.round(avg * 10) / 10,
        totalDeliveries: data.deliveries,
      };
    }).sort((a, b) => b.totalDeliveries - a.totalDeliveries);

    // Overall average
    const allTimes = Object.values(riderMap).flatMap(d => d.times);
    const avgDeliveryTime = allTimes.length
      ? Math.round((allTimes.reduce((a, b) => a + b, 0) / allTimes.length) * 10) / 10
      : 0;
    const totalDeliveries = allTimes.length;

    // Cost calculation from RiderTransaction
    const costWhere = {
      rider: { companyId },
      type: { in: ['DELIVERY_FEE', 'DAILY_RATE'] },
      date: { gte: from, lte: to },
    };
    if (riderId) costWhere.riderId = riderId;

    const costAgg = await prisma.riderTransaction.aggregate({
      where: costWhere,
      _sum: { amount: true },
    });

    const totalCost = Number(costAgg._sum.amount || 0);
    const avgCostPerDelivery = totalDeliveries > 0
      ? Math.round((totalCost / totalDeliveries) * 100) / 100
      : 0;

    // Per-rider cost
    if (avgDeliveryTimeByRider.length > 0) {
      const riderCosts = await prisma.riderTransaction.groupBy({
        by: ['riderId'],
        where: costWhere,
        _sum: { amount: true },
      });
      const costMap = {};
      for (const rc of riderCosts) {
        costMap[rc.riderId] = Number(rc._sum.amount || 0);
      }
      for (const r of avgDeliveryTimeByRider) {
        const rCost = costMap[r.riderId] || 0;
        r.avgCost = r.totalDeliveries > 0
          ? Math.round((rCost / r.totalDeliveries) * 100) / 100
          : 0;
      }
    }

    res.json({
      avgDeliveryTime,
      totalDeliveries,
      avgCostPerDelivery,
      avgDeliveryTimeByRider,
    });
  } catch (err) {
    console.error('riders-dashboard error:', err);
    res.status(500).json({ message: 'Erro ao gerar dashboard de entregadores' });
  }
});

export default router;
