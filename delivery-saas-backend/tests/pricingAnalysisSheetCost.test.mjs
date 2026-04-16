import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToIngredientUnit, areUnitsCompatible } from '../src/utils/unitConversion.js';

function computeSheetCost(items) {
  let sheetCost = 0;
  for (const si of items || []) {
    if (!si.ingredient) continue;
    const itemUnit = si.unit || si.ingredient.unit;
    if (!areUnitsCompatible(itemUnit, si.ingredient.unit)) continue;
    const qty = normalizeToIngredientUnit(Number(si.quantity || 0), itemUnit, si.ingredient.unit);
    sheetCost += qty * Number(si.ingredient.avgCost || 0);
  }
  return sheetCost;
}

test('computeSheetCost converts GR to KG when ingredient is in KG', () => {
  const items = [
    { ingredient: { unit: 'KG', avgCost: 7.29 }, quantity: 100, unit: 'GR' },
  ];
  // 100 GR = 0.1 KG × 7.29 = 0.729
  assert.ok(Math.abs(computeSheetCost(items) - 0.729) < 0.001);
});

test('computeSheetCost handles multiple items with mixed units', () => {
  const items = [
    { ingredient: { unit: 'KG', avgCost: 10 }, quantity: 500, unit: 'GR' }, // 0.5 * 10 = 5
    { ingredient: { unit: 'UN', avgCost: 2 }, quantity: 3, unit: 'UN' },    // 3 * 2 = 6
    { ingredient: { unit: 'L', avgCost: 8 }, quantity: 250, unit: 'ML' },   // 0.25 * 8 = 2
  ];
  assert.equal(computeSheetCost(items), 13);
});

test('computeSheetCost uses ingredient unit when itemUnit is null', () => {
  const items = [
    { ingredient: { unit: 'KG', avgCost: 10 }, quantity: 0.5, unit: null },
  ];
  assert.equal(computeSheetCost(items), 5);
});

test('computeSheetCost skips items with incompatible units (legacy bad data)', () => {
  const items = [
    { ingredient: { unit: 'KG', avgCost: 10 }, quantity: 20, unit: 'UN' }, // incompat: skipped
    { ingredient: { unit: 'KG', avgCost: 5 }, quantity: 100, unit: 'GR' }, // 0.5 → 0.5
  ];
  assert.equal(computeSheetCost(items), 0.5);
});

test('computeSheetCost handles missing ingredient', () => {
  const items = [
    { ingredient: null, quantity: 10, unit: 'GR' },
    { ingredient: { unit: 'KG', avgCost: 10 }, quantity: 100, unit: 'GR' },
  ];
  assert.equal(computeSheetCost(items), 1);
});
