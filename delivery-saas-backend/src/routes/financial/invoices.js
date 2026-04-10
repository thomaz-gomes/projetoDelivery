import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

/**
 * Build the installment query filter for a given card + month.
 */
function buildInstallmentWhere(companyId, payablePaymentMethodId, monthStart, monthEnd) {
  return {
    companyId,
    payablePaymentMethodId,
    type: 'PAYABLE',
    status: { in: ['PENDING', 'CONFIRMED', 'OVERDUE'] },
    dueDate: { gte: monthStart, lte: monthEnd },
    parentTransactionId: { not: null },
  };
}

/**
 * Parse "YYYY-MM" into { monthStart, monthEnd } Date objects.
 * Defaults to current month when not provided.
 */
function parseMonth(monthParam) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-indexed

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    year = y;
    month = m - 1;
  }

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  return { monthStart, monthEnd, monthStr };
}

// GET /financial/invoices/summary
router.get('/summary', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { month } = req.query;
    const { monthStart, monthEnd, monthStr } = parseMonth(month);

    // Fetch all active credit-card payment methods for the company
    const cards = await prisma.payablePaymentMethod.findMany({
      where: { companyId, type: 'CREDIT_CARD', isActive: true },
      include: { account: { select: { id: true, name: true } } },
    });

    const summaries = await Promise.all(
      cards.map(async (card) => {
        const where = buildInstallmentWhere(companyId, card.id, monthStart, monthEnd);
        const parcelas = await prisma.financialTransaction.findMany({
          where,
          orderBy: { dueDate: 'asc' },
        });

        const total = parcelas.reduce(
          (sum, p) => sum + Number(p.grossAmount),
          0,
        );

        // Compute invoice due date from card.dueDay
        let dueDate = null;
        if (card.dueDay) {
          const dueDateObj = new Date(monthStart);
          dueDateObj.setDate(card.dueDay);
          dueDate = dueDateObj.toISOString().slice(0, 10);
        }

        return {
          card: {
            id: card.id,
            name: card.name,
            cardBrand: card.cardBrand,
            lastDigits: card.lastDigits,
            dueDay: card.dueDay,
            accountId: card.accountId,
          },
          month: monthStr,
          dueDate,
          parcelasCount: parcelas.length,
          total,
          parcelas,
        };
      }),
    );

    res.json(summaries);
  } catch (e) {
    console.error('GET /financial/invoices/summary error:', e);
    res.status(500).json({ message: 'Erro ao gerar resumo de faturas', error: e?.message });
  }
});

// POST /financial/invoices/pay
router.post('/pay', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { payablePaymentMethodId, month, accountId: bodyAccountId } = req.body;

    if (!payablePaymentMethodId || !month) {
      return res.status(400).json({ message: 'payablePaymentMethodId e month são obrigatórios' });
    }

    const { monthStart, monthEnd } = parseMonth(month);

    // Fetch the payment method
    const method = await prisma.payablePaymentMethod.findFirst({
      where: { id: payablePaymentMethodId, companyId },
    });
    if (!method) {
      return res.status(404).json({ message: 'Método de pagamento não encontrado' });
    }

    const accountId = bodyAccountId || method.accountId;
    if (!accountId) {
      return res.status(400).json({ message: 'accountId é obrigatório (não definido no método nem no body)' });
    }

    // Fetch pending installments
    const where = buildInstallmentWhere(companyId, payablePaymentMethodId, monthStart, monthEnd);
    const parcelas = await prisma.financialTransaction.findMany({ where });

    if (parcelas.length === 0) {
      return res.status(400).json({ message: 'Nenhuma parcela pendente encontrada para este cartão/mês' });
    }

    const totalAmount = parcelas.reduce((sum, p) => sum + Number(p.grossAmount), 0);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Decrement account balance
      const updatedAccount = await tx.financialAccount.update({
        where: { id: accountId },
        data: { currentBalance: { decrement: totalAmount } },
      });

      // Create a single CashFlowEntry for the whole invoice
      const entry = await tx.cashFlowEntry.create({
        data: {
          companyId,
          accountId,
          type: 'OUTFLOW',
          amount: totalAmount,
          balanceAfter: updatedAccount.currentBalance,
          entryDate: now,
          description: `Pagamento fatura ${method.name} - ${month}`,
          createdBy: req.user.id,
        },
      });

      // Update each installment to PAID
      await Promise.all(
        parcelas.map((p) =>
          tx.financialTransaction.update({
            where: { id: p.id },
            data: {
              status: 'PAID',
              paidAt: now,
              paidAmount: p.grossAmount,
              accountId,
            },
          }),
        ),
      );

      return { entry, paidCount: parcelas.length, totalAmount };
    });

    res.json(result);
  } catch (e) {
    console.error('POST /financial/invoices/pay error:', e);
    res.status(500).json({ message: 'Erro ao pagar fatura', error: e?.message });
  }
});

export default router;
