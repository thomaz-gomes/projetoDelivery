import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware } from '../../auth.js';
import { startOfDayInTz, endOfDayInTz, dayKeyInTz } from '../../utils/dateTz.js';

const router = express.Router();
router.use(authMiddleware);

const DEFAULT_TZ = 'America/Sao_Paulo';

async function getCompanyTimezone(companyId) {
  try {
    const c = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    return c?.timezone || DEFAULT_TZ;
  } catch (e) {
    return DEFAULT_TZ;
  }
}

function parseDateRange(query, tz) {
  const todayKey = dayKeyInTz(new Date(), tz);
  const defaultFromKey = `${todayKey.slice(0, 7)}-01`;
  const fromStr = String(query.from || defaultFromKey);
  const toStr = String(query.to || todayKey);
  return { from: startOfDayInTz(fromStr, tz), to: endOfDayInTz(toStr, tz) };
}

// GET /reports/riders-dashboard
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const tz = await getCompanyTimezone(companyId);
    const { from, to } = parseDateRange(req.query, tz);
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
      // Prefer CONFIRMACAO_PAGAMENTO (rider confirmed at delivery) over CONCLUIDO
      // (iFood prepaid CONCLUIDO comes via webhook, not rider action)
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

    // Absolute count of completed orders with riders (includes orders without timing data)
    const totalCompletedWithRider = await prisma.order.count({ where: orderWhere });
    // "Concluído com código": apenas pedidos cujo motoboy digitou o código de
    // entrega no app do iFood (evento DDCS). A flag closedByIfoodCode é setada
    // exclusivamente em DELIVERY_DROP_CODE_VALIDATION_SUCCESS; CONCLUDED/CON
    // genéricos (auto-finalização do iFood, takeout, etc.) NÃO marcam a flag.
    const completedWithCode = await prisma.order.count({
      where: { ...orderWhere, closedByIfoodCode: true },
    });
    const completedWithCodePct = totalCompletedWithRider > 0
      ? Math.round((completedWithCode / totalCompletedWithRider) * 1000) / 10
      : 0;

    // Cancelled orders that had a rider and were dispatched (SAIU_PARA_ENTREGA)
    const cancelledAfterDispatch = await prisma.order.count({
      where: {
        companyId,
        status: 'CANCELADO',
        riderId: riderId ? riderId : { not: null },
        createdAt: { gte: from, lte: to },
        histories: { some: { to: 'SAIU_PARA_ENTREGA' } },
      },
    });

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
      totalCompletedWithRider,
      completedWithCode,
      completedWithCodePct,
      cancelledAfterDispatch,
    });
  } catch (err) {
    console.error('riders-dashboard error:', err);
    res.status(500).json({ message: 'Erro ao gerar dashboard de entregadores' });
  }
});

export default router;
