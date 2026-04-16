// businessHealthHelpers.js — pure helpers with no backend deps

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

export function resolvePrevPeriodRange(code, currentRange, ref = new Date()) {
  // For calendar-aligned codes, compute the previous calendar unit.
  // For rolling codes (last_30d), subtract spanMs.
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const startOfMonth = (yy, mm) => new Date(Date.UTC(yy, mm, 1));
  const endOfMonth = (yy, mm) => new Date(Date.UTC(yy, mm + 1, 0, 23, 59, 59, 999));
  const startOfQuarter = (yy, qq) => new Date(Date.UTC(yy, qq * 3, 1));
  const endOfQuarter = (yy, qq) => new Date(Date.UTC(yy, qq * 3 + 3, 0, 23, 59, 59, 999));
  const q = Math.floor(m / 3);
  switch (code) {
    case 'current_month': {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      return { from: startOfMonth(py, pm), to: endOfMonth(py, pm) };
    }
    case 'last_month': {
      const pm = m <= 1 ? 10 + m : m - 2;
      const py = m <= 1 ? y - 1 : y;
      return { from: startOfMonth(py, pm), to: endOfMonth(py, pm) };
    }
    case 'current_quarter': {
      const pq = q === 0 ? 3 : q - 1;
      const py = q === 0 ? y - 1 : y;
      return { from: startOfQuarter(py, pq), to: endOfQuarter(py, pq) };
    }
    case 'last_quarter': {
      const pq = q <= 1 ? 2 + q : q - 2;
      const py = q <= 1 ? y - 1 : y;
      return { from: startOfQuarter(py, pq), to: endOfQuarter(py, pq) };
    }
    case 'current_year':
      return { from: new Date(Date.UTC(y - 1, 0, 1)), to: new Date(Date.UTC(y - 1, 11, 31, 23, 59, 59, 999)) };
    case 'last_30d':
    default: {
      const spanMs = currentRange.to.getTime() - currentRange.from.getTime();
      return { from: new Date(currentRange.from.getTime() - spanMs), to: new Date(currentRange.from.getTime() - 1) };
    }
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
  const criticalProducts = (bottomProducts || []).filter(p => {
    const cmvPct = p.revenueTotal > 0 ? (p.cmvTotal / p.revenueTotal) * 100 : 0;
    return cmvPct > critThreshold;
  });
  if (criticalProducts.length > 0) {
    alerts.push({
      level: 'danger',
      code: 'CMV_CRITICAL_PRODUCT',
      message: `${criticalProducts.length} produto(s) com CMV acima de ${critThreshold}%`,
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
