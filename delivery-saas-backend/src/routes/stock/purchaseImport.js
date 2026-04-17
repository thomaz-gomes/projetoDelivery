/**
 * purchaseImport.js — Purchase Import routes (parse NFe, match AI, apply stock)
 *
 * Async job pattern (same as ingredientImport):
 *   POST /purchase-imports/parse         -> starts job, returns { jobId }
 *   GET  /purchase-imports/parse/:jobId  -> poll status { status, importId, error }
 *   GET  /purchase-imports               -> list imports
 *   GET  /purchase-imports/:id           -> detail
 *   DELETE /purchase-imports/:id         -> remove PENDING/ERROR only
 *   POST /purchase-imports/:id/match     -> AI matching
 *   POST /purchase-imports/:id/apply     -> confirm & create stock entry
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';
import { parseNfeXml, matchItemsWithAI, parseReceiptPhoto } from '../../services/purchaseImportService.js';
import { getMdeStatus, activateMde, fetchFullNFe } from '../../services/mdeService.js';
import { enqueueSync, enqueueFetchXml, getQueueStatus } from '../../services/mdeQueue.js';
import { createFinancialEntriesForPurchase } from '../../services/financial/purchaseFinancialBridge.js';

const router = express.Router();
router.use(authMiddleware);

const parseJobs = new Map();

// --- GET /purchase-imports ---
router.get('/', async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const { storeId, status, from, to, page = '1', limit = '20' } = req.query;
    const take = Math.min(parseInt(limit) || 20, 100);
    const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take;

    const where = {
      companyId,
      // Exclude MDe activation marker records
      NOT: { parsedItems: { path: ['_mdeActivation'], equals: true } },
    };
    if (storeId) where.storeId = storeId;
    if (status) where.status = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [rows, total] = await Promise.all([
      prisma.purchaseImport.findMany({
        where,
        include: {
          store: true,
          supplier: { select: { id: true, name: true, cnpj: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.purchaseImport.count({ where }),
    ]);

    // Enrich with reconciliation status
    const items = await Promise.all(rows.map(async (row) => {
      const stockReconciled = row.status === 'APPLIED';

      let financialStatus = 'NONE';
      if (row.status === 'APPLIED') {
        const txns = await prisma.financialTransaction.findMany({
          where: { companyId, sourceType: 'STOCK_PURCHASE', sourceId: row.id },
          select: { status: true },
        });
        if (txns.length > 0) {
          const allPaid = txns.every(t => t.status === 'PAID');
          const somePaid = txns.some(t => t.status === 'PAID');
          if (allPaid) financialStatus = 'FULL';
          else if (somePaid) financialStatus = 'PARTIAL';
          else financialStatus = 'PENDING';
        }
      }

      return { ...row, stockReconciled, financialStatus };
    }));

    res.json({ items, total, page: Math.max(parseInt(page) || 1, 1), limit: take });
  } catch (e) {
    console.error('[purchaseImport] GET / error:', e?.message || e);
    res.status(500).json({ message: e?.message || 'Erro ao listar importacoes' });
  }
});

// --- GET /purchase-imports/parse/:jobId (must come before /:id) ---
router.get('/parse/:jobId', (req, res) => {
  const job = parseJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job nao encontrado ou expirado' });
  res.json({
    status: job.error ? 'error' : job.done ? 'done' : 'processing',
    importId: job.importId || null,
    error: job.error || null,
  });
});

// --- POST /purchase-imports/mde/activate ---
router.post('/mde/activate', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const { storeId } = req.body;
    if (!storeId) return res.status(400).json({ message: 'storeId e obrigatorio' });

    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, companyId: true } });
    if (!store || store.companyId !== companyId) {
      return res.status(400).json({ message: 'Loja invalida ou nao pertence a empresa' });
    }

    const result = await activateMde(storeId, companyId);
    res.json(result);
  } catch (e) {
    console.error('[purchaseImport] POST /mde/activate error:', e?.message || e);
    res.status(500).json({ message: e?.message || 'Erro ao ativar MDe' });
  }
});

// --- POST /purchase-imports/mde/sync ---
router.post('/mde/sync', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const { storeId } = req.body;
    if (!storeId) return res.status(400).json({ message: 'storeId e obrigatorio' });

    // Validate store belongs to company
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, companyId: true } });
    if (!store || store.companyId !== companyId) {
      return res.status(400).json({ message: 'Loja invalida ou nao pertence a empresa' });
    }

    const result = enqueueSync(storeId, companyId);
    if (!result.queued) {
      return res.status(429).json({ message: `Loja em backoff — aguarde ${result.waitMinutes} minuto(s)`, ...result });
    }
    res.json(result);
  } catch (e) {
    console.error('[purchaseImport] POST /mde/sync error:', e?.message || e);
    res.status(500).json({ message: e?.message || 'Erro ao sincronizar MDe' });
  }
});

// --- GET /purchase-imports/mde/status ---
router.get('/mde/status', async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ message: 'storeId e obrigatorio' });

    // Validate store belongs to company
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, companyId: true } });
    if (!store || store.companyId !== companyId) {
      return res.status(400).json({ message: 'Loja invalida ou nao pertence a empresa' });
    }

    const dbStatus = await getMdeStatus(storeId, companyId);
    const queueStatus = getQueueStatus(storeId);
    res.json({ ...dbStatus, ...queueStatus });
  } catch (e) {
    console.error('[purchaseImport] GET /mde/status error:', e?.message || e);
    res.status(500).json({ message: e?.message || 'Erro ao consultar status MDe' });
  }
});

// --- POST /purchase-imports/:id/fetch-xml --- (fetch full procNFe for resNFe summaries)
router.post('/:id/fetch-xml', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const importRecord = await prisma.purchaseImport.findUnique({ where: { id: req.params.id }, select: { id: true, companyId: true, storeId: true } });
    if (!importRecord) return res.status(404).json({ message: 'Importacao nao encontrada' });
    if (importRecord.companyId !== companyId) return res.status(403).json({ message: 'Acesso negado' });

    const result = enqueueFetchXml(req.params.id, companyId, importRecord.storeId);
    res.json(result);
  } catch (e) {
    console.error('[purchaseImport] POST /:id/fetch-xml error:', e?.message || e);
    res.status(500).json({ message: e?.message || 'Erro ao buscar XML completo' });
  }
});

// --- GET /purchase-imports/:id ---
router.get('/:id', async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const item = await prisma.purchaseImport.findUnique({
      where: { id: req.params.id },
      include: { store: true, stockMovement: { include: { items: { include: { ingredient: true } } } } },
    });
    if (!item) return res.status(404).json({ message: 'Importacao nao encontrada' });
    if (item.companyId !== companyId) return res.status(403).json({ message: 'Acesso negado' });

    res.json(item);
  } catch (e) {
    console.error('[purchaseImport] GET /:id error:', e?.message || e);
    res.status(500).json({ message: e?.message || 'Erro ao buscar importacao' });
  }
});

// --- DELETE /purchase-imports/:id ---
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const item = await prisma.purchaseImport.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ message: 'Importacao nao encontrada' });
    if (item.companyId !== companyId) return res.status(403).json({ message: 'Acesso negado' });
    if (!['PENDING', 'ERROR', 'MATCHED'].includes(item.status)) {
      return res.status(400).json({ message: 'Somente importacoes com status PENDING, MATCHED ou ERROR podem ser removidas' });
    }

    await prisma.purchaseImport.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error('[purchaseImport] DELETE /:id error:', e?.message || e);
    res.status(500).json({ message: e?.message || 'Erro ao remover importacao' });
  }
});

// --- POST /purchase-imports/parse ---
router.post('/parse', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const { method, storeId, input } = req.body;
    if (!method) return res.status(400).json({ message: 'method e obrigatorio' });
    if (!storeId) return res.status(400).json({ message: 'storeId e obrigatorio' });
    if (!input) return res.status(400).json({ message: 'input e obrigatorio' });
    if (!['xml', 'access_key', 'receipt_photo'].includes(method)) {
      return res.status(400).json({ message: 'method invalido. Use: xml, access_key ou receipt_photo' });
    }

    // Validate store belongs to company
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, companyId: true } });
    if (!store || store.companyId !== companyId) {
      return res.status(400).json({ message: 'Loja invalida ou nao pertence a empresa' });
    }

    const jobId = randomUUID();
    parseJobs.set(jobId, {
      done: false,
      importId: null,
      error: null,
    });

    res.json({ jobId });

    // Run async
    runParseJob(jobId, method, storeId, companyId, input, req.user?.id).catch(e => {
      const job = parseJobs.get(jobId);
      if (job) { job.done = true; job.error = e?.message || 'Erro ao processar'; }
    });
  } catch (e) {
    console.error('[purchaseImport] POST /parse error:', e?.message || e);
    res.status(500).json({ message: e?.message || 'Erro ao iniciar parse' });
  }
});

async function runParseJob(jobId, method, storeId, companyId, input, userId) {
  const job = parseJobs.get(jobId);
  if (!job) return;

  try {
    let importData = {
      companyId,
      storeId,
      status: 'PENDING',
    };

    if (method === 'xml') {
      const parsed = await parseNfeXml(input);
      importData.source = 'XML';
      importData.accessKey = parsed.accessKey || null;
      importData.nfeNumber = parsed.nfeNumber || null;
      importData.nfeSeries = parsed.nfeSeries || null;
      importData.issueDate = parsed.issueDate || null;
      importData.supplierCnpj = parsed.supplierCnpj || null;
      importData.supplierName = parsed.supplierName || null;
      importData.totalValue = parsed.totalValue || null;
      importData.rawXml = input;
      importData.parsedItems = parsed.items;
    } else if (method === 'access_key') {
      const key = String(input).replace(/\s/g, '');
      if (key.length !== 44 || !/^\d{44}$/.test(key)) {
        throw new Error('Chave de acesso invalida. Deve conter 44 digitos numericos.');
      }
      importData.source = 'ACCESS_KEY';
      importData.accessKey = key;
      // Seed resNFe marker so fetchFullNFe's type guard accepts this record.
      importData.parsedItems = { _type: 'resNFe', _pending: true };
    } else if (method === 'receipt_photo') {
      // Load existing ingredients for matching
      const existingIngredients = await prisma.ingredient.findMany({
        where: { companyId },
        include: { group: true },
      });

      const items = await parseReceiptPhoto(companyId, input, existingIngredients, userId);
      importData.source = 'RECEIPT_PHOTO';
      importData.parsedItems = items;
      importData.status = 'MATCHED';
    }

    // If accessKey exists, delete old record first to avoid unique constraint
    let record;
    if (importData.accessKey) {
      const existing = await prisma.purchaseImport.findUnique({ where: { accessKey: importData.accessKey } });
      if (existing && existing.status !== 'APPLIED') {
        await prisma.purchaseImport.delete({ where: { id: existing.id } });
      } else if (existing && existing.status === 'APPLIED') {
        // Already applied — reuse instead of re-importing
        job.done = true;
        job.importId = existing.id;
        console.log(`[purchaseImport:${jobId}] Reusing already-applied import ${existing.id}`);
        return;
      }
    }
    record = await prisma.purchaseImport.create({ data: importData });

    // For access_key the parse only stored the key; fetch the full procNFe from
    // SEFAZ now so /match finds items. On failure, remove the zombie record.
    if (method === 'access_key') {
      try {
        const fetchResult = await fetchFullNFe(record.id, companyId);
        console.log(`[purchaseImport:${jobId}] Fetched ${fetchResult.itemCount} items from SEFAZ for ${record.id}`);
      } catch (fetchErr) {
        await prisma.purchaseImport.delete({ where: { id: record.id } }).catch(() => {});
        throw new Error(`Falha ao buscar NFe na SEFAZ: ${fetchErr?.message || 'erro desconhecido'}`);
      }
    }

    job.done = true;
    job.importId = record.id;
    console.log(`[purchaseImport:${jobId}] Created/updated import ${record.id} (${method})`);
  } catch (e) {
    console.error(`[purchaseImport:${jobId}] Error:`, e?.message || e);
    job.done = true;
    job.error = e?.message || 'Erro ao processar';
  }

  // Clean up job after 15 minutes
  setTimeout(() => parseJobs.delete(jobId), 15 * 60 * 1000);
}

// --- POST /purchase-imports/:id/match ---
router.post('/:id/match', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const importRecord = await prisma.purchaseImport.findUnique({ where: { id: req.params.id } });
    if (!importRecord) return res.status(404).json({ message: 'Importacao nao encontrada' });
    if (importRecord.companyId !== companyId) return res.status(403).json({ message: 'Acesso negado' });
    if (importRecord.status !== 'PENDING') {
      return res.status(400).json({ message: 'Somente importacoes com status PENDING podem ser matched' });
    }

    // parsedItems can be a flat array (XML upload) or an object with .items (MDE procNFe)
    let nfeItems = importRecord.parsedItems;
    if (nfeItems && !Array.isArray(nfeItems) && Array.isArray(nfeItems.items)) {
      nfeItems = nfeItems.items;
    }
    if (!Array.isArray(nfeItems) || nfeItems.length === 0) {
      return res.status(400).json({ message: 'Importacao sem itens para match' });
    }

    const existingIngredients = await prisma.ingredient.findMany({
      where: { companyId },
      include: { group: true },
    });

    const matchedItems = await matchItemsWithAI(companyId, nfeItems, existingIngredients, req.user?.id);

    await prisma.purchaseImport.update({
      where: { id: req.params.id },
      data: { parsedItems: matchedItems, status: 'MATCHED' },
    });

    res.json({ ok: true, items: matchedItems });
  } catch (e) {
    console.error('[purchaseImport] POST /:id/match error:', e?.message || e);
    const statusCode = e?.statusCode || 500;
    res.status(statusCode).json({ message: e?.message || 'Erro ao fazer matching' });
  }
});

// --- POST /purchase-imports/:id/apply ---
router.post('/:id/apply', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });

    const importRecord = await prisma.purchaseImport.findUnique({ where: { id: req.params.id } });
    if (!importRecord) return res.status(404).json({ message: 'Importacao nao encontrada' });
    if (importRecord.companyId !== companyId) return res.status(403).json({ message: 'Acesso negado' });
    if (importRecord.status !== 'MATCHED') {
      return res.status(400).json({ message: 'Importacao precisa estar com status MATCHED para ser aplicada' });
    }

    const { items, paymentParams } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items e obrigatorio (array de itens)' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const movementItems = [];

      // 1. Create new ingredients for items with createNew: true
      for (const item of items) {
        if (item.createNew && !item.matchedIngredientId) {
          const newIngredient = await tx.ingredient.create({
            data: {
              companyId,
              description: item.suggestedName || item.xProd || 'Novo ingrediente',
              unit: item.suggestedUnit || 'UN',
              controlsStock: true,
              composesCmv: true,
              currentStock: 0,
              avgCost: null,
            },
          });
          item.matchedIngredientId = newIngredient.id;
        }
      }

      // 2. Create StockMovement
      const movement = await tx.stockMovement.create({
        data: {
          companyId,
          storeId: importRecord.storeId,
          type: 'IN',
          reason: 'PURCHASE_IMPORT',
          note: importRecord.supplierName
            ? `Importacao NFe - ${importRecord.supplierName}`
            : 'Importacao de compra',
        },
      });

      // 3. Create StockMovementItems and update ingredient stock + avg cost
      for (const item of items) {
        if (!item.matchedIngredientId) continue; // skip unmatched items

        const qty = Number(item.qCom) || 0;
        const unitCost = item.vUnCom !== undefined && item.vUnCom !== null ? Number(item.vUnCom) : null;

        if (qty <= 0) continue;

        await tx.stockMovementItem.create({
          data: {
            stockMovementId: movement.id,
            ingredientId: item.matchedIngredientId,
            quantity: qty,
            unitCost,
          },
        });

        // Update ingredient stock and weighted average cost (same pattern as stockMovements.js)
        const ingredient = await tx.ingredient.findUnique({ where: { id: item.matchedIngredientId } });
        if (!ingredient) continue;

        let newStock = Number(ingredient.currentStock || 0);
        let newAvg = ingredient.avgCost !== null && ingredient.avgCost !== undefined
          ? Number(ingredient.avgCost) : null;

        if (unitCost !== null && unitCost !== undefined) {
          const existingQty = Number(ingredient.currentStock || 0);
          const existingAvg = ingredient.avgCost !== null && ingredient.avgCost !== undefined
            ? Number(ingredient.avgCost) : 0;
          const totalVal = existingAvg * existingQty + unitCost * qty;
          const totalQty = existingQty + qty;
          newAvg = totalQty > 0 ? (totalVal / totalQty) : unitCost;
        }
        newStock = newStock + qty;

        await tx.ingredient.update({
          where: { id: item.matchedIngredientId },
          data: { currentStock: newStock, avgCost: newAvg },
        });

        movementItems.push({
          ingredientId: item.matchedIngredientId,
          quantity: qty,
          unitCost,
        });
      }

      // 4. Update PurchaseImport
      await tx.purchaseImport.update({
        where: { id: importRecord.id },
        data: {
          status: 'APPLIED',
          stockMovementId: movement.id,
          parsedItems: items,
        },
      });

      return await tx.stockMovement.findUnique({
        where: { id: movement.id },
        include: { items: { include: { ingredient: true } }, store: true },
      });
    });

    // Create financial transactions (accounts payable)
    let financialResult = null
    if (paymentParams) {
      try {
        financialResult = await createFinancialEntriesForPurchase(req.params.id, paymentParams)
      } catch (e) {
        console.warn('[purchaseImport] Failed to create financial entries:', e?.message || e)
      }
    }

    res.json({ ok: true, stockMovement: result, financialResult });
  } catch (e) {
    console.error('[purchaseImport] POST /:id/apply error:', e?.message || e);
    res.status(500).json({ message: e?.message || 'Erro ao aplicar importacao' });
  }
});

export default router;
