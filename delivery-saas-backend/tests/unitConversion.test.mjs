import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areUnitsCompatible, assertCompatibleUnit, normalizeToIngredientUnit, convertUnit } from '../src/utils/unitConversion.js';

test('areUnitsCompatible — same unit', () => {
  assert.equal(areUnitsCompatible('KG', 'KG'), true);
  assert.equal(areUnitsCompatible('UN', 'UN'), true);
});

test('areUnitsCompatible — same family', () => {
  assert.equal(areUnitsCompatible('GR', 'KG'), true);
  assert.equal(areUnitsCompatible('ML', 'L'), true);
  assert.equal(areUnitsCompatible('KG', 'GR'), true);
});

test('areUnitsCompatible — different families', () => {
  assert.equal(areUnitsCompatible('UN', 'KG'), false);
  assert.equal(areUnitsCompatible('KG', 'ML'), false);
  assert.equal(areUnitsCompatible('L', 'UN'), false);
});

test('areUnitsCompatible — empty itemUnit is always compatible (falls back to ingredient unit)', () => {
  assert.equal(areUnitsCompatible('', 'KG'), true);
  assert.equal(areUnitsCompatible(null, 'KG'), true);
});

test('areUnitsCompatible — unknown unit returns false', () => {
  assert.equal(areUnitsCompatible('XYZ', 'KG'), false);
});

test('assertCompatibleUnit — throws for incompatible', () => {
  assert.throws(() => assertCompatibleUnit('UN', 'KG'), /incompat/i);
});

test('assertCompatibleUnit — error has status 400 and code UNIT_INCOMPATIBLE', () => {
  try {
    assertCompatibleUnit('UN', 'KG');
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.status, 400);
    assert.equal(e.code, 'UNIT_INCOMPATIBLE');
  }
});

test('assertCompatibleUnit — passes for compatible', () => {
  assert.doesNotThrow(() => assertCompatibleUnit('GR', 'KG'));
  assert.doesNotThrow(() => assertCompatibleUnit('KG', 'KG'));
  assert.doesNotThrow(() => assertCompatibleUnit(null, 'KG'));
});

test('convertUnit — existing behavior for same family still works', () => {
  assert.equal(convertUnit(1000, 'GR', 'KG'), 1);
  assert.equal(convertUnit(0.5, 'KG', 'GR'), 500);
});

test('normalizeToIngredientUnit — existing behavior preserved', () => {
  assert.equal(normalizeToIngredientUnit(1000, 'GR', 'KG'), 1);
});

test('areUnitsCompatible — old services re-export still works', async () => {
  const { areUnitsCompatible: fromServices } = await import('../src/services/unitConversion.js');
  assert.equal(fromServices('GR', 'KG'), true);
  assert.equal(fromServices('UN', 'KG'), false);
  // Semantic change: empty is now compatible (was false before)
  assert.equal(fromServices('', 'KG'), true);
});

// Simulates what the route handler should do
test('route-level validation: rejects incompatible unit before persist', async () => {
  const ingredient = { id: 'ing1', unit: 'KG', avgCost: 5.90 };
  const body = { ingredientId: 'ing1', quantity: 20, unit: 'UN' };

  // Emulated handler logic
  const handler = async () => {
    try {
      assertCompatibleUnit(body.unit, ingredient.unit);
      return { status: 201, ok: true };
    } catch (e) {
      return { status: e.status, code: e.code, message: e.message };
    }
  };
  const res = await handler();
  assert.equal(res.status, 400);
  assert.equal(res.code, 'UNIT_INCOMPATIBLE');
});
