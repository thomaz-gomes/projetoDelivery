import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

// GET /financial/reports/dre - Demonstrativo de Resultado do Exercício
router.get('/dre', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { dateFrom, dateTo, storeId } = req.query;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: 'dateFrom e dateTo são obrigatórios' });
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    // Buscar todos os centros de custo da empresa
    const costCenters = await prisma.costCenter.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: 'asc' },
    });

    // Buscar transações PAID no período, agrupadas por centro de custo
    const txWhere = {
      companyId,
      status: { in: ['PAID', 'PARTIALLY'] },
      issueDate: { gte: from, lte: to },
      costCenterId: { not: null },
    };
    if (storeId) txWhere.storeId = storeId;

    const transactions = await prisma.financialTransaction.findMany({
      where: txWhere,
      select: {
        type: true,
        costCenterId: true,
        netAmount: true,
        paidAmount: true,
        feeAmount: true,
        grossAmount: true,
      },
    });

    // Montar estrutura DRE
    const dreGroups = {};
    for (const cc of costCenters) {
      if (!cc.dreGroup) continue;
      if (!dreGroups[cc.dreGroup]) {
        dreGroups[cc.dreGroup] = { group: cc.dreGroup, items: [], total: 0 };
      }
    }

    // Calcular totais por centro de custo
    const ccTotals = {};
    for (const tx of transactions) {
      const ccId = tx.costCenterId;
      if (!ccTotals[ccId]) ccTotals[ccId] = 0;
      // Receitas somam positivo, despesas somam negativo
      const value = tx.type === 'RECEIVABLE'
        ? Number(tx.paidAmount || tx.netAmount)
        : -Number(tx.paidAmount || tx.netAmount);
      ccTotals[ccId] += value;
    }

    // Montar itens do DRE
    for (const cc of costCenters) {
      if (!cc.dreGroup || !dreGroups[cc.dreGroup]) continue;
      const total = ccTotals[cc.id] || 0;
      dreGroups[cc.dreGroup].items.push({
        costCenterId: cc.id,
        code: cc.code,
        name: cc.name,
        total,
      });
      dreGroups[cc.dreGroup].total += total;
    }

    // Calcular CMV
    const cmv = await calculateCMV(prisma, companyId, from, to, storeId);

    // Montar DRE final
    const revenue = dreGroups['REVENUE']?.total || 0;
    const deductions = dreGroups['DEDUCTIONS']?.total || 0;
    const netRevenue = revenue + deductions; // deductions é negativo
    const cogs = dreGroups['COGS']?.total || cmv.total || 0;
    const grossProfit = netRevenue + cogs; // cogs é negativo
    const opex = dreGroups['OPEX']?.total || 0;
    const operatingProfit = grossProfit + opex; // opex é negativo
    const financial = dreGroups['FINANCIAL']?.total || 0;
    const netProfit = operatingProfit + financial;

    const dre = {
      period: { from, to },
      lines: {
        receitaBruta: { label: '(+) Receita Bruta', value: revenue, details: dreGroups['REVENUE'] },
        deducoes: { label: '(-) Deduções de Receita', value: deductions, details: dreGroups['DEDUCTIONS'] },
        receitaLiquida: { label: '(=) Receita Líquida', value: netRevenue },
        cmv: { label: '(-) CMV', value: cogs, details: { ...dreGroups['COGS'], cmvDetails: cmv } },
        lucroBruto: { label: '(=) Lucro Bruto', value: grossProfit },
        despesasOperacionais: { label: '(-) Despesas Operacionais', value: opex, details: dreGroups['OPEX'] },
        resultadoOperacional: { label: '(=) Resultado Operacional', value: operatingProfit },
        resultadoFinanceiro: { label: '(+/-) Resultado Financeiro', value: financial, details: dreGroups['FINANCIAL'] },
        resultadoLiquido: { label: '(=) Resultado Líquido', value: netProfit },
      },
      margins: {
        grossMargin: revenue ? ((grossProfit / revenue) * 100).toFixed(2) + '%' : '0%',
        operatingMargin: revenue ? ((operatingProfit / revenue) * 100).toFixed(2) + '%' : '0%',
        netMargin: revenue ? ((netProfit / revenue) * 100).toFixed(2) + '%' : '0%',
      },
    };

    res.json(dre);
  } catch (e) {
    console.error('GET /financial/reports/dre error:', e);
    res.status(500).json({ message: 'Erro ao gerar DRE', error: e?.message });
  }
});

