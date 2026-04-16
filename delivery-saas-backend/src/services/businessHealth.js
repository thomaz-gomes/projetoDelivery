import { calculateCMV, calculateCmvByProduct } from '../routes/financial/reports.js';
import { getOrCreateDefaults } from '../routes/storePricingDefaults.js';

export function resolvePeriodRange(code, ref = new Date()) {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const startOfMonth = (yy, mm) => new Date(Date.UTC(yy, mm, 1));
  const endOfMonth = (yy, mm) => new Date(Date.UTC(yy, mm + 1, 0, 23, 59, 59, 999));
  const startOfQuarter = (yy, qq) => new Date(Date.UTC(yy, qq * 3, 1));
  const endOfQuarter = (yy, qq) => new Date(Date.UTC(yy, qq * 3 + 3, 0, 23, 59, 59, 999));
  const q = Math.floor(m / 3);
  switch (code) {
    case 'current_month':
      return { from: startOfMonth(y, m), to: endOfMonth(y, m), label: 'Mês atual' };
    case 'last_month': {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      return { from: startOfMonth(ly, lm), to: endOfMonth(ly, lm), label: 'Mês anterior' };
    }
    case 'last_30d':
      return { from: new Date(ref.getTime() - 30 * 86400000), to: ref, label: 'Últimos 30 dias' };
    case 'current_quarter':
      return { from: startOfQuarter(y, q), to: endOfQuarter(y, q), label: 'Trimestre atual' };
    case 'last_quarter': {
      const lq = q === 0 ? 3 : q - 1;
      const ly = q === 0 ? y - 1 : y;
      return { from: startOfQuarter(ly, lq), to: endOfQuarter(ly, lq), label: 'Trimestre anterior' };
    }
    case 'current_year':
      return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)), label: 'Ano atual' };
    default:
      throw new Error(`period inválido: ${code}`);
  }
}

export function computeBreakEven({ revenue, cmv, fixedCosts, storeDefaults }) {
  const variablePct = Number(storeDefaults.salesTaxPercent || 0)
    + Number(storeDefaults.marketplaceFeePercent || 0)
    + Number(storeDefaults.cardFeePercent || 0);
  const variableCosts = revenue * (variablePct / 100);
  const contributionMargin = revenue - cmv - variableCosts;
  const contributionMarginPct = revenue ? (contributionMargin / revenue) * 100 : 0;
  const breakEvenRevenue = contributionMarginPct > 0 ? fixedCosts / (contributionMarginPct / 100) : null;
  const safetyMarginPct = breakEvenRevenue && revenue ? ((revenue - breakEvenRevenue) / revenue) * 100 : null;
  return {
    fixedCosts,
    variableCosts,
    contributionMarginPct,
    breakEvenRevenue,
    currentRevenue: revenue,
    safetyMarginPct,
  };
}

export function evaluateAlerts({ kpis, breakEven, bottomProducts, storeDefaults, opexDeltaPct }) {
  const alerts = [];
  const critThreshold = Number(storeDefaults.cmvCriticalAbove || 40);

  if (kpis.cmv?.pct > critThreshold) {
    alerts.push({
      level: 'danger',
      code: 'CMV_GLOBAL_CRITICAL',
      message: `CMV global em ${kpis.cmv.pct.toFixed(1)}% (acima de ${critThreshold}%)`,
    });
  }
  const criticalProducts = (bottomProducts || []).filter(p => p.marginPct < 0);
  if (criticalProducts.length > 0) {
    alerts.push({
      level: 'danger',
      code: 'CMV_CRITICAL_PRODUCT',
      message: `${criticalProducts.length} produto(s) com margem negativa`,
      actionUrl: '/menu/products',
    });
  }
  if (opexDeltaPct > 20) {
    alerts.push({
      level: 'warning',
      code: 'OPEX_GROWTH',
      message: `Despesas operacionais cresceram ${opexDeltaPct.toFixed(1)}% vs período anterior`,
    });
  }
  if (breakEven?.safetyMarginPct != null && breakEven.safetyMarginPct < 0) {
    alerts.push({
      level: 'danger',
      code: 'BREAK_EVEN_BELOW',
      message: 'Faturamento abaixo do ponto de equilíbrio',
    });
  } else if (breakEven?.safetyMarginPct != null && breakEven.safetyMarginPct >= 10) {
    alerts.push({
      level: 'info',
      code: 'BREAK_EVEN_OK',
      message: `Faturamento ${breakEven.safetyMarginPct.toFixed(0)}% acima do ponto de equilíbrio`,
    });
  }
  if (kpis.netProfit?.pct != null && kpis.netProfit.pct < 5) {
    alerts.push({
      level: 'warning',
      code: 'MARGIN_LOSS',
      message: `Margem líquida em ${kpis.netProfit.pct.toFixed(1)}% (abaixo de 5%)`,
    });
  }
  return alerts;
}

