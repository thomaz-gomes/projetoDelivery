import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePricingAnalysis } from '../src/services/pricingAnalysis.js';

test('computePricingAnalysis with store defaults', () => {
  const r = computePricingAnalysis({
    currentPrice: 16.90,
    sheetCost: 8,
    productPackagingCost: null,
    productTargetMargin: null,
    storeDefaults: {
      defaultPackagingCost: 1, targetMarginPercent: 30,
      salesTaxPercent: 6, otherFeesPercent: 0, marketplaceFeePercent: 12, cardFeePercent: 3.5,
      cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40,
    },
  });
  assert.equal(r.packagingCost, 1);
  assert.equal(r.targetMarginPercent, 30);
  assert.equal(r.taxBreakdown.totalDeductionPct, 21.5);
  // suggestedPrice = 9 / (1 - 0.515) = 9 / 0.485 = 18.5567...
  assert.ok(Math.abs(r.suggestedPrice - 18.5567) < 0.01);
  assert.equal(r.cmvStatus, 'critical'); // 8/16.90 = 47.3% > 40%
});

test('computePricingAnalysis with product overrides', () => {
  const r = computePricingAnalysis({
    currentPrice: 25,
    sheetCost: 5,
    productPackagingCost: 2,
    productTargetMargin: 40,
    storeDefaults: {
      defaultPackagingCost: 1, targetMarginPercent: 30,
      salesTaxPercent: 6, otherFeesPercent: 0, marketplaceFeePercent: 0, cardFeePercent: 3,
      cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40,
    },
  });
  assert.equal(r.packagingCost, 2); // product override
  assert.equal(r.targetMarginPercent, 40); // product override
  // suggestedPrice = 7 / (1 - 0.49) = 7 / 0.51 = 13.725...
  assert.ok(Math.abs(r.suggestedPrice - 13.7255) < 0.01);
  assert.equal(r.cmvStatus, 'over_priced'); // 5/25 = 20% < 25% (cmvHealthyMin) → below healthy range
});

test('computePricingAnalysis handles zero price gracefully', () => {
  const r = computePricingAnalysis({
    currentPrice: 0, sheetCost: 5, productPackagingCost: null, productTargetMargin: null,
    storeDefaults: { defaultPackagingCost: 0, targetMarginPercent: 30, salesTaxPercent: 0, otherFeesPercent: 0, marketplaceFeePercent: 0, cardFeePercent: 0, cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40 },
  });
  assert.equal(r.cmvPercent, null); // can't divide by 0
  assert.equal(r.cmvStatus, 'unknown');
});

test('computePricingAnalysis returns null suggestedPrice when deductions >= 100%', () => {
  const r = computePricingAnalysis({
    currentPrice: 10, sheetCost: 5, productPackagingCost: null, productTargetMargin: null,
    storeDefaults: { defaultPackagingCost: 0, targetMarginPercent: 80, salesTaxPercent: 15, otherFeesPercent: 0, marketplaceFeePercent: 10, cardFeePercent: 5, cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40 },
  });
  assert.equal(r.suggestedPrice, null); // 80+30 = 110% > 100%
});

test('computePricingAnalysis includes otherFees in deductions', () => {
  const r = computePricingAnalysis({
    currentPrice: 20,
    sheetCost: 5,
    productPackagingCost: 0,
    productTargetMargin: 20,
    storeDefaults: {
      defaultPackagingCost: 0, targetMarginPercent: 20,
      salesTaxPercent: 6, otherFeesPercent: 4, marketplaceFeePercent: 12, cardFeePercent: 3,
      cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40,
    },
  });
  assert.equal(r.taxBreakdown.otherFees, 4);
  // totalDeductionPct = 6 + 4 + 12 + 3 = 25
  assert.equal(r.taxBreakdown.totalDeductionPct, 25);
  // suggestedPrice = 5 / (1 - 0.45) = 5 / 0.55 = 9.0909...
  assert.ok(Math.abs(r.suggestedPrice - 9.0909) < 0.01);
});
