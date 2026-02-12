import express from 'express';
import { prisma } from '../../prisma.js';
import { calculateFees } from '../../services/financial/feeCalculator.js';

const router = express.Router();

// GET /financial/transactions - listar transações financeiras com filtros
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      type, status, accountId, costCenterId, sourceType,
      dueDateFrom, dueDateTo, issueDateFrom, issueDateTo,
      page = 1, limit = 50,
    } = req.query;

    const where = { companyId };
    if (type) where.type = type;
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;
    if (costCenterId) where.costCenterId = costCenterId;
    if (sourceType) where.sourceType = sourceType;
    if (dueDateFrom || dueDateTo) {
      where.dueDate = {};
      if (dueDateFrom) where.dueDate.gte = new Date(dueDateFrom);
      if (dueDateTo) where.dueDate.lte = new Date(dueDateTo);
    }
    if (issueDateFrom || issueDateTo) {
      where.issueDate = {};
      if (issueDateFrom) where.issueDate.gte = new Date(issueDateFrom);
      if (issueDateTo) where.issueDate.lte = new Date(issueDateTo);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [transactions, total] = await Promise.all([
      prisma.financialTransaction.findMany({
        where,
        include: {
          account: { select: { id: true, name: true, type: true } },
          costCenter: { select: { id: true, code: true, name: true } },
          gatewayConfig: { select: { id: true, provider: true, label: true } },
        },
        orderBy: { dueDate: 'asc' },
        skip,
        take: Number(limit),
      }),
      prisma.financialTransaction.count({ where }),
    ]);

    res.json({ data: transactions, total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    console.error('GET /financial/transactions error:', e);
    res.status(500).json({ message: 'Erro ao listar transações', error: e?.message });
  }
});

// GET /financial/transactions/:id
router.get('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const tx = await prisma.financialTransaction.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        account: true,
        costCenter: true,
        gatewayConfig: true,
        cashFlowEntries: { orderBy: { entryDate: 'desc' } },
      },
    });
    if (!tx) return res.status(404).json({ message: 'Transação não encontrada' });
    res.json(tx);
  } catch (e) {
    console.error('GET /financial/transactions/:id error:', e);
    res.status(500).json({ message: 'Erro ao buscar transação', error: e?.message });
  }
});

// POST /financial/transactions - criar título financeiro
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      type, description, accountId, costCenterId, gatewayConfigId,
      grossAmount, dueDate, sourceType, sourceId, notes,
      recurrence, installmentNumber, totalInstallments, parentTransactionId,
    } = req.body;

    if (!type || !description || !grossAmount || !dueDate) {
      return res.status(400).json({ message: 'type, description, grossAmount e dueDate são obrigatórios' });
    }

    // Calcular taxas se gatewayConfigId fornecido
    let feeAmount = 0;
    let netAmount = Number(grossAmount);
    let expectedDate = null;

    if (gatewayConfigId) {
      const result = await calculateFees(gatewayConfigId, Number(grossAmount), new Date(dueDate));
      feeAmount = result.feeAmount;
      netAmount = result.netAmount;
      expectedDate = result.expectedDate;
    }

    const tx = await prisma.financialTransaction.create({
      data: {
        companyId,
        type,
        description,
        accountId: accountId || null,
        costCenterId: costCenterId || null,
        gatewayConfigId: gatewayConfigId || null,
        grossAmount: Number(grossAmount),
        feeAmount,
        netAmount,
        dueDate: new Date(dueDate),
        expectedDate,
        sourceType: sourceType || 'MANUAL',
        sourceId: sourceId || null,
        notes: notes || null,
        recurrence: recurrence || 'NONE',
        installmentNumber: installmentNumber || null,
        totalInstallments: totalInstallments || null,
        parentTransactionId: parentTransactionId || null,
        createdBy: req.user.id,
      },
      include: {
        account: { select: { id: true, name: true } },
        costCenter: { select: { id: true, code: true, name: true } },
      },
    });
    res.status(201).json(tx);
  } catch (e) {
    console.error('POST /financial/transactions error:', e);
    res.status(500).json({ message: 'Erro ao criar transação', error: e?.message });
  }
});

