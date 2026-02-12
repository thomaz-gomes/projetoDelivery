import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

// GET /financial/cash-flow - fluxo de caixa (realizado + previsto)
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { accountId, dateFrom, dateTo, view = 'daily' } = req.query;

    const from = dateFrom ? new Date(dateFrom) : new Date(new Date().setDate(1)); // início do mês
    const to = dateTo ? new Date(dateTo) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0); // fim do mês

    // 1. Movimentações realizadas (CashFlowEntry)
    const realizedWhere = { companyId, entryDate: { gte: from, lte: to } };
    if (accountId) realizedWhere.accountId = accountId;

    const realized = await prisma.cashFlowEntry.findMany({
      where: realizedWhere,
      include: {
        account: { select: { id: true, name: true } },
        transaction: { select: { id: true, description: true, sourceType: true } },
      },
      orderBy: { entryDate: 'asc' },
    });

    // 2. Transações previstas (PENDING/CONFIRMED, não pagas) no período
    const forecastWhere = {
      companyId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      dueDate: { gte: from, lte: to },
    };
    if (accountId) forecastWhere.accountId = accountId;

    const forecast = await prisma.financialTransaction.findMany({
      where: forecastWhere,
      include: {
        account: { select: { id: true, name: true } },
        costCenter: { select: { id: true, code: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    // 3. Saldo das contas
    const accountsWhere = { companyId, isActive: true };
    if (accountId) accountsWhere.id = accountId;
    const accounts = await prisma.financialAccount.findMany({
      where: accountsWhere,
      select: { id: true, name: true, type: true, currentBalance: true },
    });

    // 4. Agrupar por período (daily, weekly, monthly)
    const realizedByDate = groupByDate(realized.map(r => ({
      date: r.entryDate,
      inflow: r.type === 'INFLOW' ? Number(r.amount) : 0,
      outflow: r.type === 'OUTFLOW' ? Number(r.amount) : 0,
    })), view);

    const forecastByDate = groupByDate(forecast.map(f => ({
      date: f.dueDate,
      inflow: f.type === 'RECEIVABLE' ? Number(f.netAmount) : 0,
      outflow: f.type === 'PAYABLE' ? Number(f.netAmount) : 0,
    })), view);

    // Totais
    const totalRealized = {
      inflow: realized.filter(r => r.type === 'INFLOW').reduce((s, r) => s + Number(r.amount), 0),
      outflow: realized.filter(r => r.type === 'OUTFLOW').reduce((s, r) => s + Number(r.amount), 0),
    };
    totalRealized.net = totalRealized.inflow - totalRealized.outflow;

    const totalForecast = {
      inflow: forecast.filter(f => f.type === 'RECEIVABLE').reduce((s, f) => s + Number(f.netAmount), 0),
      outflow: forecast.filter(f => f.type === 'PAYABLE').reduce((s, f) => s + Number(f.netAmount), 0),
    };
    totalForecast.net = totalForecast.inflow - totalForecast.outflow;

    const totalBalance = accounts.reduce((s, a) => s + Number(a.currentBalance), 0);

    res.json({
      period: { from, to, view },
      accounts,
      totalBalance,
      realized: { entries: realized, byDate: realizedByDate, totals: totalRealized },
      forecast: { entries: forecast, byDate: forecastByDate, totals: totalForecast },
    });
  } catch (e) {
    console.error('GET /financial/cash-flow error:', e);
    res.status(500).json({ message: 'Erro ao gerar fluxo de caixa', error: e?.message });
  }
});

// POST /financial/cash-flow/manual - lançamento manual direto no fluxo
router.post('/manual', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { accountId, type, amount, description, entryDate, notes } = req.body;

    if (!accountId || !type || !amount) {
      return res.status(400).json({ message: 'accountId, type e amount são obrigatórios' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const balanceChange = type === 'INFLOW' ? Number(amount) : -Number(amount);
      const account = await tx.financialAccount.update({
        where: { id: accountId },
        data: { currentBalance: { increment: balanceChange } },
      });

      const entry = await tx.cashFlowEntry.create({
        data: {
          companyId,
          accountId,
          type,
          amount: Number(amount),
          balanceAfter: account.currentBalance,
          entryDate: entryDate ? new Date(entryDate) : new Date(),
          description: description || 'Lançamento manual',
          createdBy: req.user.id,
          notes: notes || null,
        },
      });

      return { entry, account };
    });

    res.status(201).json(result);
  } catch (e) {
    console.error('POST /financial/cash-flow/manual error:', e);
    res.status(500).json({ message: 'Erro ao criar lançamento', error: e?.message });
  }
});

// Helper: agrupar valores por data
function groupByDate(items, view) {
  const groups = {};
  for (const item of items) {
    const key = getDateKey(new Date(item.date), view);
    if (!groups[key]) groups[key] = { date: key, inflow: 0, outflow: 0, net: 0 };
    groups[key].inflow += item.inflow;
    groups[key].outflow += item.outflow;
    groups[key].net = groups[key].inflow - groups[key].outflow;
  }
  return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
}

function getDateKey(date, view) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (view === 'monthly') return `${y}-${m}`;
  if (view === 'weekly') {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const wy = weekStart.getFullYear();
    const wm = String(weekStart.getMonth() + 1).padStart(2, '0');
    const wd = String(weekStart.getDate()).padStart(2, '0');
    return `${wy}-${wm}-${wd}`;
  }
  return `${y}-${m}-${d}`;
}

export default router;