// GET /financial/reports/summary - resumo financeiro rápido
router.get('/summary', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { storeId } = req.query;
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const recWhere = { companyId, type: 'RECEIVABLE', status: { in: ['PENDING', 'CONFIRMED'] }, dueDate: { gte: startOfMonth, lte: endOfMonth } };
    const payWhere = { companyId, type: 'PAYABLE', status: { in: ['PENDING', 'CONFIRMED'] }, dueDate: { gte: startOfMonth, lte: endOfMonth } };
    const overdueWhere = { companyId, status: 'OVERDUE' };
    if (storeId) {
      recWhere.storeId = storeId;
      payWhere.storeId = storeId;
      overdueWhere.storeId = storeId;
    }

    const [receivables, payables, overdue, accounts] = await Promise.all([
      // Total a receber no mês
      prisma.financialTransaction.aggregate({
        where: recWhere,
        _sum: { netAmount: true },
        _count: true,
      }),
      // Total a pagar no mês
      prisma.financialTransaction.aggregate({
        where: payWhere,
        _sum: { netAmount: true },
        _count: true,
      }),
      // Títulos vencidos
      prisma.financialTransaction.aggregate({
        where: overdueWhere,
        _sum: { netAmount: true },
        _count: true,
      }),
      // Saldo total das contas
      prisma.financialAccount.aggregate({
        where: { companyId, isActive: true },
        _sum: { currentBalance: true },
      }),
    ]);

    res.json({
      month: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
      receivables: { total: Number(receivables._sum.netAmount || 0), count: receivables._count },
      payables: { total: Number(payables._sum.netAmount || 0), count: payables._count },
      overdue: { total: Number(overdue._sum.netAmount || 0), count: overdue._count },
      totalBalance: Number(accounts._sum.currentBalance || 0),
    });
  } catch (e) {
    console.error('GET /financial/reports/summary error:', e);
    res.status(500).json({ message: 'Erro ao gerar resumo', error: e?.message });
  }
});

// GET /financial/reports/cmv - Custo de Mercadoria Vendida detalhado
router.get('/cmv', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { dateFrom, dateTo, storeId } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: 'dateFrom e dateTo são obrigatórios' });
    }

    const cmv = await calculateCMV(prisma, companyId, new Date(dateFrom), new Date(dateTo), storeId);
    res.json(cmv);
  } catch (e) {
    console.error('GET /financial/reports/cmv error:', e);
    res.status(500).json({ message: 'Erro ao calcular CMV', error: e?.message });
  }
});

// GET /financial/reports/cmv-by-product
router.get('/cmv-by-product', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { dateFrom, dateTo, storeId } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: 'dateFrom e dateTo são obrigatórios' });
    }
    const data = await calculateCmvByProduct(prisma, companyId, new Date(dateFrom), new Date(dateTo), storeId);
    res.json(data);
  } catch (e) {
    console.error('GET /financial/reports/cmv-by-product error:', e);
    res.status(500).json({ message: 'Erro ao calcular CMV por produto', error: e?.message });
  }
});

