import express from 'express';
import { prisma } from '../../prisma.js';
import { recreateFinancialEntriesForProvider } from '../../services/financial/orderFinancialBridge.js';

const router = express.Router();

/**
 * GET /financial/settlements/pending?gatewayConfigId=xxx&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Lists pending marketplace repasses, grouped by (gatewayConfigId, expectedDate).
 * Each group bundles all RECEIVABLE rows of the same provider that fall on the
 * same settlement day, plus the matching ANTICIPATION_FEE PAYABLEs.
 *
 * Response shape:
 *   [
 *     {
 *       expectedDate: "2026-05-13",
 *       gatewayConfigId, gatewayProvider, gatewayLabel,
 *       totalReceivable: 5280.00,
 *       totalAnticipation: 0,
 *       expectedNet: 5280.00,           // = receivable - anticipation
 *       receivableCount: 12,
 *       receivableIds: [...], anticipationIds: [...],
 *     }
 *   ]
 */
router.get('/pending', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { gatewayConfigId, from, to } = req.query;

    const dateRange = {};
    if (from) dateRange.gte = new Date(from);
    if (to) dateRange.lte = new Date(to);

    const baseWhere = {
      companyId,
      status: { in: ['CONFIRMED', 'PENDING'] },
      ...(gatewayConfigId ? { gatewayConfigId: String(gatewayConfigId) } : { gatewayConfigId: { not: null } }),
      ...(Object.keys(dateRange).length ? { expectedDate: dateRange } : {}),
    };

    const [receivables, anticipations] = await Promise.all([
      prisma.financialTransaction.findMany({
        where: { ...baseWhere, type: 'RECEIVABLE', sourceType: 'ORDER' },
        select: { id: true, expectedDate: true, gatewayConfigId: true, netAmount: true, gatewayConfig: { select: { provider: true, label: true } } },
      }),
      prisma.financialTransaction.findMany({
        where: { ...baseWhere, type: 'PAYABLE', sourceType: 'ANTICIPATION_FEE', dueDate: dateRange.gte || dateRange.lte ? dateRange : undefined },
        select: { id: true, dueDate: true, gatewayConfigId: true, netAmount: true },
      }),
    ]);

    const groups = new Map();
    const keyOf = (configId, date) => `${configId}|${new Date(date).toISOString().slice(0, 10)}`;

    for (const r of receivables) {
      const key = keyOf(r.gatewayConfigId, r.expectedDate);
      const g = groups.get(key) || {
        expectedDate: new Date(r.expectedDate).toISOString().slice(0, 10),
        gatewayConfigId: r.gatewayConfigId,
        gatewayProvider: r.gatewayConfig?.provider || null,
        gatewayLabel: r.gatewayConfig?.label || null,
        totalReceivable: 0,
        totalAnticipation: 0,
        expectedNet: 0,
        receivableCount: 0,
        receivableIds: [],
        anticipationIds: [],
      };
      g.totalReceivable += Number(r.netAmount);
      g.receivableCount += 1;
      g.receivableIds.push(r.id);
      groups.set(key, g);
    }
    for (const a of anticipations) {
      const key = keyOf(a.gatewayConfigId, a.dueDate);
      const g = groups.get(key);
      if (!g) continue; // antecipação sem receivable correspondente — ignora
      g.totalAnticipation += Number(a.netAmount);
      g.anticipationIds.push(a.id);
    }
    for (const g of groups.values()) {
      g.expectedNet = Math.round((g.totalReceivable - g.totalAnticipation) * 100) / 100;
      g.totalReceivable = Math.round(g.totalReceivable * 100) / 100;
      g.totalAnticipation = Math.round(g.totalAnticipation * 100) / 100;
    }

    const out = Array.from(groups.values()).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    res.json(out);
  } catch (e) {
    console.error('GET /financial/settlements/pending error:', e);
    res.status(500).json({ message: 'Erro ao listar repasses', error: e?.message });
  }
});

/**
 * POST /financial/settlements/reconcile
 * Body: {
 *   expectedDate: "2026-05-13",
 *   gatewayConfigId: "...",
 *   actualAmount: 5278.50,    // what actually hit the bank
 *   accountId: "...",         // bank account that received
 *   paidAt?: "2026-05-13"     // optional override
 * }
 *
 * Atomically:
 *  1. Marks every RECEIVABLE in the group as PAID (paidAt, paidAmount).
 *  2. Marks every ANTICIPATION_FEE PAYABLE in the group as PAID.
 *  3. Updates the bank account balance by `actualAmount`.
 *  4. Creates a single CashFlowEntry of `actualAmount`.
 *  5. If actualAmount differs from expectedNet, creates an adjustment
 *     transaction so the books reconcile.
 */
