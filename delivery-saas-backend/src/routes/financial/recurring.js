import express from 'express';
import { prisma } from '../../prisma.js';
import { generateForTemplate } from '../../jobs/generateRecurringExpenses.js';

const router = express.Router();

// GET /financial/recurring
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { isActive } = req.query;
    const where = { companyId };
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const items = await prisma.recurringExpense.findMany({
      where,
      include: {
        account: { select: { id: true, name: true } },
        costCenter: { select: { id: true, code: true, name: true, natureza: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { nextDueDate: 'asc' },
    });
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar despesas recorrentes', error: e?.message });
  }
});

// POST /financial/recurring
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { description, grossAmount, accountId, costCenterId, supplierId, recurrence, dayOfMonth, notes, nextDueDate } = req.body;

    if (!description || !grossAmount || !recurrence || !nextDueDate) {
      return res.status(400).json({ message: 'description, grossAmount, recurrence e nextDueDate são obrigatórios' });
    }

    const item = await prisma.recurringExpense.create({
      data: {
        companyId,
        description,
        grossAmount: Number(grossAmount),
        accountId: accountId || null,
        costCenterId: costCenterId || null,
        supplierId: supplierId || null,
        recurrence,
        dayOfMonth: dayOfMonth ? Number(dayOfMonth) : null,
        notes: notes || null,
        nextDueDate: new Date(nextDueDate),
      },
    });

    // Generate first transaction immediately if nextDueDate <= today + 3 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 3);
    if (new Date(nextDueDate) <= cutoff) {
      await generateForTemplate(item, companyId);
    }

    res.status(201).json(item);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao criar despesa recorrente', error: e?.message });
  }
});

// PUT /financial/recurring/:id
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.recurringExpense.findFirst({ where: { id: req.params.id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Não encontrado' });

    const { description, grossAmount, accountId, costCenterId, supplierId, recurrence, dayOfMonth, notes, nextDueDate, isActive } = req.body;
    const data = {};
    if (description !== undefined) data.description = description;
    if (grossAmount !== undefined) data.grossAmount = Number(grossAmount);
    if (accountId !== undefined) data.accountId = accountId || null;
    if (costCenterId !== undefined) data.costCenterId = costCenterId || null;
    if (supplierId !== undefined) data.supplierId = supplierId || null;
    if (recurrence !== undefined) data.recurrence = recurrence;
    if (dayOfMonth !== undefined) data.dayOfMonth = dayOfMonth ? Number(dayOfMonth) : null;
    if (notes !== undefined) data.notes = notes || null;
    if (nextDueDate !== undefined) data.nextDueDate = new Date(nextDueDate);
    if (isActive !== undefined) data.isActive = isActive;

    const updated = await prisma.recurringExpense.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar', error: e?.message });
  }
});

// DELETE /financial/recurring/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.recurringExpense.findFirst({ where: { id: req.params.id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Não encontrado' });
    await prisma.recurringExpense.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao desativar', error: e?.message });
  }
});

// POST /financial/recurring/:id/generate (manual trigger)
router.post('/:id/generate', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const item = await prisma.recurringExpense.findFirst({ where: { id: req.params.id, companyId } });
    if (!item) return res.status(404).json({ message: 'Não encontrado' });
    const tx = await generateForTemplate(item, companyId);
    res.json({ ok: true, transaction: tx });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao gerar lançamento', error: e?.message });
  }
});

export default router;