// PUT /financial/transactions/:id
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.financialTransaction.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Transação não encontrada' });

    const {
      description, accountId, costCenterId, gatewayConfigId,
      grossAmount, dueDate, status, notes,
    } = req.body;

    const data = { updatedBy: req.user.id };
    if (description !== undefined) data.description = description;
    if (accountId !== undefined) data.accountId = accountId;
    if (costCenterId !== undefined) data.costCenterId = costCenterId;
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) data.status = status;
    if (dueDate !== undefined) data.dueDate = new Date(dueDate);

    // Recalcular taxas se grossAmount ou gatewayConfigId mudou
    if (grossAmount !== undefined || gatewayConfigId !== undefined) {
      const gw = gatewayConfigId !== undefined ? gatewayConfigId : existing.gatewayConfigId;
      const gross = grossAmount !== undefined ? Number(grossAmount) : Number(existing.grossAmount);
      data.grossAmount = gross;
      if (gatewayConfigId !== undefined) data.gatewayConfigId = gatewayConfigId;

      if (gw) {
        const result = await calculateFees(gw, gross, data.dueDate || existing.dueDate);
        data.feeAmount = result.feeAmount;
        data.netAmount = result.netAmount;
        data.expectedDate = result.expectedDate;
      } else {
        data.feeAmount = 0;
        data.netAmount = gross;
      }
    }

    const updated = await prisma.financialTransaction.update({
      where: { id: req.params.id },
      data,
      include: {
        account: { select: { id: true, name: true } },
        costCenter: { select: { id: true, code: true, name: true } },
      },
    });
    res.json(updated);
  } catch (e) {
    console.error('PUT /financial/transactions/:id error:', e);
    res.status(500).json({ message: 'Erro ao atualizar transação', error: e?.message });
  }
});

// POST /financial/transactions/:id/pay - registrar pagamento/recebimento
router.post('/:id/pay', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.financialTransaction.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Transação não encontrada' });

    const { amount, accountId, notes } = req.body;
    const payAmount = amount !== undefined ? Number(amount) : Number(existing.netAmount);
    const targetAccountId = accountId || existing.accountId;

    if (!targetAccountId) {
      return res.status(400).json({ message: 'accountId é obrigatório (nenhuma conta padrão definida)' });
    }

    // Criar movimentação real (CashFlowEntry)
    const entryType = existing.type === 'RECEIVABLE' ? 'INFLOW' : 'OUTFLOW';

    // Usar transação Prisma para atomicidade
    const result = await prisma.$transaction(async (tx) => {
      // Atualizar saldo da conta
      const balanceChange = entryType === 'INFLOW' ? payAmount : -payAmount;
      const account = await tx.financialAccount.update({
        where: { id: targetAccountId },
        data: { currentBalance: { increment: balanceChange } },
      });

      // Criar entrada no fluxo de caixa
      const entry = await tx.cashFlowEntry.create({
        data: {
          companyId,
          accountId: targetAccountId,
          transactionId: existing.id,
          type: entryType,
          amount: payAmount,
          balanceAfter: account.currentBalance,
          description: `Pagamento: ${existing.description}`,
          createdBy: req.user.id,
          notes: notes || null,
        },
      });

      // Atualizar status da transação
      const newPaidAmount = Number(existing.paidAmount) + payAmount;
      const fullyPaid = newPaidAmount >= Number(existing.netAmount);
      const updatedTx = await tx.financialTransaction.update({
        where: { id: existing.id },
        data: {
          paidAmount: newPaidAmount,
          paidAt: fullyPaid ? new Date() : existing.paidAt,
          status: fullyPaid ? 'PAID' : 'PARTIALLY',
          accountId: targetAccountId,
          updatedBy: req.user.id,
        },
      });

      return { transaction: updatedTx, entry };
    });

    res.json(result);
  } catch (e) {
    console.error('POST /financial/transactions/:id/pay error:', e);
    res.status(500).json({ message: 'Erro ao registrar pagamento', error: e?.message });
  }
});

// POST /financial/transactions/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.financialTransaction.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Transação não encontrada' });
    if (existing.status === 'PAID') {
      return res.status(400).json({ message: 'Não é possível cancelar transação já paga. Use estorno.' });
    }

    const updated = await prisma.financialTransaction.update({
      where: { id: req.params.id },
      data: { status: 'CANCELED', updatedBy: req.user.id },
    });
    res.json(updated);
  } catch (e) {
    console.error('POST /financial/transactions/:id/cancel error:', e);
    res.status(500).json({ message: 'Erro ao cancelar transação', error: e?.message });
  }
});

// DELETE /financial/transactions/:id - somente PENDING
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.financialTransaction.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Transação não encontrada' });
    if (existing.status !== 'PENDING') {
      return res.status(400).json({ message: 'Somente transações pendentes podem ser excluídas' });
    }

    await prisma.financialTransaction.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /financial/transactions/:id error:', e);
    res.status(500).json({ message: 'Erro ao excluir transação', error: e?.message });
  }
});

export default router;