function computeCmvPct(revenue, cmvAbs) {
  return revenue > 0 ? (Math.abs(cmvAbs) / revenue) * 100 : 0;
}

function classifyCmv(pct, defaults) {
  const min = Number(defaults.cmvHealthyMin || 25);
  const max = Number(defaults.cmvHealthyMax || 35);
  const crit = Number(defaults.cmvCriticalAbove || 40);
  if (pct > crit) return 'critical';
  if (pct > max) return 'warning';
  if (pct >= min) return 'healthy';
  return 'over_priced';
}

async function fetchPeriodMetrics(prisma, { companyId, storeId, from, to }) {
  // 1. Revenue: sum FinancialTransaction type=RECEIVABLE, status PAID/PARTIALLY, in period
  const txWhere = {
    companyId,
    type: 'RECEIVABLE',
    status: { in: ['PAID', 'PARTIALLY'] },
    issueDate: { gte: from, lte: to },
  };
  if (storeId) txWhere.storeId = storeId;
  const revenueAgg = await prisma.financialTransaction.aggregate({
    where: txWhere,
    _sum: { paidAmount: true, netAmount: true },
  });
  const revenue = Number(revenueAgg._sum.paidAmount || revenueAgg._sum.netAmount || 0);

  // 2. CMV (from Phase 1 helper)
  const cmvResult = await calculateCMV(prisma, companyId, from, to, storeId);
  const cmvAbs = Math.abs(Number(cmvResult.total || 0));

  // 3. Fixed costs: PAYABLE transactions in OPEX cost centers
  const opexCCs = await prisma.costCenter.findMany({ where: { companyId, dreGroup: 'OPEX' }, select: { id: true } });
  const opexCCIds = opexCCs.map(c => c.id);
  let fixedCosts = 0;
  if (opexCCIds.length > 0) {
    const payWhere = {
      companyId,
      type: 'PAYABLE',
      status: { in: ['PAID', 'PARTIALLY'] },
      costCenterId: { in: opexCCIds },
      issueDate: { gte: from, lte: to },
    };
    if (storeId) payWhere.storeId = storeId;
    const payAgg = await prisma.financialTransaction.aggregate({
      where: payWhere,
      _sum: { paidAmount: true, netAmount: true },
    });
    fixedCosts = Number(payAgg._sum.paidAmount || payAgg._sum.netAmount || 0);
  }

  // 4. Orders count (completed orders — status CONCLUIDO — in period)
  const ordersWhere = {
    companyId,
    status: 'CONCLUIDO',
    createdAt: { gte: from, lte: to },
  };
  if (storeId) ordersWhere.storeId = storeId;
  const ordersCount = await prisma.order.count({ where: ordersWhere });

  return { revenue, cmvAbs, fixedCosts, ordersCount };
}

