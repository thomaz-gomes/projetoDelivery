import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

// GET /financial/payment-methods — listar formas de pagamento da empresa
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const where = { companyId };
    if (req.query.activeOnly === 'true') where.isActive = true;

    const methods = await prisma.payablePaymentMethod.findMany({
      where,
      include: { account: { select: { id: true, name: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    res.json(methods);
  } catch (e) {
    console.error('GET /financial/payment-methods error:', e);
    res.status(500).json({ message: 'Erro ao listar formas de pagamento', error: e?.message });
  }
});

// POST /financial/payment-methods — criar forma de pagamento
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { name, type, closingDay, dueDay, cardBrand, lastDigits, creditLimit, accountId } = req.body;

    if (!name) return res.status(400).json({ message: 'Nome é obrigatório' });
    if (!type) return res.status(400).json({ message: 'Tipo é obrigatório' });

    if (type === 'CREDIT_CARD') {
      if (closingDay == null || dueDay == null) {
        return res.status(400).json({ message: 'Cartão de crédito exige dia de fechamento e dia de vencimento' });
      }
      if (closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31) {
        return res.status(400).json({ message: 'Dia de fechamento e vencimento devem ser entre 1 e 31' });
      }
    }

    const method = await prisma.payablePaymentMethod.create({
      data: {
        companyId,
        name,
        type,
        closingDay: closingDay ?? null,
        dueDay: dueDay ?? null,
        cardBrand: cardBrand || null,
        lastDigits: lastDigits || null,
        creditLimit: creditLimit ?? null,
        accountId: accountId || null,
      },
      include: { account: { select: { id: true, name: true } } },
    });
    res.status(201).json(method);
  } catch (e) {
    console.error('POST /financial/payment-methods error:', e);
    res.status(500).json({ message: 'Erro ao criar forma de pagamento', error: e?.message });
  }
});

// PUT /financial/payment-methods/:id — atualizar forma de pagamento
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.payablePaymentMethod.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Forma de pagamento não encontrada' });

    const { name, type, closingDay, dueDay, cardBrand, lastDigits, creditLimit, accountId, isActive } = req.body;

    const effectiveType = type ?? existing.type;
    if (effectiveType === 'CREDIT_CARD') {
      const effectiveClosing = closingDay ?? existing.closingDay;
      const effectiveDue = dueDay ?? existing.dueDay;
      if (effectiveClosing == null || effectiveDue == null) {
        return res.status(400).json({ message: 'Cartão de crédito exige dia de fechamento e dia de vencimento' });
      }
      if (effectiveClosing < 1 || effectiveClosing > 31 || effectiveDue < 1 || effectiveDue > 31) {
        return res.status(400).json({ message: 'Dia de fechamento e vencimento devem ser entre 1 e 31' });
      }
    }

    const updated = await prisma.payablePaymentMethod.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(closingDay !== undefined && { closingDay }),
        ...(dueDay !== undefined && { dueDay }),
        ...(cardBrand !== undefined && { cardBrand }),
        ...(lastDigits !== undefined && { lastDigits }),
        ...(creditLimit !== undefined && { creditLimit }),
        ...(accountId !== undefined && { accountId: accountId || null }),
        ...(isActive !== undefined && { isActive }),
      },
      include: { account: { select: { id: true, name: true } } },
    });
    res.json(updated);
  } catch (e) {
    console.error('PUT /financial/payment-methods/:id error:', e);
    res.status(500).json({ message: 'Erro ao atualizar forma de pagamento', error: e?.message });
  }
});

// DELETE /financial/payment-methods/:id — soft delete (desativar)
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.payablePaymentMethod.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Forma de pagamento não encontrada' });

    await prisma.payablePaymentMethod.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /financial/payment-methods/:id error:', e);
    res.status(500).json({ message: 'Erro ao remover forma de pagamento', error: e?.message });
  }
});

export default router;
