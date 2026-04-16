import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditSheetItems } from '../src/services/auditUnits.js';

test('auditSheetItems returns items with incompatible unit family', async () => {
  const items = [
    // bad: UN against KG
    { id: 'i1', unit: 'UN', quantity: 20, technicalSheet: { id: 's1', name: 'Lanche', companyId: 'c1' }, ingredient: { id: 'ing1', description: 'TOMATE', unit: 'KG' } },
    // good: GR against KG
    { id: 'i2', unit: 'GR', quantity: 100, technicalSheet: { id: 's1', name: 'Lanche', companyId: 'c1' }, ingredient: { id: 'ing2', description: 'FARINHA', unit: 'KG' } },
    // good: same unit
    { id: 'i3', unit: 'UN', quantity: 1, technicalSheet: { id: 's2', name: 'Sobremesa', companyId: 'c1' }, ingredient: { id: 'ing3', description: 'OVO', unit: 'UN' } },
    // bad: ML against UN
    { id: 'i4', unit: 'ML', quantity: 50, technicalSheet: { id: 's3', name: 'Drink', companyId: 'c1' }, ingredient: { id: 'ing4', description: 'LIMÃO', unit: 'UN' } },
    // good: null/empty unit → falls back to ingredient unit
    { id: 'i5', unit: null, quantity: 1, technicalSheet: { id: 's4', name: 'Pão', companyId: 'c1' }, ingredient: { id: 'ing5', description: 'SAL', unit: 'KG' } },
  ];
  const prismaMock = {
    technicalSheetItem: {
      findMany: async ({ where }) => {
        // expect filter by companyId
        return items.filter(i => i.technicalSheet.companyId === where.technicalSheet.companyId);
      },
    },
  };
  const result = await auditSheetItems(prismaMock, 'c1');
  assert.equal(result.items.length, 2);
  assert.equal(result.total, 2);
  assert.equal(result.truncated, false);
  const ids = result.items.map(r => r.itemId).sort();
  assert.deepEqual(ids, ['i1', 'i4']);
  // payload shape
  const i1 = result.items.find(r => r.itemId === 'i1');
  assert.equal(i1.sheetId, 's1');
  assert.equal(i1.sheetName, 'Lanche');
  assert.equal(i1.ingredientName, 'TOMATE');
  assert.equal(i1.itemUnit, 'UN');
  assert.equal(i1.ingredientUnit, 'KG');
});

test('auditSheetItems returns empty when all compatible', async () => {
  const prismaMock = { technicalSheetItem: { findMany: async () => [] } };
  const result = await auditSheetItems(prismaMock, 'c1');
  assert.deepEqual(result.items, []);
  assert.equal(result.total, 0);
  assert.equal(result.truncated, false);
});

test('auditSheetItems caps results at limit and flags truncated', async () => {
  // Generate 150 bad items (UN vs KG)
  const badItems = Array.from({ length: 150 }, (_, i) => ({
    id: `i${i}`,
    unit: 'UN',
    quantity: 1,
    technicalSheet: { id: 's1', name: 'Sheet', companyId: 'c1' },
    ingredient: { id: `ing${i}`, description: `ING${i}`, unit: 'KG' },
  }));
  const prismaMock = { technicalSheetItem: { findMany: async () => badItems } };
  const result = await auditSheetItems(prismaMock, 'c1');
  assert.equal(result.items.length, 100);
  assert.equal(result.total, 150);
  assert.equal(result.truncated, true);
});
