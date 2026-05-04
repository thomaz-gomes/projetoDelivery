import express from 'express';
import { prisma } from '../../prisma.js';
import { parseOfxContent, matchOfxItems } from '../../services/financial/ofxProcessor.js';

const router = express.Router();

// POST /financial/ofx/import - importar arquivo OFX
router.post('/import', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { accountId, content, fileName } = req.body;

    if (!accountId || !content) {
      return res.status(400).json({ message: 'accountId e content (OFX em texto) são obrigatórios' });
    }

    // Verificar se conta pertence à empresa
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!account) return res.status(404).json({ message: 'Conta não encontrada' });

    // Parse do conteúdo OFX
    const parsed = parseOfxContent(content);
    if (!parsed || !parsed.transactions || !parsed.transactions.length) {
      return res.status(400).json({ message: 'Nenhuma transação encontrada no arquivo OFX' });
    }

    // Criar registro de importação
    const ofxImport = await prisma.ofxImport.create({
      data: {
        companyId,
        accountId,
        fileName: fileName || 'import.ofx',
        periodStart: parsed.periodStart || null,
        periodEnd: parsed.periodEnd || null,
        totalItems: parsed.transactions.length,
        importedBy: req.user.id,
        status: 'PROCESSING',
      },
    });

    // Criar itens na fila de conciliação
    const items = [];
    for (const tx of parsed.transactions) {
      const item = await prisma.ofxReconciliationItem.create({
        data: {
          importId: ofxImport.id,
          fitId: tx.fitId || null,
          ofxType: tx.type || null,
          amount: Number(tx.amount),
          ofxDate: new Date(tx.date),
          memo: tx.memo || null,
          checkNum: tx.checkNum || null,
          refNum: tx.refNum || null,
        },
      });
      items.push(item);
    }

    // Tentar match automático
    const matchResult = await matchOfxItems(companyId, ofxImport.id, items);

    // Stage 2: AI reconciliation for remaining pending items
    let aiMatchResults = null;
    try {
      const { reconcileOfxItems } = await import('../../services/financial/ofxAiMatcher.js');
      aiMatchResults = await reconcileOfxItems(ofxImport.id, companyId);
    } catch (e) {
      console.error('[ofx] reconciliation error:', e.message);
    }

    // Atualizar importação com resultado
    const totalMatched = matchResult.matched + (aiMatchResults ? aiMatchResults.exact + aiMatchResults.aiAuto : 0);
    const totalUnmatched = (aiMatchResults ? aiMatchResults.unmatched + aiMatchResults.aiSuggested : matchResult.unmatched);
    await prisma.ofxImport.update({
      where: { id: ofxImport.id },
      data: {
        status: 'COMPLETED',
        matchedItems: totalMatched,
        unmatchedItems: totalUnmatched,
      },
    });

    res.status(201).json({
      import: ofxImport,
      totalItems: items.length,
      matched: totalMatched,
      unmatched: totalUnmatched,
      aiMatchResults,
    });
  } catch (e) {
    console.error('POST /financial/ofx/import error:', e);
    res.status(500).json({ message: 'Erro ao importar OFX', error: e?.message });
  }
});

// GET /financial/ofx/imports - listar importações
router.get('/imports', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const imports = await prisma.ofxImport.findMany({
      where: { companyId },
      include: { account: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(imports);
  } catch (e) {
    console.error('GET /financial/ofx/imports error:', e);
    res.status(500).json({ message: 'Erro ao listar importações', error: e?.message });
  }
});

// GET /financial/ofx/imports/:id/items - itens de uma importação (fila de conciliação)
router.get('/imports/:id/items', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const importRecord = await prisma.ofxImport.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!importRecord) return res.status(404).json({ message: 'Importação não encontrada' });

    const { matchStatus } = req.query;
    const where = { importId: req.params.id };
    if (matchStatus) where.matchStatus = matchStatus;

    const items = await prisma.ofxReconciliationItem.findMany({
      where,
      include: {
        transaction: { select: { id: true, description: true, grossAmount: true, dueDate: true } },
        cashFlowEntry: { select: { id: true, description: true, amount: true, entryDate: true } },
      },
      orderBy: { ofxDate: 'asc' },
    });
    res.json(items);
  } catch (e) {
    console.error('GET /financial/ofx/imports/:id/items error:', e);
    res.status(500).json({ message: 'Erro ao listar itens', error: e?.message });
  }
});

