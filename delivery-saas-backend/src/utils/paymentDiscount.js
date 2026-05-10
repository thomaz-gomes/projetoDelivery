import { TAKEOUT_TYPES } from './orderType.js';

function normalizeOrderType(t) {
  if (!t) return 'DELIVERY';
  const up = String(t).toUpperCase();
  if (up === 'DELIVERY') return 'DELIVERY';
  if (TAKEOUT_TYPES.includes(up)) {
    // collapse all takeout synonyms into TAKEOUT or BALCAO
    if (up === 'BALCAO' || up === 'BALCÃO' || up === 'INDOOR') return 'BALCAO';
    return 'TAKEOUT';
  }
  return up;
}

function hmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isWithinSchedule(schedule, now) {
  if (!Array.isArray(schedule)) return false;
  const day = now.getDay(); // 0..6
  const slot = schedule.find((s) => s && Number(s.day) === day);
  if (!slot || !slot.enabled) return false;
  const from = hmToMin(slot.from);
  const to = hmToMin(slot.to);
  if (from == null || to == null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (from <= to) return nowMin >= from && nowMin < to;
  // overnight window
  return nowMin >= from || nowMin < to;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function evaluateDiscountRule(method, ctx) {
  const result = { applies: false, amount: 0, removesCoupon: false, blocksCashback: false };
  if (!method || !method.isActive || !method.discountEnabled) return result;

  if (!method.alwaysAvailable) {
    if (!isWithinSchedule(method.schedule, ctx.now)) return result;
  }

  const allowed = Array.isArray(method.allowedOrderTypes) ? method.allowedOrderTypes : null;
  if (allowed && allowed.length > 0) {
    const want = normalizeOrderType(ctx.orderType);
    const ok = allowed.map((x) => normalizeOrderType(x)).includes(want);
    if (!ok) return result;
  }

  const sub = Number(ctx.subtotal) || 0;
  let amount = 0;
  if (method.discountPercent != null && method.discountPercent !== '') {
    const pct = Number(method.discountPercent);
    if (!Number.isFinite(pct) || pct <= 0) return result;
    amount = round2(sub * pct / 100);
  } else if (method.discountFixed != null && method.discountFixed !== '') {
    const fix = Number(method.discountFixed);
    if (!Number.isFinite(fix) || fix <= 0) return result;
    amount = round2(fix);
  } else {
    return result; // rule on but no value configured
  }
  amount = Math.min(Math.max(amount, 0), sub);
  if (amount <= 0) return result;

  result.applies = true;
  result.amount = amount;
  result.removesCoupon = !!method.ignoreCoupons;
  result.blocksCashback = method.generatesCashback === false;
  return result;
}
