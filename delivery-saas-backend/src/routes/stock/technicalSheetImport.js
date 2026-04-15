/**
 * technicalSheetImport.js — Importador de fichas tecnicas via IA (GPT-4o)
 *
 * Padrao assincrono (igual menuImport):
 *   POST /technical-sheets/ai-import/parse        -> inicia job, retorna { jobId } imediatamente
 *   GET  /technical-sheets/ai-import/parse/:jobId  -> polling de status { done, sheets, error }
 *   POST /technical-sheets/ai-import/apply         -> aplica fichas tecnicas ao estoque
 */

import express from 'express';
import * as XLSX from 'xlsx';
import { jsonrepair } from 'jsonrepair';
import { randomUUID } from 'crypto';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';
import { checkCredits, debitCredits, AI_SERVICE_COSTS, logTokenUsage } from '../../services/aiCreditManager.js';
import { callTextAI, callVisionAI } from '../../services/aiProvider.js';

const router = express.Router();
router.use(authMiddleware);

// Mapa de jobs em memoria: jobId -> { done, sheets, error, ... }
const parseJobs = new Map();

const ALLOWED_UNITS = ['UN', 'GR', 'KG', 'ML', 'L'];

function extractJSON(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('IA nao retornou conteudo. Tente novamente.');
  }
  let cleaned = text.trim();

  // 1) Strip markdown code fences (```json ... ``` or ``` ... ```)
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  // 2) Strip preamble before the first { and trailing text after the last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // 3) Try direct parse
  try { return JSON.parse(cleaned); } catch (_) {}

  // 4) Try removing trailing commas (common AI mistake)
  try {
    const noTrailingCommas = cleaned.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(noTrailingCommas);
  } catch (_) {}

  // 5) Try jsonrepair — handles missing brackets, commas, quotes, etc. (common LLM mistakes)
  try {
    const repaired = jsonrepair(cleaned);
    console.log('[techSheetImport] JSON foi reparado por jsonrepair');
    return JSON.parse(repaired);
  } catch (_) {}

  // 6) Last resort: surface a hint of what the AI actually returned
  const fullLen = text.length;
  const head = String(text).slice(0, 400).replace(/\s+/g, ' ');
  const tail = String(text).slice(-400).replace(/\s+/g, ' ');
  console.error(`[techSheetImport] extractJSON falhou (texto ${fullLen} chars).`);
  console.error('  HEAD:', head);
  console.error('  TAIL:', tail);
  // Show the parse error from the last attempt for diagnosis
  let parseErr = '';
  try { JSON.parse(cleaned); } catch (e) { parseErr = e.message; }
  console.error('  ParseError:', parseErr);
  throw new Error(`IA nao retornou JSON valido (${fullLen} chars). Erro: ${parseErr}`);
}

// --- System prompt ---

function buildSystemPrompt(ingredients) {
  const ingredientList = ingredients.map(i => `- id="${i.id}" descricao="${i.description}" unidade="${i.unit}"`).join('\n');

  return `Voce e um extrator especializado em fichas tecnicas de restaurantes e producao de alimentos.
Analise o conteudo fornecido e extraia TODAS as fichas tecnicas (receitas/preparacoes).

Retorne APENAS um JSON valido (sem texto extra, sem markdown) no formato:
{"sheets":[{"name":"Nome da Ficha/Receita","yield":"Rendimento (ex: 10 porcoes, 2kg)","items":[{"description":"Nome do ingrediente","quantity":1.5,"unit":"KG","matchedIngredientId":"uuid-or-null","confidence":0.95}]}]}

Regras obrigatorias:
- Extraia TODAS as fichas tecnicas/receitas do documento — nao omita nenhuma
- "name" e o nome da receita/preparacao/ficha tecnica
- "yield" e o rendimento da receita (porcoes, peso total, etc). Se nao informado, use null
- Para cada ingrediente da ficha:
  - "description": nome do ingrediente como aparece no documento
  - "quantity": quantidade numerica (decimal, ex: 1.5). Se nao houver quantidade, use 1
  - "unit": normalize para uma destas unidades: UN, GR, KG, ML, L
    - gramas/g -> GR, quilos/kg -> KG, mililitros/ml -> ML, litros/l -> L, unidade/un/peca -> UN
  - "matchedIngredientId": tente associar ao ingrediente mais similar da lista abaixo por similaridade semantica. Use null se nao houver correspondencia com confianca >= 0.7
  - "confidence": nivel de confianca da associacao (0 a 1). Use 0 se matchedIngredientId for null

Lista de ingredientes existentes na empresa:
${ingredientList || '(nenhum ingrediente cadastrado)'}

- Se um ingrediente do documento nao corresponder a nenhum existente, coloque matchedIngredientId como null
- Preserve acentos e caracteres especiais nos nomes
- Se o documento contiver apenas uma receita, retorne um array com um unico elemento em "sheets"`;
}