// POST /financial/ofx/items/:id/match - match manual
router.post('/items/:id/match', async (req, res) => {
  try {
    const { transactionId, cashFlowEntryId, action } = req.body;

    if (action === 'ignore') {
      const updated = await prisma.ofxReconciliationItem.update({
        where: { id: req.params.id },
        data: {
          matchStatus: 'IGNORED',
          resolvedBy: req.user.id,
          resolvedAt: new Date(),
          matchNotes: req.body.notes || 'Ignorado manualmente',
        },
      });
      return res.json(updated);
    }

    if (action === 'undo') {
      const updated = await prisma.ofxReconciliationItem.update({
        where: { id: req.params.id },
        data: {
          matchStatus: 'PENDING',
          transactionId: null,
          cashFlowEntryId: null,
          matchConfidence: null,
          matchMethod: null,
          resolvedBy: null,
          resolvedAt: null,
          matchNotes: null,
          aiReasoning: null,
        },
      });
      return res.json(updated);
    }

    if (!transactionId && !cashFlowEntryId) {
      return res.status(400).json({ message: 'transactionId ou cashFlowEntryId é obrigatório' });
    }

    const updated = await prisma.ofxReconciliationItem.update({
      where: { id: req.params.id },
      data: {
        matchStatus: 'MANUAL',
        transactionId: transactionId || null,
        cashFlowEntryId: cashFlowEntryId || null,
        matchConfidence: 1.0,
        resolvedBy: req.user.id,
        resolvedAt: new Date(),
        matchNotes: req.body.notes || 'Conciliado manualmente',
      },
    });

    // Marcar a CashFlowEntry como conciliada se vinculada
    if (cashFlowEntryId) {
      await prisma.cashFlowEntry.update({
        where: { id: cashFlowEntryId },
        data: { reconciled: true, reconciledAt: new Date() },
      });
    }

    res.json(updated);
  } catch (e) {
    console.error('POST /financial/ofx/items/:id/match error:', e);
    res.status(500).json({ message: 'Erro ao conciliar item', error: e?.message });
  }
});

// POST /financial/ofx/:importId/reconcile — re-run AI reconciliation
router.post('/:importId/reconcile', async (req, res) => {
  try {
    const { reconcileOfxItems } = await import('../../services/financial/ofxAiMatcher.js');
    const results = await reconcileOfxItems(req.params.importId, req.user.companyId);
    res.json(results);
  } catch (e) {
    res.status(500).json({ message: 'Erro na conciliação', error: e?.message });
  }
});

