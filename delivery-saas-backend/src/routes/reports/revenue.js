import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware } from '../../auth.js';
import { startOfDayInTz, endOfDayInTz, dayKeyInTz, listDayKeysInTz } from '../../utils/dateTz.js';

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

/**
 * Resolves the date-range filter from frontend `<input type="date">` strings
 * (YYYY-MM-DD) into UTC Date instants honoring the company's timezone.
 * Without this, the container's UTC clock would shift the window by 3h for
 * Brazilian merchants — orders from 21:00–23:59 BRT would slip into the next
 * day's totals.
 */
function parseDateRange(query, tz) {
  const todayKey = dayKeyInTz(new Date(), tz);
  const firstDayKey = `${todayKey.slice(0, 7)}-01`;
  const fromKey = String(query.dateFrom || firstDayKey);
  const toKey = String(query.dateTo || todayKey);
  return {
    from: startOfDayInTz(fromKey, tz),
    to: endOfDayInTz(toKey, tz),
    fromKey,
    toKey,
  };
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
    const tz = await getCompanyTimezone(companyId);
    const { from, to } = parseDateRange(req.query, tz);

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
      timezone: tz,
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
    const tz = await getCompanyTimezone(companyId);
    const { from, to, fromKey, toKey } = parseDateRange(req.query, tz);

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
      const dateKey = dayKeyInTz(o.createdAt, tz);
      const ch = channelLabel(o.orderType);
      if (!byDate[dateKey]) byDate[dateKey] = { Delivery: 0, Retirada: 0, 'Balcão': 0, Total: 0 };
      const t = Number(o.total || 0);
      byDate[dateKey][ch] += t;
      byDate[dateKey].Total += t;
    }

    const labels = listDayKeysInTz(fromKey, toKey, tz);

    const series = {
      Total: labels.map(dt => byDate[dt]?.Total || 0),
      Delivery: labels.map(dt => byDate[dt]?.Delivery || 0),
      Retirada: labels.map(dt => byDate[dt]?.Retirada || 0),
      'Balcão': labels.map(dt => byDate[dt]?.['Balcão'] || 0),
    };

    res.json({ labels, series, timezone: tz });
  } catch (e) {
    console.error('GET /reports/revenue/by-day error:', e);
    res.status(500).json({ message: 'Erro ao buscar faturamento por dia', error: e?.message });
  }
});

export default router;
