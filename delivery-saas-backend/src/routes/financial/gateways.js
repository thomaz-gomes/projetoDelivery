import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

// GET /financial/gateways - listar configurações de taxas
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { provider, isActive } = req.query;
    const where = { companyId };
    if (provider) where.provider = provider;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const configs = await prisma.paymentGatewayConfig.findMany({
      where,
      orderBy: { provider: 'asc' },
    });
    res.json(configs);
  } catch (e) {
    console.error('GET /financial/gateways error:', e);
    res.status(500).json({ message: 'Erro ao listar gateways', error: e?.message });
  }
});

// POST /financial/gateways
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      provider, label, feeType, feePercent, feeFixed,
      settlementDays, anticipationFeePercent, rules,
    } = req.body;

    if (!provider) return res.status(400).json({ message: 'provider é obrigatório' });

    const config = await prisma.paymentGatewayConfig.create({
      data: {
        companyId,
        provider: provider.toUpperCase(),
        label: label || null,
        feeType: feeType || 'PERCENTAGE',
        feePercent: Number(feePercent || 0),
        feeFixed: Number(feeFixed || 0),
        settlementDays: Number(settlementDays || 0),
        anticipationFeePercent: anticipationFeePercent != null ? Number(anticipationFeePercent) : null,
        rules: rules || null,
      },
    });
    res.status(201).json(config);
  } catch (e) {
    if (e?.code === 'P2002') return res.status(409).json({ message: 'Configuração já existe para este provider + label' });
    console.error('POST /financial/gateways error:', e);
    res.status(500).json({ message: 'Erro ao criar configuração', error: e?.message });
  }
});

// PUT /financial/gateways/:id
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.paymentGatewayConfig.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Configuração não encontrada' });

    const {
      label, feeType, feePercent, feeFixed,
      settlementDays, anticipationFeePercent, rules, isActive,
    } = req.body;

    const updated = await prisma.paymentGatewayConfig.update({
      where: { id: req.params.id },
      data: {
        ...(label !== undefined && { label }),
        ...(feeType !== undefined && { feeType }),
        ...(feePercent !== undefined && { feePercent: Number(feePercent) }),
        ...(feeFixed !== undefined && { feeFixed: Number(feeFixed) }),
        ...(settlementDays !== undefined && { settlementDays: Number(settlementDays) }),
        ...(anticipationFeePercent !== undefined && { anticipationFeePercent: anticipationFeePercent != null ? Number(anticipationFeePercent) : null }),
        ...(rules !== undefined && { rules }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json(updated);
  } catch (e) {
    console.error('PUT /financial/gateways/:id error:', e);
    res.status(500).json({ message: 'Erro ao atualizar configuração', error: e?.message });
  }
});

// DELETE /financial/gateways/:id
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.paymentGatewayConfig.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Configuração não encontrada' });

    await prisma.paymentGatewayConfig.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /financial/gateways/:id error:', e);
    res.status(500).json({ message: 'Erro ao remover configuração', error: e?.message });
  }
});

// POST /financial/gateways/simulate - simular taxas
router.post('/simulate', async (req, res) => {
  try {
    const { gatewayConfigId, grossAmount, transactionDate } = req.body;
    if (!gatewayConfigId || !grossAmount) {
      return res.status(400).json({ message: 'gatewayConfigId e grossAmount são obrigatórios' });
    }

    const { calculateFees } = await import('../../services/financial/feeCalculator.js');
    const result = await calculateFees(
      gatewayConfigId,
      Number(grossAmount),
      transactionDate ? new Date(transactionDate) : new Date()
    );
    res.json(result);
  } catch (e) {
    console.error('POST /financial/gateways/simulate error:', e);
    res.status(500).json({ message: 'Erro ao simular taxas', error: e?.message });
  }
});

export default router;