router.post('/reconcile', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { expectedDate, gatewayConfigId, actualAmount, accountId, paidAt } = req.body || {};
    if (!expectedDate || !gatewayConfigId || actualAmount == null || !accountId) {
      return res.status(400).json({ message: 'expectedDate, gatewayConfigId, actualAmount e accountId são obrigatórios' });
    }
    const settledAt = paidAt ? new Date(paidAt) : new Date(expectedDate);
    const dayStart = new Date(`${expectedDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${expectedDate}T23:59:59.999Z`);
    const amount = Number(actualAmount);

    const result = await prisma.$transaction(async (tx) => {
      const receivables = await tx.financialTransaction.findMany({
        where: {
          companyId, gatewayConfigId, type: 'RECEIVABLE', sourceType: 'ORDER',
          status: { in: ['CONFIRMED', 'PENDING'] },
          expectedDate: { gte: dayStart, lte: dayEnd },
        },
      });
      const anticipations = await tx.financialTransaction.findMany({
        where: {
          companyId, gatewayConfigId, type: 'PAYABLE', sourceType: 'ANTICIPATION_FEE',
          status: { in: ['CONFIRMED', 'PENDING'] },
          dueDate: { gte: dayStart, lte: dayEnd },
        },
      });
      if (receivables.length === 0) throw new Error('Nenhuma receivable pendente neste repasse');

      const totalReceivable = receivables.reduce((s, r) => s + Number(r.netAmount), 0);
      const totalAnticipation = anticipations.reduce((s, a) => s + Number(a.netAmount), 0);
      const expectedNet = Math.round((totalReceivable - totalAnticipation) * 100) / 100;

      for (const r of receivables) {
        await tx.financialTransaction.update({
          where: { id: r.id },
          data: { status: 'PAID', paidAt: settledAt, paidAmount: Number(r.netAmount), accountId },
        });
      }
      for (const a of anticipations) {
        await tx.financialTransaction.update({
          where: { id: a.id },
          data: { status: 'PAID', paidAt: settledAt, paidAmount: Number(a.netAmount), accountId },
        });
      }

      // Update bank balance and create one consolidated CashFlowEntry
      const account = await tx.financialAccount.update({
        where: { id: accountId },
        data: { currentBalance: { increment: amount } },
      });
      await tx.cashFlowEntry.create({
        data: {
          companyId,
          accountId,
          type: 'INFLOW',
          amount,
          balanceAfter: account.currentBalance,
          description: `Repasse marketplace ${expectedDate} (${receivables.length} venda(s))`,
        },
      });

      const diff = Math.round((amount - expectedNet) * 100) / 100;
      let adjustmentId = null;
      if (Math.abs(diff) >= 0.01) {
        const adj = await tx.financialTransaction.create({
          data: {
            companyId,
            type: diff > 0 ? 'RECEIVABLE' : 'PAYABLE',
            status: 'PAID',
            description: `Diferença de repasse marketplace ${expectedDate}`,
            accountId,
            grossAmount: Math.abs(diff),
            feeAmount: 0,
            netAmount: Math.abs(diff),
            paidAmount: Math.abs(diff),
            dueDate: settledAt,
            paidAt: settledAt,
            issueDate: settledAt,
            sourceType: 'SETTLEMENT_ADJUSTMENT',
            sourceId: gatewayConfigId,
          },
        });
        adjustmentId = adj.id;
      }

      return {
        receivablesSettled: receivables.length,
        anticipationsSettled: anticipations.length,
        expectedNet,
        actualAmount: amount,
        difference: diff,
        adjustmentId,
      };
    });

    res.json(result);
  } catch (e) {
    console.error('POST /financial/settlements/reconcile error:', e);
    res.status(500).json({ message: 'Erro ao conciliar repasse', error: e?.message });
  }
});

/**
 * POST /financial/settlements/recreate
 * Body: { provider: "IFOOD", from?: ISO, to?: ISO }
 *
 * Apaga e recria os lançamentos financeiros das vendas do provider no período,
 * usando o modelo atual (receivable bruto + PAYABLEs separadas + datas de
 * settlement do gateway). Pula vendas cujo recebimento já foi conciliado.
 */
router.post('/recreate', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { provider, from, to } = req.body || {};
    if (!provider) return res.status(400).json({ message: 'provider é obrigatório' });
    const result = await recreateFinancialEntriesForProvider({ companyId, provider, from, to });
    res.json(result);
  } catch (e) {
    console.error('POST /financial/settlements/recreate error:', e);
    res.status(500).json({ message: 'Erro ao recriar lançamentos', error: e?.message });
  }
});

export default router;