// --- Processamento assincrono do parse ---

async function runParseJob(jobId, method, files, companyId, userId) {
  const job = parseJobs.get(jobId);
  if (!job) return;

  try {
    // Load company's existing ingredients for matching
    const [ingredients, existingProducts] = await Promise.all([
      prisma.ingredient.findMany({
        where: { companyId },
        select: { id: true, description: true, unit: true },
      }),
      prisma.product.findMany({
        where: { companyId, isActive: true },
        select: { id: true, name: true, technicalSheetId: true, menuId: true, menu: { select: { name: true } }, categoryId: true, category: { select: { name: true } } },
      }),
    ]);

    const systemPrompt = buildSystemPrompt(ingredients);
    const costPerFile = AI_SERVICE_COSTS.TECHNICAL_SHEET_IMPORT_PARSE ?? 5;
    const allSheets = [];

    for (let i = 0; i < files.length; i++) {
      job.currentFile = i + 1;
      job.stage = 'processing';

      const fileContent = files[i];
      let rawContent, tokenUsage;

      if (method === 'photo' || (typeof fileContent === 'string' && fileContent.startsWith('data:image/'))) {
        job.stage = 'ai_analyzing';
        const textPrompt = files.length > 1
          ? `Analise esta imagem de ficha tecnica (pagina ${i + 1} de ${files.length}) e extraia todas as fichas tecnicas/receitas.`
          : 'Analise esta imagem de ficha tecnica e extraia todas as fichas tecnicas/receitas.';
        const imgMatch = fileContent.match(/^data:(image\/\w+);base64,(.+)$/);
        const imgMime = imgMatch?.[1] || 'image/jpeg';
        const imgBase64 = imgMatch?.[2] || fileContent;
        console.log(`[techSheetImport:${jobId}] Arquivo ${i + 1}/${files.length} (photo) — chamando IA...`);
        ({ text: rawContent, tokenUsage } = await callVisionAI('TECHNICAL_SHEET_IMPORT_PARSE', systemPrompt, textPrompt, imgBase64, imgMime, { maxTokens: 16384, timeoutMs: 120_000 }));
        if (tokenUsage) await logTokenUsage(companyId, 'TECHNICAL_SHEET_IMPORT_PARSE', costPerFile, tokenUsage, userId);
      } else if (method === 'spreadsheet') {
        job.stage = 'parsing_file';
        const base64Data = fileContent.includes(',') ? fileContent.split(',')[1] : fileContent;
        const buffer = Buffer.from(base64Data, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });

        const sheetsText = [];
        for (const sheetName of workbook.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
          if (!rows.length) continue;
          const headers = Object.keys(rows[0] || {});
          sheetsText.push(
            `=== Aba: ${sheetName} ===\nColunas: ${headers.join(', ')}\nDados (${rows.length} linhas):\n${JSON.stringify(rows.slice(0, 300), null, 2)}`
          );
        }

        if (!sheetsText.length) throw new Error('Planilha vazia ou invalida');

        job.stage = 'ai_analyzing';
        const sheetUserContent = `Planilha com fichas tecnicas.\n\n${sheetsText.join('\n\n')}\n\nExtraia todas as fichas tecnicas/receitas com seus ingredientes.`;
        console.log(`[techSheetImport:${jobId}] Arquivo ${i + 1}/${files.length} (spreadsheet) — chamando IA...`);
        ({ text: rawContent, tokenUsage } = await callTextAI('TECHNICAL_SHEET_IMPORT_PARSE', systemPrompt, sheetUserContent, { maxTokens: 16384, timeoutMs: 120_000 }));
        if (tokenUsage) await logTokenUsage(companyId, 'TECHNICAL_SHEET_IMPORT_PARSE', costPerFile, tokenUsage, userId);
      } else {
        job.stage = 'ai_analyzing';
        if (typeof fileContent === 'string' && fileContent.startsWith('data:image/')) {
          const imgMatch = fileContent.match(/^data:(image\/\w+);base64,(.+)$/);
          const imgMime = imgMatch?.[1] || 'image/jpeg';
          const imgBase64 = imgMatch?.[2] || fileContent;
          console.log(`[techSheetImport:${jobId}] Arquivo ${i + 1}/${files.length} (image) — chamando IA...`);
          ({ text: rawContent, tokenUsage } = await callVisionAI('TECHNICAL_SHEET_IMPORT_PARSE', systemPrompt, 'Analise esta imagem de ficha tecnica e extraia todas as fichas tecnicas/receitas.', imgBase64, imgMime, { maxTokens: 16384, timeoutMs: 120_000 }));
          if (tokenUsage) await logTokenUsage(companyId, 'TECHNICAL_SHEET_IMPORT_PARSE', costPerFile, tokenUsage, userId);
        } else {
          const docContent = `Documento com fichas tecnicas:\n\n${String(fileContent).slice(0, 24000)}\n\nExtraia todas as fichas tecnicas/receitas com seus ingredientes.`;
          console.log(`[techSheetImport:${jobId}] Arquivo ${i + 1}/${files.length} (document) — chamando IA...`);
          ({ text: rawContent, tokenUsage } = await callTextAI('TECHNICAL_SHEET_IMPORT_PARSE', systemPrompt, docContent, { maxTokens: 16384, timeoutMs: 120_000 }));
          if (tokenUsage) await logTokenUsage(companyId, 'TECHNICAL_SHEET_IMPORT_PARSE', costPerFile, tokenUsage, userId);
        }
      }

      console.log(`[techSheetImport:${jobId}] Resposta IA recebida (${(rawContent || '').length} chars)`);
      const parsed = extractJSON(rawContent);

      if (parsed?.sheets && Array.isArray(parsed.sheets)) {
        allSheets.push(...parsed.sheets);
      } else {
        console.warn(`[techSheetImport:${jobId}] JSON parseado mas sem chave 'sheets' valida:`, JSON.stringify(parsed).slice(0, 300));
      }
    }

    // Normalize results
    const sheets = allSheets.map(sheet => ({
      name: String(sheet.name || '').trim(),
      yield: sheet.yield ? String(sheet.yield).trim() : null,
      items: (sheet.items || []).map(item => ({
        description: String(item.description || '').trim(),
        quantity: parseFloat(item.quantity) || 1,
        unit: ALLOWED_UNITS.includes(String(item.unit || '').toUpperCase())
          ? String(item.unit).toUpperCase()
          : 'UN',
        matchedIngredientId: item.matchedIngredientId || null,
        confidence: parseFloat(item.confidence) || 0,
      })).filter(item => item.description),
    })).filter(sheet => sheet.name && sheet.items.length > 0);

    // Try to match each sheet to an existing product by name similarity
    for (const sheet of sheets) {
      const sheetNameLower = sheet.name.toLowerCase().trim();
      let bestMatch = null;
      let bestScore = 0;

      for (const product of existingProducts) {
        const productNameLower = product.name.toLowerCase().trim();
        // Exact match
        if (sheetNameLower === productNameLower) {
          bestMatch = product;
          bestScore = 1;
          break;
        }
        // Contains match (one contains the other)
        if (sheetNameLower.includes(productNameLower) || productNameLower.includes(sheetNameLower)) {
          const score = Math.min(sheetNameLower.length, productNameLower.length) / Math.max(sheetNameLower.length, productNameLower.length);
          if (score > bestScore) {
            bestMatch = product;
            bestScore = score;
          }
        }
      }

      sheet.matchedProductId = bestScore >= 0.5 ? bestMatch?.id || null : null;
      sheet.matchedProductName = bestScore >= 0.5 ? bestMatch?.name || null : null;
      sheet.productConfidence = Math.round(bestScore * 100);
    }

    job.done = true;
    job.sheets = sheets;
    job.sheetCount = sheets.length;
    job.existingProducts = existingProducts;
    job.stage = 'done';
    job.creditEstimate = {
      sheetCount: sheets.length,
      serviceKey: 'TECHNICAL_SHEET_IMPORT_ITEM',
      costPerUnit: AI_SERVICE_COSTS.TECHNICAL_SHEET_IMPORT_ITEM ?? 1,
      totalCost: sheets.length * (AI_SERVICE_COSTS.TECHNICAL_SHEET_IMPORT_ITEM ?? 1),
    };

  } catch (e) {
    console.error(`[techSheetImport:${jobId}] Erro:`, e.message);
    job.done = true;
    job.error = e.message || 'Erro ao processar com IA';
    job.stage = 'error';
  }

  // Limpar job da memoria apos 15 minutos
  setTimeout(() => parseJobs.delete(jobId), 15 * 60 * 1000);
}

