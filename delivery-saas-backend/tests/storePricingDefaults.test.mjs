import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOrCreateDefaults, applyUpdate } from '../src/routes/storePricingDefaults.js';

test('getOrCreateDefaults returns existing record when found', async () => {
  const existing = { storeId: 's1', targetMarginPercent: 25 };
  const prismaMock = { storePricingDefaults: { findUnique: async () => existing, create: async () => { throw new Error('should not create'); } } };
  const r = await getOrCreateDefaults(prismaMock, 's1');
  assert.equal(r.storeId, 's1');
  assert.equal(r.targetMarginPercent, 25);
});

test('getOrCreateDefaults creates with defaults when not found', async () => {
  const created = [];
  const prismaMock = { storePricingDefaults: { findUnique: async () => null, create: async ({ data }) => { created.push(data); return data; } } };
  const r = await getOrCreateDefaults(prismaMock, 's1');
  assert.equal(created.length, 1);
  assert.equal(r.storeId, 's1');
  assert.equal(Number(r.targetMarginPercent), 30);
  assert.equal(Number(r.cmvHealthyMin), 25);
  assert.equal(Number(r.cmvHealthyMax), 35);
  assert.equal(Number(r.cmvCriticalAbove), 40);
});

test('applyUpdate rejects negative values', async () => {
  const existing = { cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40 };
  await assert.rejects(() => applyUpdate({}, 's1', { targetMarginPercent: -5 }, existing), /inválido/i);
});

test('applyUpdate rejects cmvHealthyMin >= cmvHealthyMax', async () => {
  const existing = { cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40 };
  await assert.rejects(() => applyUpdate({}, 's1', { cmvHealthyMin: 50 }, existing), /cmvHealthy/i);
});

test('applyUpdate calls prisma update with valid data', async () => {
  const updates = [];
  const prismaMock = { storePricingDefaults: { update: async ({ data }) => { updates.push(data); return data; } } };
  const existing = { cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40 };
  await applyUpdate(prismaMock, 's1', { salesTaxPercent: 6, salesTaxLabel: 'Simples Nacional' }, existing);
  assert.equal(updates.length, 1);
  assert.equal(Number(updates[0].salesTaxPercent), 6);
  assert.equal(updates[0].salesTaxLabel, 'Simples Nacional');
});