export async function getBusinessHealth(prisma, { companyId, storeId, period }) {
  const range = resolvePeriodRange(period);
  const spanMs = range.to.getTime() - range.from.getTime();
  const prevRange = {
    from: new Date(range.from.getTime() - spanMs),
    to: new Date(range.from.getTime() - 1),
  };

  // Store defaults (for break-even and bands)
  const resolvedStoreId = storeId || (await prisma.store.findFirst({ where: { companyId } }))?.id;
  const storeDefaults = resolvedStoreId ? await getOrCreateDefaults(prisma, resolvedStoreId) : { salesTaxPercent: 0, marketplaceFeePercent: 0, cardFeePercent: 0, cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40 };

  const [curr, prev] = await Promise.all([
    fetchPeriodMetrics(prisma, { companyId, storeId: resolvedStoreId, from: range.from, to: range.to }),
    fetchPeriodMetrics(prisma, { companyId, storeId: resolvedStoreId, from: prevRange.from, to: prevRange.to }),
  ]);

  const cmvPct = computeCmvPct(curr.revenue, curr.cmvAbs);
  const grossProfit = curr.revenue - curr.cmvAbs;
  const opex = curr.fixedCosts;
  const operatingProfit = grossProfit - opex;
  const variableCosts = curr.revenue * ((Number(storeDefaults.salesTaxPercent || 0) + Number(storeDefaults.marketplaceFeePercent || 0) + Number(storeDefaults.cardFeePercent || 0)) / 100);
  const netProfit = operatingProfit - variableCosts;

  const pct = (num, den) => den > 0 ? (num / den) * 100 : null;
  const deltaPct = (curr, prev) => prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0);

  const kpis = {
    revenue:         { value: curr.revenue, prev: prev.revenue, deltaPct: deltaPct(curr.revenue, prev.revenue), trend: curr.revenue >= prev.revenue ? 'up' : 'down' },
    cmv:             { value: curr.cmvAbs, pct: cmvPct, status: classifyCmv(cmvPct, storeDefaults), band: [Number(storeDefaults.cmvHealthyMin), Number(storeDefaults.cmvHealthyMax)] },
    grossMargin:     { value: grossProfit, pct: pct(grossProfit, curr.revenue), status: grossProfit > 0 ? 'healthy' : 'critical' },
    operatingProfit: { value: operatingProfit, pct: pct(operatingProfit, curr.revenue), status: operatingProfit > 0 ? 'healthy' : 'critical' },
    netProfit:       { value: netProfit, pct: pct(netProfit, curr.revenue), status: netProfit > 0 ? 'healthy' : 'critical' },
    ticketAvg:       { value: curr.ordersCount > 0 ? curr.revenue / curr.ordersCount : 0, prev: prev.ordersCount > 0 ? prev.revenue / prev.ordersCount : 0, deltaPct: prev.ordersCount > 0 ? deltaPct(curr.revenue / curr.ordersCount, prev.revenue / prev.ordersCount) : 0 },
    ordersCount:     { value: curr.ordersCount, prev: prev.ordersCount, deltaPct: deltaPct(curr.ordersCount, prev.ordersCount) },
  };

  const breakEven = computeBreakEven({ revenue: curr.revenue, cmv: curr.cmvAbs, fixedCosts: opex, storeDefaults });

  const opexDeltaPct = deltaPct(opex, prev.fixedCosts);

  const cmvByProduct = await calculateCmvByProduct(prisma, companyId, range.from, range.to, resolvedStoreId);
  const topProducts = [...cmvByProduct].sort((a, b) => b.marginAbs - a.marginAbs).slice(0, 5);
  const bottomProducts = [...cmvByProduct].sort((a, b) => a.marginPct - b.marginPct).slice(0, 5);

  const alerts = evaluateAlerts({ kpis, breakEven, bottomProducts, storeDefaults, opexDeltaPct });

  return { period: range, kpis, breakEven, topProducts, bottomProducts, alerts };
}