// --- POST /ai-import/parse --- inicia job, retorna imediatamente

router.post('/ai-import/parse', requireRole('ADMIN'), async (req, res) => {
  const { method, files } = req.body;
  const companyId = req.user?.companyId;

  if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });
  if (!method) return res.status(400).json({ message: 'method e obrigatorio' });
  if (!['photo', 'spreadsheet', 'pdf', 'docx'].includes(method)) {
    return res.status(400).json({ message: 'method invalido. Use: photo, spreadsheet, pdf ou docx' });
  }
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ message: 'files e obrigatorio (array de base64)' });
  }

  // Verificar creditos antes de iniciar
  const check = await checkCredits(companyId, 'TECHNICAL_SHEET_IMPORT_PARSE', files.length);
  if (!check.ok) {
    const now = new Date();
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return res.status(402).json({
      message: 'Creditos de IA insuficientes para processar fichas tecnicas.',
      balance: check.balance,
      monthlyLimit: check.monthlyLimit,
      required: check.totalCost,
      nextReset,
    });
  }

  // Debitar creditos imediatamente
  await debitCredits(
    companyId,
    'TECHNICAL_SHEET_IMPORT_PARSE',
    files.length,
    { fileCount: files.length, method, source: 'technical_sheet_import_parse' },
    req.user?.id,
  );

  const jobId = randomUUID();
  parseJobs.set(jobId, {
    done: false,
    sheets: null,
    error: null,
    sheetCount: 0,
    stage: 'pending',
    currentFile: 0,
    totalFiles: files.length,
    method,
  });

  // Responde imediatamente — processa em segundo plano
  res.json({ jobId });

  runParseJob(jobId, method, files, companyId, req.user?.id).catch(e => {
    const job = parseJobs.get(jobId);
    if (job) { job.done = true; job.error = e.message; job.stage = 'error'; }
  });
});

