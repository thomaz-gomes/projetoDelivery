import { calculateCMV, calculateCmvByProduct } from '../routes/financial/reports.js';
import { getOrCreateDefaults } from '../routes/storePricingDefaults.js';
import {
  resolvePeriodRange,
  resolvePrevPeriodRange,
  computeBreakEven,
  evaluateAlerts,
} from './businessHealthHelpers.js';

export { resolvePeriodRange, resolvePrevPeriodRange, computeBreakEven, evaluateAlerts };

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
  // 1. Revenue: sum FinancialTransaction type=RECEIVABLE from completed orders.
  //    Include PAID, PARTIALLY and CONFIRMED — CONCLUIDO orders are real sales regardless
  //    of payment method. Use netAmount (always set by the bridge; paidAmount is only set
  //    when manually reconciled in the UI).
  const txWhere = {
    companyId,
    type: 'RECEIVABLE',
    status: { in: ['PAID', 'PARTIALLY', 'CONFIRMED'] },
    issueDate: { gte: from, lte: to },
  };
  if (storeId) txWhere.storeId = storeId;
  const revenueAgg = await prisma.financialTransaction.aggregate({
    where: txWhere,
    _sum: { netAmount: true },
  });
  const revenue = Number(revenueAgg._sum.netAmount || 0);

  // 2. CMV (from Phase 1 helper)
  const cmvResult = await calculateCMV(prisma, companyId, from, to, storeId);
  const cmvAbs = Math.abs(Number(cmvResult.total || 0));

  // 3. Fixed costs: PAYABLE transactions in OPEX cost centers
  //    Cash-basis: paidAmount only
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
      _sum: { paidAmount: true },
    });
    fixedCosts = Number(payAgg._sum.paidAmount || 0);
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
  const prevRange = resolvePrevPeriodRange(period, range);

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

  // Task 3.4: earliest snapshot date (for data availability banner)
  const earliest = await prisma.stockMovementItem.findFirst({
    where: {
      unitCost: { not: null },
      stockMovement: { type: 'OUT', companyId },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const dataStartDate = earliest?.createdAt || null;

  return { period: range, kpis, breakEven, topProducts, bottomProducts, alerts, dataStartDate };
}
