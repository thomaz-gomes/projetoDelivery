import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCmvByProduct } from '../src/routes/financial/reports.js';

test('calculateCmvByProduct aggregates OUT cost by product via Order linkage', async () => {
  const prismaMock = {
    stockMovement: {
      findMany: async ({ where }) => {
        assert.equal(where.type, 'OUT');
        assert.equal(where.reversedAt, null);
        return [
          { id: 'mv1', note: 'Order:o1', items: [
            { quantity: 100, unitCost: 0.5, ingredient: { composesCmv: true } },
          ]},
        ];
      },
    },
    order: {
      findUnique: async ({ where }) => ({
        id: where.id,
        items: [{ productId: 'p1', quantity: 2, totalPrice: 30 }],
      }),
    },
    product: { findUnique: async ({ where }) => ({ id: where.id, name: 'X-Bacon', price: 15 }) },
  };
  const r = await calculateCmvByProduct(prismaMock, 'c1', new Date('2026-01-01'), new Date('2026-12-31'), null);
  assert.ok(Array.isArray(r));
  assert.equal(r.length, 1);
  assert.equal(r[0].productId, 'p1');
  assert.equal(r[0].productName, 'X-Bacon');
  assert.equal(r[0].cmvTotal, 50);
  assert.equal(r[0].revenueTotal, 30);
  assert.equal(r[0].qtySold, 2);
  assert.ok(Math.abs(r[0].marginPct - ((30 - 50) / 30) * 100) < 0.01);
});

test('calculateCmvByProduct distributes CMV across multiple products in same order proportionally to revenue', async () => {
  const prismaMock = {
    stockMovement: {
      findMany: async () => [
        { id: 'mv1', note: 'Order:o1', items: [{ quantity: 10, unitCost: 1.0, ingredient: { composesCmv: true } }] }, // total CMV = 10
      ],
    },
    order: {
      findUnique: async () => ({
        id: 'o1',
        items: [
          { productId: 'p1', quantity: 1, totalPrice: 30 },  // 75% of revenue → 7.5
          { productId: 'p2', quantity: 1, totalPrice: 10 },  // 25% of revenue → 2.5
        ],
      }),
    },
    product: { findUnique: async ({ where }) => ({ id: where.id, name: where.id }) },
  };
  const r = await calculateCmvByProduct(prismaMock, 'c1', new Date(), new Date(), null);
  const p1 = r.find(x => x.productId === 'p1');
  const p2 = r.find(x => x.productId === 'p2');
  assert.ok(Math.abs(p1.cmvTotal - 7.5) < 0.01);
  assert.ok(Math.abs(p2.cmvTotal - 2.5) < 0.01);
});

test('calculateCmvByProduct skips movements without Order: note', async () => {
  const prismaMock = {
    stockMovement: {
      findMany: async () => [
        { id: 'mv1', note: 'Manual adjustment', items: [{ quantity: 10, unitCost: 1.0 }] },
      ],
    },
    order: { findUnique: async () => null },
    product: { findUnique: async () => null },
  };
  const r = await calculateCmvByProduct(prismaMock, 'c1', new Date(), new Date(), null);
  assert.equal(r.length, 0);
});

test('calculateCmvByProduct skips items with null unitCost', async () => {
  const prismaMock = {
    stockMovement: {
      findMany: async () => [
        { id: 'mv1', note: 'Order:o1', items: [{ quantity: 10, unitCost: null }] },
      ],
    },
    order: { findUnique: async () => ({ id: 'o1', items: [{ productId: 'p1', quantity: 1, totalPrice: 20 }] }) },
    product: { findUnique: async ({ where }) => ({ id: where.id, name: 'X' }) },
  };
  const r = await calculateCmvByProduct(prismaMock, 'c1', new Date(), new Date(), null);
  // Order is found but contributes 0 CMV; product still appears with cmv=0
  assert.equal(r.length, 1);
  assert.equal(r[0].cmvTotal, 0);
});
