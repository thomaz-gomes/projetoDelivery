import express from 'express';
import { prisma } from '../prisma.js';

const router = express.Router();

const DEFAULTS = {
  salesTaxPercent: 0,
  salesTaxLabel: null,
  marketplaceFeePercent: 0,
  cardFeePercent: 0,
  defaultPackagingCost: 0,
  targetMarginPercent: 30,
  cmvHealthyMin: 25,
  cmvHealthyMax: 35,
  cmvCriticalAbove: 40,
};

export async function getOrCreateDefaults(prismaInstance, storeId) {
  const existing = await prismaInstance.storePricingDefaults.findUnique({ where: { storeId } });
  if (existing) return existing;
  return await prismaInstance.storePricingDefaults.create({ data: { storeId, ...DEFAULTS } });
}

export async function applyUpdate(prismaInstance, storeId, body) {
  const numFields = ['salesTaxPercent', 'marketplaceFeePercent', 'cardFeePercent', 'defaultPackagingCost', 'targetMarginPercent', 'cmvHealthyMin', 'cmvHealthyMax', 'cmvCriticalAbove'];
  const data = {};
  for (const f of numFields) {
    if (body[f] != null) {
      const n = Number(body[f]);
      if (Number.isNaN(n) || n < 0) throw new Error(`Campo inválido: ${f}`);
      data[f] = n;
    }
  }
  if (body.salesTaxLabel !== undefined) data.salesTaxLabel = body.salesTaxLabel != null ? String(body.salesTaxLabel) : null;
  const min = data.cmvHealthyMin ?? null;
  const max = data.cmvHealthyMax ?? null;
  if (min != null && max != null && min >= max) throw new Error('cmvHealthyMin deve ser menor que cmvHealthyMax');
  return await prismaInstance.storePricingDefaults.update({ where: { storeId }, data });
}

router.get('/:storeId/pricing-defaults', async (req, res) => {
  try {
    const data = await getOrCreateDefaults(prisma, req.params.storeId);
    res.json(data);
  } catch (e) {
    console.error('GET pricing-defaults error:', e);
    res.status(500).json({ message: e.message });
  }
});

router.put('/:storeId/pricing-defaults', async (req, res) => {
  try {
    await getOrCreateDefaults(prisma, req.params.storeId);
    const data = await applyUpdate(prisma, req.params.storeId, req.body || {});
    res.json(data);
  } catch (e) {
    console.error('PUT pricing-defaults error:', e);
    res.status(400).json({ message: e.message });
  }
});

export default router;
