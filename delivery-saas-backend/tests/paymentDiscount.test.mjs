import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDiscountRule } from '../src/utils/paymentDiscount.js';

const base = {
  isActive: true,
  discountEnabled: true,
  discountPercent: null,
  discountFixed: null,
  ignoreCoupons: false,
  generatesCashback: true,
  alwaysAvailable: true,
  schedule: null,
  allowedOrderTypes: null,
};

const ctx = (over = {}) => ({ orderType: 'DELIVERY', subtotal: 100, now: new Date('2026-05-10T13:00:00'), ...over });

test('disabled rule does not apply', () => {
  const r = evaluateDiscountRule({ ...base, discountEnabled: false }, ctx());
  assert.equal(r.applies, false);
  assert.equal(r.amount, 0);
});

test('inactive method does not apply', () => {
  const r = evaluateDiscountRule({ ...base, isActive: false }, ctx());
  assert.equal(r.applies, false);
});

test('percent discount on subtotal 100, 10% -> amount 10', () => {
  const r = evaluateDiscountRule({ ...base, discountPercent: 10 }, ctx());
  assert.equal(r.applies, true);
  assert.equal(r.amount, 10);
});

test('fixed discount 15 on subtotal 100 -> amount 15', () => {
  const r = evaluateDiscountRule({ ...base, discountFixed: 15 }, ctx());
  assert.equal(r.amount, 15);
});

test('fixed discount greater than subtotal is clamped', () => {
  const r = evaluateDiscountRule({ ...base, discountFixed: 200 }, ctx({ subtotal: 50 }));
  assert.equal(r.amount, 50);
});

test('percent rounded to 2 decimals', () => {
  const r = evaluateDiscountRule({ ...base, discountPercent: 7.5 }, ctx({ subtotal: 33.33 }));
  assert.equal(r.amount, 2.5); // 33.33 * 0.075 = 2.49975 → 2.5
});

test('schedule disabled day -> does not apply', () => {
  // 2026-05-10 is Sunday (day 0). Disable day 0.
  const sched = Array.from({ length: 7 }, (_, i) => ({ day: i, enabled: false, from: '00:00', to: '23:59' }));
  const r = evaluateDiscountRule(
    { ...base, alwaysAvailable: false, schedule: sched, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.applies, false);
});

test('schedule time inside window -> applies', () => {
  const sched = Array.from({ length: 7 }, (_, i) => ({ day: i, enabled: true, from: '11:00', to: '14:00' }));
  const r = evaluateDiscountRule(
    { ...base, alwaysAvailable: false, schedule: sched, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.applies, true);
});

test('schedule time before from -> does not apply', () => {
  const sched = Array.from({ length: 7 }, (_, i) => ({ day: i, enabled: true, from: '15:00', to: '18:00' }));
  const r = evaluateDiscountRule(
    { ...base, alwaysAvailable: false, schedule: sched, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.applies, false);
});

test('schedule with from > to (overnight) handles wrap', () => {
  const sched = Array.from({ length: 7 }, (_, i) => ({ day: i, enabled: true, from: '22:00', to: '02:00' }));
  const r = evaluateDiscountRule(
    { ...base, alwaysAvailable: false, schedule: sched, discountPercent: 10 },
    ctx({ now: new Date('2026-05-10T23:30:00') }),
  );
  assert.equal(r.applies, true);
});

test('allowedOrderTypes BALCAO matches INDOOR (synonym)', () => {
  const r = evaluateDiscountRule(
    { ...base, allowedOrderTypes: ['BALCAO'], discountPercent: 10 },
    ctx({ orderType: 'INDOOR' }),
  );
  assert.equal(r.applies, true);
});

test('allowedOrderTypes DELIVERY does not match PICKUP', () => {
  const r = evaluateDiscountRule(
    { ...base, allowedOrderTypes: ['DELIVERY'], discountPercent: 10 },
    ctx({ orderType: 'PICKUP' }),
  );
  assert.equal(r.applies, false);
});

test('allowedOrderTypes empty array applies to all', () => {
  const r = evaluateDiscountRule(
    { ...base, allowedOrderTypes: [], discountPercent: 10 },
    ctx({ orderType: 'PICKUP' }),
  );
  assert.equal(r.applies, true);
});

test('blocksCashback flips when generatesCashback=false and rule applies', () => {
  const r = evaluateDiscountRule(
    { ...base, generatesCashback: false, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.blocksCashback, true);
});

test('removesCoupon flips when ignoreCoupons=true and rule applies', () => {
  const r = evaluateDiscountRule(
    { ...base, ignoreCoupons: true, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.removesCoupon, true);
});
