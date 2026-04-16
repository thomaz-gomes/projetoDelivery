import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriodRange, computeBreakEven, evaluateAlerts } from '../src/services/businessHealth.js';

test('resolvePeriodRange — current_month', () => {
  const ref = new Date('2026-04-15T12:00:00Z');
  const r = resolvePeriodRange('current_month', ref);
  assert.equal(r.from.getUTCMonth(), 3); // April is month 3
  assert.equal(r.from.getUTCDate(), 1);
  assert.equal(r.to.getUTCMonth(), 3);
  assert.equal(r.to.getUTCDate(), 30);
  assert.equal(r.label, 'Mês atual');
});

test('resolvePeriodRange — last_month', () => {
  const ref = new Date('2026-04-15T12:00:00Z');
  const r = resolvePeriodRange('last_month', ref);
  assert.equal(r.from.getUTCMonth(), 2); // March
  assert.equal(r.to.getUTCMonth(), 2);
  assert.equal(r.to.getUTCDate(), 31);
});

test('resolvePeriodRange — last_month handles January (year boundary)', () => {
  const ref = new Date('2026-01-10T12:00:00Z');
  const r = resolvePeriodRange('last_month', ref);
  assert.equal(r.from.getUTCFullYear(), 2025);
  assert.equal(r.from.getUTCMonth(), 11); // December
});

test('resolvePeriodRange — last_30d', () => {
  const ref = new Date('2026-04-15T12:00:00Z');
  const r = resolvePeriodRange('last_30d', ref);
  assert.ok(r.to.getTime() - r.from.getTime() >= 29 * 86400000);
  assert.equal(r.label, 'Últimos 30 dias');
});

test('resolvePeriodRange — current_quarter', () => {
  const ref = new Date('2026-04-15T12:00:00Z'); // Q2 (April-June)
  const r = resolvePeriodRange('current_quarter', ref);
  assert.equal(r.from.getUTCMonth(), 3); // April
  assert.equal(r.to.getUTCMonth(), 5); // June
  assert.equal(r.label, 'Trimestre atual');
});

test('resolvePeriodRange — last_quarter handles year boundary', () => {
  const ref = new Date('2026-02-10T12:00:00Z'); // Q1 → last = Q4 previous year
  const r = resolvePeriodRange('last_quarter', ref);
  assert.equal(r.from.getUTCFullYear(), 2025);
  assert.equal(r.from.getUTCMonth(), 9); // October
  assert.equal(r.to.getUTCMonth(), 11); // December
});

test('resolvePeriodRange — current_year', () => {
  const ref = new Date('2026-04-15T12:00:00Z');
  const r = resolvePeriodRange('current_year', ref);
  assert.equal(r.from.getUTCMonth(), 0); // January
  assert.equal(r.to.getUTCMonth(), 11); // December
  assert.equal(r.label, 'Ano atual');
});

test('resolvePeriodRange — invalid period throws', () => {
  assert.throws(() => resolvePeriodRange('invalid', new Date()), /period/i);
});

test('computeBreakEven — basic math', () => {
  const r = computeBreakEven({
    revenue: 45200, cmv: 14800, fixedCosts: 18500,
    storeDefaults: { salesTaxPercent: 6, marketplaceFeePercent: 12, cardFeePercent: 3.5 },
  });
  // variablePct = 21.5% → variableCosts = 45200 * 0.215 = 9718
  // contributionMargin = 45200 - 14800 - 9718 = 20682
  // contributionMarginPct = 20682/45200 * 100 = 45.8%
  // breakEvenRevenue = 18500 / 0.458 = 40393
  // safetyMarginPct = (45200 - 40393)/45200 * 100 = 10.6%
  assert.ok(Math.abs(r.contributionMarginPct - 45.8) < 1);
  assert.ok(Math.abs(r.breakEvenRevenue - 40393) < 500);
  assert.ok(r.safetyMarginPct > 5);
});

test('computeBreakEven — zero revenue returns null breakEven', () => {
  const r = computeBreakEven({
    revenue: 0, cmv: 0, fixedCosts: 5000,
    storeDefaults: { salesTaxPercent: 0, marketplaceFeePercent: 0, cardFeePercent: 0 },
  });
  assert.equal(r.contributionMarginPct, 0);
  assert.equal(r.breakEvenRevenue, null);
  assert.equal(r.safetyMarginPct, null);
});

test('evaluateAlerts — CMV global critical', () => {
  const alerts = evaluateAlerts({
    kpis: { cmv: { pct: 45 }, netProfit: { pct: 10 } },
    breakEven: { safetyMarginPct: 12 },
    bottomProducts: [],
    storeDefaults: { cmvCriticalAbove: 40 },
    opexDeltaPct: 5,
  });
  assert.ok(alerts.some(a => a.code === 'CMV_GLOBAL_CRITICAL'));
});

test('evaluateAlerts — product with negative margin', () => {
  const alerts = evaluateAlerts({
    kpis: { cmv: { pct: 30 }, netProfit: { pct: 10 } },
    breakEven: { safetyMarginPct: 12 },
    bottomProducts: [{ marginPct: -5 }, { marginPct: 2 }],
    storeDefaults: { cmvCriticalAbove: 40 },
    opexDeltaPct: 5,
  });
  const alert = alerts.find(a => a.code === 'CMV_CRITICAL_PRODUCT');
  assert.ok(alert);
  assert.equal(alert.level, 'danger');
});

test('evaluateAlerts — break-even below zero triggers danger', () => {
  const alerts = evaluateAlerts({
    kpis: { cmv: { pct: 30 }, netProfit: { pct: 10 } },
    breakEven: { safetyMarginPct: -5 },
    bottomProducts: [],
    storeDefaults: { cmvCriticalAbove: 40 },
    opexDeltaPct: 5,
  });
  assert.ok(alerts.some(a => a.code === 'BREAK_EVEN_BELOW'));
});

test('evaluateAlerts — healthy safety margin triggers info', () => {
  const alerts = evaluateAlerts({
    kpis: { cmv: { pct: 30 }, netProfit: { pct: 15 } },
    breakEven: { safetyMarginPct: 20 },
    bottomProducts: [],
    storeDefaults: { cmvCriticalAbove: 40 },
    opexDeltaPct: 5,
  });
  assert.ok(alerts.some(a => a.code === 'BREAK_EVEN_OK'));
});

test('evaluateAlerts — low net margin triggers warning', () => {
  const alerts = evaluateAlerts({
    kpis: { cmv: { pct: 30 }, netProfit: { pct: 3 } },
    breakEven: { safetyMarginPct: 15 },
    bottomProducts: [],
    storeDefaults: { cmvCriticalAbove: 40 },
    opexDeltaPct: 5,
  });
  assert.ok(alerts.some(a => a.code === 'MARGIN_LOSS'));
});
