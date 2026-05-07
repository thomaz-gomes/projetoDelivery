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
      settlementDays, settlementType, settlementDayOfWeek, periodStartDayOfWeek,
      settlementMonthlyDelay, anticipationEnabled, anticipationFeePercent,
      anticipationDays, rules,
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
        settlementType: settlementType || null,
        settlementDayOfWeek: settlementDayOfWeek != null ? Number(settlementDayOfWeek) : null,
        periodStartDayOfWeek: periodStartDayOfWeek != null ? Number(periodStartDayOfWeek) : null,
        settlementMonthlyDelay: settlementMonthlyDelay != null ? Number(settlementMonthlyDelay) : null,
        anticipationEnabled: Boolean(anticipationEnabled),
        anticipationFeePercent: anticipationFeePercent != null ? Number(anticipationFeePercent) : null,
        anticipationDays: anticipationDays != null ? Number(anticipationDays) : null,
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
      settlementDays, settlementType, settlementDayOfWeek, periodStartDayOfWeek,
      settlementMonthlyDelay, anticipationEnabled, anticipationFeePercent,
      anticipationDays, rules, isActive,
    } = req.body;

    const updated = await prisma.paymentGatewayConfig.update({
      where: { id: req.params.id },
      data: {
        ...(label !== undefined && { label }),
        ...(feeType !== undefined && { feeType }),
        ...(feePercent !== undefined && { feePercent: Number(feePercent) }),
        ...(feeFixed !== undefined && { feeFixed: Number(feeFixed) }),
        ...(settlementDays !== undefined && { settlementDays: Number(settlementDays) }),
        ...(settlementType !== undefined && { settlementType: settlementType || null }),
        ...(settlementDayOfWeek !== undefined && { settlementDayOfWeek: settlementDayOfWeek != null ? Number(settlementDayOfWeek) : null }),
        ...(periodStartDayOfWeek !== undefined && { periodStartDayOfWeek: periodStartDayOfWeek != null ? Number(periodStartDayOfWeek) : null }),
        ...(settlementMonthlyDelay !== undefined && { settlementMonthlyDelay: settlementMonthlyDelay != null ? Number(settlementMonthlyDelay) : null }),
        ...(anticipationEnabled !== undefined && { anticipationEnabled: Boolean(anticipationEnabled) }),
        ...(anticipationFeePercent !== undefined && { anticipationFeePercent: anticipationFeePercent != null ? Number(anticipationFeePercent) : null }),
        ...(anticipationDays !== undefined && { anticipationDays: anticipationDays != null ? Number(anticipationDays) : null }),
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

// POST /financial/gateways/repair-fee-percent
// Detecta e corrige PaymentGatewayConfig com feePercent armazenado como porcentagem (ex: 12)
// quando o sistema espera fração (0.12). Recalcula feeAmount/netAmount das FinancialTransaction
// já criadas com base nesse gateway.
//
// Body opcional: { dryRun: true } - apenas reporta o que seria alterado, sem aplicar.
router.post('/repair-fee-percent', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const dryRun = req.body?.dryRun === true;

    const broken = await prisma.paymentGatewayConfig.findMany({
      where: { companyId, feePercent: { gt: 1 } },
    });

    if (broken.length === 0) {
      return res.json({ dryRun, gatewaysFixed: 0, transactionsRecalculated: 0, gateways: [] });
    }

    const gatewayIds = broken.map((g) => g.id);
    const txs = await prisma.financialTransaction.findMany({
      where: { companyId, gatewayConfigId: { in: gatewayIds } },
      select: { id: true, gatewayConfigId: true, grossAmount: true, feeAmount: true, netAmount: true },
    });

    const summary = broken.map((g) => ({
      id: g.id,
      provider: g.provider,
      label: g.label,
      currentPercent: Number(g.feePercent),
      fixedPercent: Number(g.feePercent) / 100,
      transactionCount: txs.filter((t) => t.gatewayConfigId === g.id).length,
    }));

    if (dryRun) {
      return res.json({
        dryRun: true,
        gatewaysFixed: broken.length,
        transactionsRecalculated: txs.length,
        gateways: summary,
      });
    }

    // Aplicar correção em transação atômica
    await prisma.$transaction(async (tx) => {
      for (const g of broken) {
        const newPercent = Number(g.feePercent) / 100;
        await tx.paymentGatewayConfig.update({
          where: { id: g.id },
          data: { feePercent: newPercent },
        });

        const gatewayTxs = txs.filter((t) => t.gatewayConfigId === g.id);
        for (const t of gatewayTxs) {
          const gross = Number(t.grossAmount);
          const newFee = Math.round(gross * newPercent * 100) / 100;
          const newNet = Math.round((gross - newFee) * 100) / 100;
          await tx.financialTransaction.update({
            where: { id: t.id },
            data: { feeAmount: newFee, netAmount: newNet },
          });
        }
      }
    });

    res.json({
      dryRun: false,
      gatewaysFixed: broken.length,
      transactionsRecalculated: txs.length,
      gateways: summary,
    });
  } catch (e) {
    console.error('POST /financial/gateways/repair-fee-percent error:', e);
    res.status(500).json({ message: 'Erro ao corrigir taxas', error: e?.message });
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
