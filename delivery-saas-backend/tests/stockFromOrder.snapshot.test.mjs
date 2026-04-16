import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAndPersistStockMovementFromOrderItems } from '../src/services/stockFromOrder.js';

test('OUT movement snapshots ingredient.avgCost into StockMovementItem.unitCost', async () => {
  const ingredient = { id: 'ing1', avgCost: 12.50, controlsStock: true, unit: 'GR', currentStock: 1000 };
  const sheet = { id: 's1', items: [{ ingredientId: 'ing1', quantity: 100, unit: 'GR', ingredient }] };
  const product = { id: 'p1', companyId: 'c1', technicalSheetId: 's1' };

  const created = [];
  const prismaMock = {
    product: { findFirst: async () => product },
    technicalSheet: { findUnique: async () => sheet },
    ingredient: { findUnique: async () => ingredient, update: async () => {} },
    stockMovement: { create: async ({ data }) => ({ id: 'mv1', ...data }), findUnique: async () => ({ id: 'mv1', items: created }) },
    stockMovementItem: { create: async ({ data }) => { created.push(data); return data; } },
    productOptionGroup: { findMany: async () => [] },
    $transaction: async (fn) => fn(prismaMock),
  };

  await buildAndPersistStockMovementFromOrderItems(prismaMock, {
    id: 'o1', companyId: 'c1', items: [{ productId: 'p1', quantity: 1 }],
  });

  assert.equal(created.length, 1);
  assert.equal(Number(created[0].unitCost), 12.50);
});
