import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areUnitsCompatible } from '../src/utils/unitConversion.js';

// Pure logic: simulate the conflict + force path the handler takes.
function resolveUnitChange({ existing, body, force, sheetItems, compositeItems }) {
  if (!body.unit || body.unit === existing.unit) {
    return { action: 'apply', conflicts: [], deletes: { sheets: [], composites: [] } };
  }
  const bad = [];
  for (const si of sheetItems) {
    if (!areUnitsCompatible(si.unit, body.unit)) {
      bad.push({ type: 'sheet', itemId: si.id, sheetId: si.technicalSheetId, sheetName: si.sheetName, itemUnit: si.unit });
    }
  }
  for (const ci of compositeItems) {
    if (!areUnitsCompatible(ci.unit, body.unit)) {
      bad.push({ type: 'composite', itemId: ci.id, compositeId: ci.compositeId, compositeName: ci.compositeName, itemUnit: ci.unit });
    }
  }
  if (bad.length === 0) return { action: 'apply', conflicts: [], deletes: { sheets: [], composites: [] } };
  if (force === 'remove_conflicts') {
    return {
      action: 'apply_after_delete',
      conflicts: bad,
      deletes: {
        sheets: bad.filter(b => b.type === 'sheet').map(b => b.itemId),
        composites: bad.filter(b => b.type === 'composite').map(b => b.itemId),
      },
    };
  }
  return { action: 'block', conflicts: bad, deletes: { sheets: [], composites: [] } };
}

test('resolveUnitChange: no change → apply immediately', () => {
  const r = resolveUnitChange({
    existing: { unit: 'KG' }, body: { unit: 'KG' }, force: null,
    sheetItems: [], compositeItems: [],
  });
  assert.equal(r.action, 'apply');
});

test('resolveUnitChange: compatible change → apply', () => {
  const r = resolveUnitChange({
    existing: { unit: 'KG' }, body: { unit: 'GR' }, force: null,
    sheetItems: [{ id: 's1', unit: 'KG', technicalSheetId: 'sh1', sheetName: 'X' }],
    compositeItems: [],
  });
  assert.equal(r.action, 'apply');
  assert.equal(r.conflicts.length, 0);
});

test('resolveUnitChange: incompatible change without force → block with conflicts', () => {
  const r = resolveUnitChange({
    existing: { unit: 'KG' }, body: { unit: 'UN' }, force: null,
    sheetItems: [
      { id: 's1', unit: 'GR', technicalSheetId: 'sh1', sheetName: 'Lanche' },
      { id: 's2', unit: 'GR', technicalSheetId: 'sh2', sheetName: 'Outro' },
    ],
    compositeItems: [{ id: 'c1', unit: 'GR', compositeId: 'cp1', compositeName: 'Mix' }],
  });
  assert.equal(r.action, 'block');
  assert.equal(r.conflicts.length, 3);
  assert.equal(r.conflicts[0].itemId, 's1');
  assert.equal(r.conflicts[2].compositeId, 'cp1');
});

test('resolveUnitChange: incompatible change with force=remove_conflicts → apply_after_delete', () => {
  const r = resolveUnitChange({
    existing: { unit: 'KG' }, body: { unit: 'UN' }, force: 'remove_conflicts',
    sheetItems: [
      { id: 's1', unit: 'GR', technicalSheetId: 'sh1', sheetName: 'Lanche' },
      { id: 's2', unit: 'GR', technicalSheetId: 'sh2', sheetName: 'Outro' },
    ],
    compositeItems: [{ id: 'c1', unit: 'GR', compositeId: 'cp1', compositeName: 'Mix' }],
  });
  assert.equal(r.action, 'apply_after_delete');
  assert.deepEqual(r.deletes.sheets.sort(), ['s1', 's2']);
  assert.deepEqual(r.deletes.composites, ['c1']);
});

test('resolveUnitChange: force ignored when no conflicts exist', () => {
  const r = resolveUnitChange({
    existing: { unit: 'KG' }, body: { unit: 'GR' }, force: 'remove_conflicts',
    sheetItems: [{ id: 's1', unit: 'KG', technicalSheetId: 'sh1', sheetName: 'X' }],
    compositeItems: [],
  });
  assert.equal(r.action, 'apply');
  assert.equal(r.conflicts.length, 0);
});
