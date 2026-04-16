import express from 'express';
import { prisma } from '../prisma.js';

const router = express.Router();

const DEFAULTS = {
  salesTaxPercent: 0,
  salesTaxLabel: null,
  otherFeesPercent: 0,
  otherFeesLabel: null,
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

export async function applyUpdate(prismaInstance, storeId, body, existing) {
  const numFields = ['salesTaxPercent', 'otherFeesPercent', 'marketplaceFeePercent', 'cardFeePercent', 'defaultPackagingCost', 'targetMarginPercent', 'cmvHealthyMin', 'cmvHealthyMax', 'cmvCriticalAbove'];
  const data = {};
  for (const f of numFields) {
    if (body[f] != null) {
      const n = Number(body[f]);
      if (Number.isNaN(n) || n < 0) throw new Error(`Campo inválido: ${f}`);
      data[f] = n;
    }
  }
  if (body.salesTaxLabel !== undefined) data.salesTaxLabel = body.salesTaxLabel != null ? String(body.salesTaxLabel) : null;
  if (body.otherFeesLabel !== undefined) data.otherFeesLabel = body.otherFeesLabel != null ? String(body.otherFeesLabel) : null;
  const min = data.cmvHealthyMin ?? Number(existing.cmvHealthyMin);
  const max = data.cmvHealthyMax ?? Number(existing.cmvHealthyMax);
  const crit = data.cmvCriticalAbove ?? Number(existing.cmvCriticalAbove);
  if (min >= max) throw new Error('cmvHealthyMin deve ser menor que cmvHealthyMax');
  if (max >= crit) throw new Error('cmvHealthyMax deve ser menor que cmvCriticalAbove');
  return await prismaInstance.storePricingDefaults.update({ where: { storeId }, data });
}

router.get('/:storeId/pricing-defaults', async (req, res) => {
  try {
    const store = await prisma.store.findFirst({ where: { id: req.params.storeId, companyId: req.user.companyId } });
    if (!store) return res.status(404).json({ message: 'Loja não encontrada' });
    const data = await getOrCreateDefaults(prisma, req.params.storeId);
    res.json(data);
  } catch (e) {
    console.error('GET pricing-defaults error:', e);
    res.status(500).json({ message: e.message });
  }
});

router.put('/:storeId/pricing-defaults', async (req, res) => {
  try {
    const store = await prisma.store.findFirst({ where: { id: req.params.storeId, companyId: req.user.companyId } });
    if (!store) return res.status(404).json({ message: 'Loja não encontrada' });
    const existing = await getOrCreateDefaults(prisma, req.params.storeId);
    const data = await applyUpdate(prisma, req.params.storeId, req.body || {}, existing);
    res.json(data);
  } catch (e) {
    console.error('PUT pricing-defaults error:', e);
    res.status(400).json({ message: e.message });
  }
});

export default router;
