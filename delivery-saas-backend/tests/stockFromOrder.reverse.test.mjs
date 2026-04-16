import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reverseStockMovementForOrder } from '../src/services/stockFromOrder.js';

test('reverseStockMovementForOrder creates IN mirror and marks original OUT reversed', async () => {
  const original = {
    id: 'mv-out', type: 'OUT', companyId: 'c1', storeId: null, note: 'Order:o1',
    reversedAt: null,
    items: [{ ingredientId: 'ing1', quantity: 100, unitCost: 12.5 }],
  };
  const updates = [];
  const inserts = [];
  const itemInserts = [];
  const prismaMock = {
    stockMovement: {
      findFirst: async () => original,
      update: async ({ where, data }) => { updates.push({ where, data }); return { ...original, ...data }; },
      create: async ({ data }) => { inserts.push(data); return { id: 'mv-in', ...data }; },
    },
    stockMovementItem: { create: async ({ data }) => { itemInserts.push(data); return data; } },
    ingredient: {
      findUnique: async () => ({ id: 'ing1', currentStock: 900 }),
      update: async () => {},
    },
    $transaction: async (fn) => fn(prismaMock),
  };

  const result = await reverseStockMovementForOrder(prismaMock, 'o1', 'user-1');
  assert.ok(result, 'returns the new IN movement');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].type, 'IN');
  assert.equal(inserts[0].note, 'Reverse:Order:o1');
  assert.equal(inserts[0].companyId, 'c1');
  assert.equal(itemInserts.length, 1);
  assert.equal(Number(itemInserts[0].quantity), 100);
  assert.equal(Number(itemInserts[0].unitCost), 12.5);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.reversedBy, 'user-1');
  assert.ok(updates[0].data.reversedAt instanceof Date);
});

test('reverseStockMovementForOrder is idempotent (returns null if already reversed)', async () => {
  const prismaMock = { stockMovement: { findFirst: async () => null }, $transaction: async (fn) => fn(prismaMock) };
  const result = await reverseStockMovementForOrder(prismaMock, 'o1', 'user-1');
  assert.equal(result, null);
});

test('reverseStockMovementForOrder restores currentStock', async () => {
  const original = {
    id: 'mv-out', type: 'OUT', companyId: 'c1', storeId: null, note: 'Order:o1',
    reversedAt: null,
    items: [{ ingredientId: 'ing1', quantity: 50, unitCost: 1 }],
  };
  let updatedStock = null;
  const prismaMock = {
    stockMovement: {
      findFirst: async () => original,
      update: async () => ({}),
      create: async () => ({ id: 'mv-in' }),
    },
    stockMovementItem: { create: async () => ({}) },
    ingredient: {
      findUnique: async () => ({ id: 'ing1', currentStock: 900 }),
      update: async ({ data }) => { updatedStock = data.currentStock; },
    },
    $transaction: async (fn) => fn(prismaMock),
  };

  await reverseStockMovementForOrder(prismaMock, 'o1', null);
  assert.equal(Number(updatedStock), 950, 'stock should increase by reversed quantity');
});
