import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware } from '../../auth.js';

const router = express.Router();
router.use(authMiddleware);

function parseDateRange(query) {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = query.dateFrom ? new Date(query.dateFrom) : firstDay;
  const to = query.dateTo ? new Date(query.dateTo) : new Date();
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function channelLabel(orderType) {
  const t = String(orderType || '').toUpperCase();
  if (t === 'DELIVERY') return 'Delivery';
  if (t === 'PICKUP') return 'Retirada';
  return 'Balcão';
}

// GET /reports/revenue/summary
router.get('/summary', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { from, to } = parseDateRange(req.query);

    const orderWhere = {
      companyId,
      status: { not: 'CANCELADO' },
      createdAt: { gte: from, lte: to },
    };
    if (req.query.storeId) orderWhere.storeId = req.query.storeId;

    const orders = await prisma.order.findMany({
      where: orderWhere,
      select: { total: true, orderType: true },
    });

    const channels = {
      Delivery: { total: 0, count: 0 },
      Retirada: { total: 0, count: 0 },
      'Balcão': { total: 0, count: 0 },
    };
    let totalRevenue = 0;

    for (const o of orders) {
      const t = Number(o.total || 0);
      totalRevenue += t;
      const ch = channelLabel(o.orderType);
      channels[ch].total += t;
      channels[ch].count++;
    }

    const totalOrders = orders.length;
    const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const byChannel = Object.entries(channels).map(([name, d]) => ({
      name,
      totalRevenue: d.total,
      orderCount: d.count,
      avgTicket: d.count > 0 ? d.total / d.count : 0,
    }));

    res.json({
      totalRevenue,
      totalOrders,
      avgTicket,
      avgDelivery: channels['Delivery'].count > 0 ? channels['Delivery'].total / channels['Delivery'].count : 0,
      avgPickup: channels['Retirada'].count > 0 ? channels['Retirada'].total / channels['Retirada'].count : 0,
      avgBalcao: channels['Balcão'].count > 0 ? channels['Balcão'].total / channels['Balcão'].count : 0,
      byChannel,
    });
  } catch (e) {
    console.error('GET /reports/revenue/summary error:', e);
    res.status(500).json({ message: 'Erro ao buscar resumo de faturamento', error: e?.message });
  }
});

// GET /reports/revenue/by-day
router.get('/by-day', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { from, to } = parseDateRange(req.query);

    const orderWhere = {
      companyId,
      status: { not: 'CANCELADO' },
      createdAt: { gte: from, lte: to },
    };
    if (req.query.storeId) orderWhere.storeId = req.query.storeId;

    const orders = await prisma.order.findMany({
      where: orderWhere,
      select: { total: true, orderType: true, createdAt: true },
    });

    const byDate = {};
    for (const o of orders) {
      const dateKey = o.createdAt.toISOString().slice(0, 10);
      const ch = channelLabel(o.orderType);
      if (!byDate[dateKey]) byDate[dateKey] = { Delivery: 0, Retirada: 0, 'Balcão': 0, Total: 0 };
      const t = Number(o.total || 0);
      byDate[dateKey][ch] += t;
      byDate[dateKey].Total += t;
    }

    const labels = [];
    const d = new Date(from);
    while (d <= to) {
      labels.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }

    const series = {
      Total: labels.map(dt => byDate[dt]?.Total || 0),
      Delivery: labels.map(dt => byDate[dt]?.Delivery || 0),
      Retirada: labels.map(dt => byDate[dt]?.Retirada || 0),
      'Balcão': labels.map(dt => byDate[dt]?.['Balcão'] || 0),
    };

    res.json({ labels, series });
  } catch (e) {
    console.error('GET /reports/revenue/by-day error:', e);
    res.status(500).json({ message: 'Erro ao buscar faturamento por dia', error: e?.message });
  }
});

export default router;