// GET /financial/ofx/items/:id/candidates - buscar lançamentos candidatos para conciliação manual
router.get('/items/:id/candidates', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const item = await prisma.ofxReconciliationItem.findFirst({
      where: { id: req.params.id },
      include: { import_: { select: { companyId: true } } },
    });
    if (!item || item.import_.companyId !== companyId) {
      return res.status(404).json({ message: 'Item não encontrado' });
    }

    const { search } = req.query;
    const ofxDate = new Date(item.ofxDate);
    const ofxAmount = Math.abs(Number(item.amount));
    const isCredit = Number(item.amount) > 0;

    const daysBefore = new Date(ofxDate);
    daysBefore.setDate(daysBefore.getDate() - 7);
    const daysAfter = new Date(ofxDate);
    daysAfter.setDate(daysAfter.getDate() + 7);

    const where = {
      companyId,
      type: isCredit ? 'RECEIVABLE' : 'PAYABLE',
      status: { in: ['PENDING', 'CONFIRMED', 'PAID'] },
    };

    if (search) {
      where.description = { contains: search, mode: 'insensitive' };
    } else {
      where.dueDate = { gte: daysBefore, lte: daysAfter };
    }

    const candidates = await prisma.financialTransaction.findMany({
      where,
      include: {
        costCenter: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
    });

    // Calcular score para cada candidato
    const scored = candidates.map(c => {
      const candidateAmount = Math.abs(Number(c.netAmount));
      const valueDiff = Math.abs(ofxAmount - candidateAmount);
      const valueScore = valueDiff <= 0.05 ? 1.0 : valueDiff <= 1.0 ? 0.8 : valueDiff <= 5.0 ? 0.5 : 0;

      const dateDiff = Math.abs(ofxDate.getTime() - new Date(c.dueDate).getTime()) / (1000 * 60 * 60 * 24);
      const dateScore = dateDiff <= 0 ? 1.0 : dateDiff <= 1 ? 0.9 : dateDiff <= 3 ? 0.6 : 0.3;

      let descScore = 0;
      if (item.memo && c.description) {
        const memoLower = (item.memo || '').toLowerCase();
        const descLower = (c.description || '').toLowerCase();
        if (memoLower.includes(descLower) || descLower.includes(memoLower)) descScore = 1.0;
        else {
          const memoWords = memoLower.split(/\s+/).filter(w => w.length > 3);
          const descWords = descLower.split(/\s+/).filter(w => w.length > 3);
          const commonWords = memoWords.filter(w => descWords.some(d => d.includes(w) || w.includes(d)));
          descScore = memoWords.length > 0 ? commonWords.length / memoWords.length : 0;
        }
      }

      const score = (valueScore * 0.5) + (dateScore * 0.3) + (descScore * 0.2);
      return {
        id: c.id,
        description: c.description,
        grossAmount: c.grossAmount,
        netAmount: c.netAmount,
        dueDate: c.dueDate,
        status: c.status,
        costCenter: c.costCenter,
        score: Math.round(score * 100),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    res.json(scored);
  } catch (e) {
    console.error('GET /financial/ofx/items/:id/candidates error:', e);
    res.status(500).json({ message: 'Erro ao buscar candidatos', error: e?.message });
  }
});

// POST /financial/ofx/items/:id/create-and-match - criar lançamento e vincular ao item OFX
router.post('/items/:id/create-and-match', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const item = await prisma.ofxReconciliationItem.findFirst({
      where: { id: req.params.id },
      include: { import_: { select: { companyId: true, accountId: true } } },
    });
    if (!item || item.import_.companyId !== companyId) {
      return res.status(404).json({ message: 'Item não encontrado' });
    }

    const {
      type, description, grossAmount, feeAmount = 0,
      issueDate, dueDate, costCenterId, notes,
    } = req.body;

    if (!type || !description || grossAmount == null || !dueDate) {
      return res.status(400).json({ message: 'type, description, grossAmount e dueDate são obrigatórios' });
    }

    const netAmount = Number(grossAmount) - Number(feeAmount);

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.financialTransaction.create({
        data: {
          company: { connect: { id: companyId } },
          type,
          status: 'PAID',
          description,
          accountId: item.import_.accountId,
          costCenterId: costCenterId || null,
          grossAmount: Number(grossAmount),
          feeAmount: Number(feeAmount),
          netAmount,
          issueDate: new Date(issueDate || item.ofxDate),
          dueDate: new Date(dueDate),
          paidAt: new Date(item.ofxDate),
          paidAmount: netAmount,
          sourceType: 'MANUAL',
          createdBy: req.user.id,
          notes: notes || null,
        },
      });

      const updated = await tx.ofxReconciliationItem.update({
        where: { id: item.id },
        data: {
          matchStatus: 'MANUAL',
          transactionId: transaction.id,
          matchConfidence: 1.0,
          matchMethod: 'MANUAL',
          resolvedBy: req.user.id,
          resolvedAt: new Date(),
          matchNotes: 'Lançamento criado e vinculado manualmente',
        },
        include: {
          transaction: { select: { id: true, description: true, grossAmount: true, dueDate: true } },
        },
      });

      return updated;
    });

    res.status(201).json(result);
  } catch (e) {
    console.error('POST /financial/ofx/items/:id/create-and-match error:', e);
    res.status(500).json({ message: 'Erro ao criar e vincular lançamento', error: e?.message });
  }
});

export default router;