// --- GET /ai-import/parse/:jobId --- polling de status

router.get('/ai-import/parse/:jobId', (req, res) => {
  const job = parseJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job nao encontrado ou expirado' });
  res.json(job);
});

// --- POST /ai-import/apply --- aplica fichas tecnicas ao estoque

router.post('/ai-import/apply', requireRole('ADMIN'), async (req, res) => {
  try {
    const { sheets } = req.body;
    const companyId = req.user?.companyId;

    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });
    if (!Array.isArray(sheets) || !sheets.length) {
      return res.status(400).json({ message: 'Nenhuma ficha tecnica para importar' });
    }

    // Verificar e debitar creditos
    const check = await checkCredits(companyId, 'TECHNICAL_SHEET_IMPORT_ITEM', sheets.length);
    if (!check.ok) {
      const now = new Date();
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return res.status(402).json({
        message: `Creditos de IA insuficientes. Esta importacao requer ${check.totalCost} credito(s), mas voce possui apenas ${check.balance}.`,
        required: check.totalCost,
        balance: check.balance,
        nextReset,
      });
    }

    await debitCredits(
      companyId,
      'TECHNICAL_SHEET_IMPORT_ITEM',
      sheets.length,
      { sheetCount: sheets.length, source: 'technical_sheet_import_apply' },
      req.user?.id,
    );

    // Pre-load company ingredients for validation and deduplication
    const companyIngredients = await prisma.ingredient.findMany({
      where: { companyId },
      select: { id: true, description: true, unit: true },
    });
    const validIngredientIds = new Set(companyIngredients.map(i => i.id));
    // Map normalized description+unit -> id for dedup across sheets in same batch
    const ingredientByDesc = new Map(
      companyIngredients.map(i => [`${i.description.trim().toUpperCase()}||${i.unit || 'UN'}`, i.id])
    );

    // Pre-load valid product IDs for this company
    const companyProducts = await prisma.product.findMany({
      where: { companyId },
      select: { id: true },
    });
    const validProductIds = new Set(companyProducts.map(p => p.id));

    let createdSheets = 0;
    let createdIngredients = 0;
    let createdItems = 0;
    let linkedProducts = 0;
    let createdProducts = 0;

    for (const sheet of sheets) {
      const sheetName = String(sheet.name || '').trim();
      if (!sheetName) continue;

      const items = Array.isArray(sheet.items) ? sheet.items : [];
      if (!items.length) continue;

      // Create new ingredients first (where newIngredient=true)
      const resolvedItems = [];
      for (const item of items) {
        let ingredientId = item.ingredientId || null;

        if (item.newIngredient) {
          // Create a new ingredient — but reuse if same desc+unit already exists or was created earlier in batch
          const desc = String(item.description || '').trim();
          if (!desc) continue;
          const unit = ALLOWED_UNITS.includes(String(item.unit || '').toUpperCase())
            ? String(item.unit).toUpperCase()
            : 'UN';

          const dedupKey = `${desc.toUpperCase()}||${unit}`;
          const existingId = ingredientByDesc.get(dedupKey);
          if (existingId) {
            ingredientId = existingId;
          } else {
            const newIngredient = await prisma.ingredient.create({
              data: {
                companyId,
                description: desc,
                unit,
                controlsStock: true,
                composesCmv: false,
              },
            });
            ingredientId = newIngredient.id;
            validIngredientIds.add(ingredientId);
            ingredientByDesc.set(dedupKey, ingredientId);
            createdIngredients++;
          }
        }

        // Validate ingredient belongs to company
        if (!ingredientId || !validIngredientIds.has(ingredientId)) continue;

        const quantity = parseFloat(item.quantity) || 1;
        const itemUnit = ALLOWED_UNITS.includes(String(item.unit || '').toUpperCase()) ? String(item.unit).toUpperCase() : null;
        resolvedItems.push({ ingredientId, quantity, unit: itemUnit });
      }

      if (!resolvedItems.length) continue;

      // Create TechnicalSheet with items
      const newSheet = await prisma.technicalSheet.create({
        data: {
          companyId,
          name: sheetName,
          yield: sheet.yield ? String(sheet.yield).trim() : null,
          items: {
            create: resolvedItems.map(ri => ({
              ingredientId: ri.ingredientId,
              quantity: ri.quantity,
              unit: ri.unit,
            })),
          },
        },
      });

      // Handle product linking (supports multiple products per sheet)
      const productAction = sheet.productAction; // 'link', 'create', or 'none'
      if (productAction === 'link') {
        // Support both single productId (legacy) and productIds array
        const ids = Array.isArray(sheet.productIds) && sheet.productIds.length
          ? sheet.productIds.filter(id => validProductIds.has(id))
          : (sheet.productId && validProductIds.has(sheet.productId) ? [sheet.productId] : []);
        for (const pid of ids) {
          await prisma.product.update({
            where: { id: pid },
            data: { technicalSheetId: newSheet.id },
          });
          linkedProducts++;
        }
      } else if (productAction === 'create') {
        const productData = {
          companyId,
          name: sheetName,
          technicalSheetId: newSheet.id,
          price: 0,
          isActive: true,
        };
        if (sheet.menuId) productData.menuId = sheet.menuId;
        if (sheet.categoryId) productData.categoryId = sheet.categoryId;
        const newProduct = await prisma.product.create({ data: productData });
        validProductIds.add(newProduct.id);
        createdProducts++;
      }

      createdSheets++;
      createdItems += resolvedItems.length;
    }

    return res.json({
      success: true,
      created: {
        sheets: createdSheets,
        ingredients: createdIngredients,
        items: createdItems,
        linkedProducts,
        createdProducts,
      },
    });

  } catch (e) {
    console.error('[techSheetImport/apply]', e);
    return res.status(500).json({ message: e.message || 'Erro ao importar fichas tecnicas' });
  }
});

export default router;