// Helper: calcular CMV pelo CONSUMO (movimentos OUT × unitCost snapshotado)
export async function calculateCMV(prismaInstance, companyId, from, to, storeId) {
  try {
    const mvWhere = {
      companyId,
      type: 'OUT',
      reversedAt: null,
      createdAt: { gte: from, lte: to },
    };
    if (storeId) mvWhere.storeId = storeId;

    const movements = await prismaInstance.stockMovement.findMany({
      where: mvWhere,
      include: {
        items: {
          include: {
            ingredient: { select: { id: true, description: true, composesCmv: true, unit: true } },
          },
        },
      },
    });

    let total = 0;
    const details = [];
    for (const mv of movements) {
      for (const item of mv.items) {
        if (!item.ingredient?.composesCmv) continue;
        if (item.unitCost == null) continue; // pré-snapshot: ignora
        const cost = Number(item.quantity) * Number(item.unitCost);
        total += cost;
        details.push({
          ingredientId: item.ingredientId,
          description: item.ingredient.description,
          unit: item.ingredient.unit,
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
          totalCost: cost,
          movementDate: mv.createdAt,
        });
      }
    }
    return { total: total === 0 ? 0 : -total, details, period: { from, to } };
  } catch (e) {
    console.error('calculateCMV error:', e);
    return { total: 0, details: [], error: e?.message };
  }
}

// Helper: somar Compras do período (movimentos IN × unitCost) — visão alternativa
export async function calculatePurchases(prismaInstance, companyId, from, to, storeId) {
  try {
    const mvWhere = { companyId, type: 'IN', createdAt: { gte: from, lte: to } };
    if (storeId) mvWhere.storeId = storeId;
    const movements = await prismaInstance.stockMovement.findMany({
      where: mvWhere,
      include: { items: { include: { ingredient: { select: { composesCmv: true } } } } },
    });
    let total = 0;
    for (const mv of movements) {
      for (const item of mv.items) {
        if (!item.ingredient?.composesCmv) continue;
        total += Number(item.quantity) * Number(item.unitCost || 0);
      }
    }
    return { total, period: { from, to } };
  } catch (e) {
    console.error('calculatePurchases error:', e);
    return { total: 0, error: e?.message };
  }
}

// Helper: CMV agregado por produto (usado pelo painel Saúde do Negócio)
export async function calculateCmvByProduct(prismaInstance, companyId, from, to, storeId) {
  const mvWhere = { companyId, type: 'OUT', reversedAt: null, createdAt: { gte: from, lte: to } };
  if (storeId) mvWhere.storeId = storeId;
  const movements = await prismaInstance.stockMovement.findMany({ where: mvWhere });

  // Agregar CMV por orderId
  const cmvByOrder = new Map();
  for (const mv of movements) {
    if (!mv.note?.startsWith('Order:')) continue;
    const orderId = mv.note.slice('Order:'.length);
    let mvCost = 0;
    for (const it of mv.items || []) {
      if (it.unitCost == null) continue;
      mvCost += Number(it.quantity) * Number(it.unitCost);
    }
    cmvByOrder.set(orderId, (cmvByOrder.get(orderId) || 0) + mvCost);
  }

  // Para cada order, distribuir CMV pelos products proporcionalmente à receita
  const byProduct = new Map();
  for (const [orderId, orderCmv] of cmvByOrder.entries()) {
    const order = await prismaInstance.order.findUnique({
      where: { id: orderId },
      select: { items: true },
    }).catch(() => null);
    if (!order || !Array.isArray(order.items)) continue;
    const orderRevenue = order.items.reduce((s, it) => s + Number(it.totalPrice || 0), 0) || 1;
    for (const it of order.items) {
      const productId = it.productId;
      if (!productId) continue;
      const share = Number(it.totalPrice || 0) / orderRevenue;
      const entry = byProduct.get(productId) || { productId, qtySold: 0, cmvTotal: 0, revenueTotal: 0 };
      entry.qtySold += Number(it.quantity || 0);
      entry.cmvTotal += orderCmv * share;
      entry.revenueTotal += Number(it.totalPrice || 0);
      byProduct.set(productId, entry);
    }
  }

  // Hidratar nome do produto e calcular margens
  const result = [];
  for (const entry of byProduct.values()) {
    const product = await prismaInstance.product
      .findUnique({ where: { id: entry.productId }, select: { name: true } })
      .catch(() => null);
    const marginAbs = entry.revenueTotal - entry.cmvTotal;
    const marginPct = entry.revenueTotal ? (marginAbs / entry.revenueTotal) * 100 : 0;
    result.push({ ...entry, productName: product?.name || '?', marginAbs, marginPct });
  }
  return result;
}

export default router;
