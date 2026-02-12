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

    // Atualizar importação com resultado
    await prisma.ofxImport.update({
      where: { id: ofxImport.id },
      data: {
        status: 'COMPLETED',
        matchedItems: matchResult.matched,
        unmatchedItems: matchResult.unmatched,
      },
    });

    res.status(201).json({
      import: ofxImport,
      totalItems: items.length,
      matched: matchResult.matched,
      unmatched: matchResult.unmatched,
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

export default router;
