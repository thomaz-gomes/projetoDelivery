import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCMV, calculatePurchases } from '../src/routes/financial/reports.js';

test('calculateCMV sums OUT items × unitCost where ingredient.composesCmv and not reversed', async () => {
  const calls = [];
  const prismaMock = {
    stockMovement: {
      findMany: async ({ where }) => {
        calls.push(where);
        return [
          { id: 'm1', createdAt: new Date(), items: [
            { ingredientId: 'a', quantity: 100, unitCost: 0.5, ingredient: { composesCmv: true, description: 'Farinha', unit: 'GR' } },
            { ingredientId: 'b', quantity: 10, unitCost: 2.0, ingredient: { composesCmv: false, description: 'Decoração', unit: 'UN' } },
          ]},
        ];
      },
    },
  };
  const r = await calculateCMV(prismaMock, 'c1', new Date('2026-01-01'), new Date('2026-12-31'), null);
  assert.equal(calls[0].type, 'OUT');
  assert.equal(calls[0].reversedAt, null);
  assert.equal(r.total, -50, 'CMV total is negative (subtracts from profit)');
  assert.equal(r.details.length, 1, 'only ingredients with composesCmv=true are included');
});

test('calculateCMV ignores items with null unitCost (pre-snapshot OUTs)', async () => {
  const prismaMock = {
    stockMovement: {
      findMany: async () => [
        { id: 'm1', createdAt: new Date(), items: [
          { ingredientId: 'a', quantity: 100, unitCost: null, ingredient: { composesCmv: true, description: 'X', unit: 'GR' } },
        ]},
      ],
    },
  };
  const r = await calculateCMV(prismaMock, 'c1', new Date(), new Date(), null);
  assert.equal(r.total, 0);
});

test('calculatePurchases sums IN items × unitCost (legacy purchases view)', async () => {
  const calls = [];
  const prismaMock = {
    stockMovement: {
      findMany: async ({ where }) => {
        calls.push(where);
        return [{ id: 'm2', createdAt: new Date(), items: [
          { ingredientId: 'a', quantity: 1000, unitCost: 0.5, ingredient: { composesCmv: true } },
        ]}];
      },
    },
  };
  const r = await calculatePurchases(prismaMock, 'c1', new Date('2026-01-01'), new Date('2026-12-31'), null);
  assert.equal(calls[0].type, 'IN');
  assert.equal(r.total, 500);
});
