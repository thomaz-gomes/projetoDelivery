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

// Abordagem em dois passos: busca ordens -> busca itens
// Evita problemas com filtros em relações aninhadas no Prisma
async function fetchItems(companyId, from, to, storeId) {
  const orderWhere = {
    companyId,
    status: { in: ['CONCLUIDO', 'INVOICE_AUTHORIZED'] },
    createdAt: { gte: from, lte: to },
  };
  if (storeId) orderWhere.storeId = storeId;

  const orders = await prisma.order.findMany({
    where: orderWhere,
    select: { id: true, createdAt: true },
  });

  if (!orders.length) return [];

  const orderIds = orders.map((o) => o.id);
  const createdAtMap = Object.fromEntries(orders.map((o) => [o.id, o.createdAt]));

  const items = await prisma.orderItem.findMany({
    where: { orderId: { in: orderIds } },
    select: { name: true, price: true, quantity: true, orderId: true },
  });

  return items.map((item) => ({
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    order: { createdAt: createdAtMap[item.orderId] },
  }));
}

// GET /reports/products/debug - diagnóstico (remover após uso)
router.get('/debug', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { from, to } = parseDateRange(req.query);

    const [totalOrders, completedOrders, anyItems] = await Promise.all([
      prisma.order.count({ where: { companyId } }),
      prisma.order.count({
        where: {
          companyId,
          status: { in: ['CONCLUIDO', 'INVOICE_AUTHORIZED'] },
          createdAt: { gte: from, lte: to },
        },
      }),
      prisma.orderItem.count({}),
    ]);

    const sampleOrders = await prisma.order.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, status: true, createdAt: true },
    });

    res.json({
      companyId,
      dateRange: { from, to },
      totalOrdersInCompany: totalOrders,
      completedOrdersInRange: completedOrders,
      totalOrderItemsInDB: anyItems,
      last5Orders: sampleOrders,
    });
  } catch (e) {
    res.status(500).json({ message: e?.message, stack: e?.stack });
  }
});

// GET /reports/products/top-by-count
router.get('/top-by-count', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { from, to } = parseDateRange(req.query);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const items = await fetchItems(companyId, from, to, req.query.storeId);

    const grouped = {};
    for (const item of items) {
      const name = item.name;
      if (!grouped[name]) grouped[name] = { name, quantity: 0 };
      grouped[name].quantity += Number(item.quantity);
    }

    const result = Object.values(grouped)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit);

    res.json(result);
  } catch (e) {
    console.error('GET /reports/products/top-by-count error:', e);
    res.status(500).json({ message: 'Erro ao buscar produtos mais vendidos', error: e?.message });
  }
});

// GET /reports/products/top-by-revenue
router.get('/top-by-revenue', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { from, to } = parseDateRange(req.query);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const items = await fetchItems(companyId, from, to, req.query.storeId);

    const grouped = {};
    for (const item of items) {
      const name = item.name;
      if (!grouped[name]) grouped[name] = { name, revenue: 0, quantity: 0 };
      grouped[name].revenue += Number(item.price) * Number(item.quantity);
      grouped[name].quantity += Number(item.quantity);
    }

    const result = Object.values(grouped)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    res.json(result);
  } catch (e) {
    console.error('GET /reports/products/top-by-revenue error:', e);
    res.status(500).json({ message: 'Erro ao buscar produtos por faturamento', error: e?.message });
  }
});

// GET /reports/products/by-weekday
router.get('/by-weekday', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { from, to } = parseDateRange(req.query);
    const topN = Math.min(parseInt(req.query.topN) || 5, 10);

    const items = await fetchItems(companyId, from, to, req.query.storeId);

    const byDay = {};
    const productTotals = {};

    for (const item of items) {
      const dow = item.order.createdAt.getDay(); // 0=Domingo
      const name = item.name;
      const qty = Number(item.quantity);

      if (!byDay[dow]) byDay[dow] = {};
      byDay[dow][name] = (byDay[dow][name] || 0) + qty;
      productTotals[name] = (productTotals[name] || 0) + qty;
    }

    const topProducts = Object.entries(productTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([name]) => name);

    const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const series = topProducts.map((name) => ({
      name,
      data: labels.map((_, dow) => byDay[dow]?.[name] || 0),
    }));

    res.json({ labels, series, topProducts });
  } catch (e) {
    console.error('GET /reports/products/by-weekday error:', e);
    res.status(500).json({ message: 'Erro ao buscar produtos por dia da semana', error: e?.message });
  }
});

// GET /reports/products/by-hour
router.get('/by-hour', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { from, to } = parseDateRange(req.query);
    const topN = Math.min(parseInt(req.query.topN) || 5, 10);

    const items = await fetchItems(companyId, from, to, req.query.storeId);

    const byHour = {};
    const productTotals = {};

    for (const item of items) {
      const hour = item.order.createdAt.getHours();
      const name = item.name;
      const qty = Number(item.quantity);

      if (!byHour[hour]) byHour[hour] = {};
      byHour[hour][name] = (byHour[hour][name] || 0) + qty;
      productTotals[name] = (productTotals[name] || 0) + qty;
    }

    const topProducts = Object.entries(productTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([name]) => name);

    const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`);
    const series = topProducts.map((name) => ({
      name,
      data: labels.map((_, h) => byHour[h]?.[name] || 0),
    }));

    res.json({ labels, series, topProducts });
  } catch (e) {
    console.error('GET /reports/products/by-hour error:', e);
    res.status(500).json({ message: 'Erro ao buscar produtos por hora', error: e?.message });
  }
});

export default router;
