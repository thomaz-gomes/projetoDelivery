/**
 * ingredientImport.js — Importador de ingredientes via IA (GPT-4o)
 *
 * Padrao assincrono (igual technicalSheetImport):
 *   POST /ingredients/ai-import/parse        -> inicia job, retorna { jobId } imediatamente
 *   GET  /ingredients/ai-import/parse/:jobId  -> polling de status { done, ingredients, error }
 *   POST /ingredients/ai-import/apply         -> aplica ingredientes ao estoque
 */

import express from 'express';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';
import { checkCredits, debitCredits, AI_SERVICE_COSTS, logTokenUsage } from '../../services/aiCreditManager.js';
import { callTextAI, callVisionAI } from '../../services/aiProvider.js';

const router = express.Router();
router.use(authMiddleware);

const parseJobs = new Map();

const ALLOWED_UNITS = ['UN', 'GR', 'KG', 'ML', 'L'];

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  throw new Error('IA nao retornou JSON valido. Tente novamente.');
}

// --- System prompt ---

function buildSystemPrompt(existingIngredients, ingredientGroups) {
  const existingList = existingIngredients.map(i => `- "${i.description}" (${i.unit})`).join('\n');
  const groupList = ingredientGroups.map(g => `- id="${g.id}" nome="${g.name}"`).join('\n');

  return `Voce e um extrator especializado em listas de ingredientes/insumos de restaurantes e producao de alimentos.
Analise o conteudo fornecido e extraia TODOS os ingredientes/insumos listados.

Retorne APENAS um JSON valido (sem texto extra, sem markdown) no formato:
{"ingredients":[{"description":"Nome do ingrediente","unit":"KG","avgCost":null,"groupId":null,"groupName":null,"controlsStock":true,"composesCmv":true,"minStock":null,"isDuplicate":false}]}

Regras obrigatorias:
- Extraia TODOS os ingredientes/insumos do documento — nao omita nenhum
- "description": nome do ingrediente como aparece no documento. Preserve acentos e caracteres especiais
- "unit": normalize para uma destas unidades: UN, GR, KG, ML, L
  - gramas/g -> GR, quilos/kg -> KG, mililitros/ml -> ML, litros/l -> L, unidade/un/peca -> UN
  - Se nao houver indicacao de unidade, use UN
- "avgCost": custo medio unitario (decimal). Se informado no documento, extraia. Se nao, use null
- "groupId": tente associar ao grupo mais similar da lista abaixo. Use null se nenhum corresponder
- "groupName": se nao houver grupo correspondente mas o documento indicar uma categoria, coloque o nome sugerido. Se houver match com grupo existente, coloque o nome do grupo existente
- "controlsStock": true se o ingrediente deve controlar estoque (padrao: true)
- "composesCmv": true se o ingrediente compoe o CMV (padrao: true)
- "minStock": estoque minimo se informado no documento, senao null
- "isDuplicate": true se o ingrediente ja existe na lista de ingredientes cadastrados (por similaridade semantica). Marque como true para evitar duplicatas

Grupos de ingredientes existentes na empresa:
${groupList || '(nenhum grupo cadastrado)'}

Ingredientes ja cadastrados na empresa (para detectar duplicatas):
${existingList || '(nenhum ingrediente cadastrado)'}

- Nao inclua ingredientes que ja existam na lista acima (marque isDuplicate=true)
- Se o documento tiver colunas como "preco", "custo", "valor", extraia como avgCost
- Se houver categorias/grupos no documento, tente associar aos grupos existentes`;
}

// --- Processamento assincrono do parse ---

async function runParseJob(jobId, method, files, companyId, userId) {
  const job = parseJobs.get(jobId);
  if (!job) return;

  try {
    const [existingIngredients, ingredientGroups] = await Promise.all([
      prisma.ingredient.findMany({
        where: { companyId },
        select: { id: true, description: true, unit: true },
      }),
      prisma.ingredientGroup.findMany({
        where: { companyId },
        select: { id: true, name: true },
      }),
    ]);

    const systemPrompt = buildSystemPrompt(existingIngredients, ingredientGroups);
    const costPerFile = AI_SERVICE_COSTS.INGREDIENT_IMPORT_PARSE ?? 5;
    const allIngredients = [];

    for (let i = 0; i < files.length; i++) {
      job.currentFile = i + 1;
      job.stage = 'processing';

      const fileContent = files[i];
      let rawContent, tokenUsage;

      if (method === 'photo' || (typeof fileContent === 'string' && fileContent.startsWith('data:image/'))) {
        job.stage = 'ai_analyzing';
        const textPrompt = files.length > 1
          ? `Analise esta imagem (pagina ${i + 1} de ${files.length}) e extraia todos os ingredientes/insumos.`
          : 'Analise esta imagem e extraia todos os ingredientes/insumos.';
        const imgMatch = fileContent.match(/^data:(image\/\w+);base64,(.+)$/);
        const imgMime = imgMatch?.[1] || 'image/jpeg';
        const imgBase64 = imgMatch?.[2] || fileContent;
        console.log(`[ingredientImport:${jobId}] Arquivo ${i + 1}/${files.length} (photo) — chamando IA...`);
        ({ text: rawContent, tokenUsage } = await callVisionAI('INGREDIENT_IMPORT_PARSE', systemPrompt, textPrompt, imgBase64, imgMime, { maxTokens: 16384, timeoutMs: 120_000 }));
        if (tokenUsage) await logTokenUsage(companyId, 'INGREDIENT_IMPORT_PARSE', costPerFile, tokenUsage, userId);
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
            `=== Aba: ${sheetName} ===\nColunas: ${headers.join(', ')}\nDados (${rows.length} linhas):\n${JSON.stringify(rows.slice(0, 500), null, 2)}`
          );
        }

        if (!sheetsText.length) throw new Error('Planilha vazia ou invalida');

        job.stage = 'ai_analyzing';
        const sheetUserContent = `Planilha com ingredientes/insumos.\n\n${sheetsText.join('\n\n')}\n\nExtraia todos os ingredientes/insumos listados.`;
        console.log(`[ingredientImport:${jobId}] Arquivo ${i + 1}/${files.length} (spreadsheet) — chamando IA...`);
        ({ text: rawContent, tokenUsage } = await callTextAI('INGREDIENT_IMPORT_PARSE', systemPrompt, sheetUserContent, { maxTokens: 16384, timeoutMs: 120_000 }));
        if (tokenUsage) await logTokenUsage(companyId, 'INGREDIENT_IMPORT_PARSE', costPerFile, tokenUsage, userId);
      } else {
        job.stage = 'ai_analyzing';
        const docContent = `Documento com ingredientes/insumos:\n\n${String(fileContent).slice(0, 24000)}\n\nExtraia todos os ingredientes/insumos listados.`;
        console.log(`[ingredientImport:${jobId}] Arquivo ${i + 1}/${files.length} (document) — chamando IA...`);
        ({ text: rawContent, tokenUsage } = await callTextAI('INGREDIENT_IMPORT_PARSE', systemPrompt, docContent, { maxTokens: 16384, timeoutMs: 120_000 }));
        if (tokenUsage) await logTokenUsage(companyId, 'INGREDIENT_IMPORT_PARSE', costPerFile, tokenUsage, userId);
      }

      const parsed = extractJSON(rawContent);

      if (parsed?.ingredients && Array.isArray(parsed.ingredients)) {
        allIngredients.push(...parsed.ingredients);
      }
    }

    // Normalize results
    const ingredients = allIngredients.map(ing => ({
      description: String(ing.description || '').trim(),
      unit: ALLOWED_UNITS.includes(String(ing.unit || '').toUpperCase())
        ? String(ing.unit).toUpperCase()
        : 'UN',
      avgCost: ing.avgCost !== null && ing.avgCost !== undefined ? parseFloat(ing.avgCost) || null : null,
      groupId: ing.groupId || null,
      groupName: ing.groupName ? String(ing.groupName).trim() : null,
      controlsStock: ing.controlsStock !== false,
      composesCmv: ing.composesCmv !== false,
      minStock: ing.minStock !== null && ing.minStock !== undefined ? parseFloat(ing.minStock) || null : null,
      isDuplicate: !!ing.isDuplicate,
    })).filter(ing => ing.description && !ing.isDuplicate);

    job.done = true;
    job.ingredients = ingredients;
    job.ingredientCount = ingredients.length;
    job.existingGroups = ingredientGroups;
    job.stage = 'done';
    job.creditEstimate = {
      itemCount: ingredients.length,
      serviceKey: 'INGREDIENT_IMPORT_ITEM',
      costPerUnit: AI_SERVICE_COSTS.INGREDIENT_IMPORT_ITEM ?? 1,
      totalCost: ingredients.length * (AI_SERVICE_COSTS.INGREDIENT_IMPORT_ITEM ?? 1),
    };

  } catch (e) {
    console.error(`[ingredientImport:${jobId}] Erro:`, e.message);
    job.done = true;
    job.error = e.message || 'Erro ao processar com IA';
    job.stage = 'error';
  }

  setTimeout(() => parseJobs.delete(jobId), 15 * 60 * 1000);
}

// --- POST /ai-import/parse ---

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

  const check = await checkCredits(companyId, 'INGREDIENT_IMPORT_PARSE', files.length);
  if (!check.ok) {
    const now = new Date();
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return res.status(402).json({
      message: 'Creditos de IA insuficientes para processar ingredientes.',
      balance: check.balance,
      monthlyLimit: check.monthlyLimit,
      required: check.totalCost,
      nextReset,
    });
  }

  await debitCredits(
    companyId,
    'INGREDIENT_IMPORT_PARSE',
    files.length,
    { fileCount: files.length, method, source: 'ingredient_import_parse' },
    req.user?.id,
  );

  const jobId = randomUUID();
  parseJobs.set(jobId, {
    done: false,
    ingredients: null,
    error: null,
    ingredientCount: 0,
    stage: 'pending',
    currentFile: 0,
    totalFiles: files.length,
    method,
  });

  res.json({ jobId });

  runParseJob(jobId, method, files, companyId, req.user?.id).catch(e => {
    const job = parseJobs.get(jobId);
    if (job) { job.done = true; job.error = e.message; job.stage = 'error'; }
  });
});

// --- GET /ai-import/parse/:jobId ---

router.get('/ai-import/parse/:jobId', (req, res) => {
  const job = parseJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job nao encontrado ou expirado' });
  res.json(job);
});

// --- POST /ai-import/apply ---

router.post('/ai-import/apply', requireRole('ADMIN'), async (req, res) => {
  try {
    const { ingredients } = req.body;
    const companyId = req.user?.companyId;

    if (!companyId) return res.status(401).json({ message: 'Nao autenticado' });
    if (!Array.isArray(ingredients) || !ingredients.length) {
      return res.status(400).json({ message: 'Nenhum ingrediente para importar' });
    }

    const check = await checkCredits(companyId, 'INGREDIENT_IMPORT_ITEM', ingredients.length);
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
      'INGREDIENT_IMPORT_ITEM',
      ingredients.length,
      { ingredientCount: ingredients.length, source: 'ingredient_import_apply' },
      req.user?.id,
    );

    // Load existing groups for validation
    const companyGroups = await prisma.ingredientGroup.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });
    const validGroupIds = new Set(companyGroups.map(g => g.id));

    let created = 0;
    let createdGroups = 0;
    const newGroupMap = new Map(); // groupName -> groupId (for groups created during import)

    for (const ing of ingredients) {
      const description = String(ing.description || '').trim();
      if (!description) continue;

      const unit = ALLOWED_UNITS.includes(String(ing.unit || '').toUpperCase())
        ? String(ing.unit).toUpperCase()
        : 'UN';

      // Resolve group
      let groupId = ing.groupId || null;
      if (groupId && !validGroupIds.has(groupId)) {
        groupId = null;
      }

      // Create new group if requested
      if (!groupId && ing.newGroup && ing.groupName) {
        const groupName = String(ing.groupName).trim();
        if (newGroupMap.has(groupName)) {
          groupId = newGroupMap.get(groupName);
        } else {
          const newGroup = await prisma.ingredientGroup.create({
            data: { companyId, name: groupName },
          });
          groupId = newGroup.id;
          validGroupIds.add(groupId);
          newGroupMap.set(groupName, groupId);
          createdGroups++;
        }
      }

      const data = {
        companyId,
        description,
        unit,
        controlsStock: ing.controlsStock !== false,
        composesCmv: ing.composesCmv !== false,
      };

      if (groupId) data.groupId = groupId;
      if (ing.avgCost !== null && ing.avgCost !== undefined) {
        const cost = parseFloat(ing.avgCost);
        if (!isNaN(cost) && cost >= 0) data.avgCost = cost;
      }
      if (ing.minStock !== null && ing.minStock !== undefined) {
        const min = parseFloat(ing.minStock);
        if (!isNaN(min) && min >= 0) data.minStock = min;
      }

      await prisma.ingredient.create({ data });
      created++;
    }

    return res.json({
      success: true,
      created: {
        ingredients: created,
        groups: createdGroups,
      },
    });

  } catch (e) {
    console.error('[ingredientImport/apply]', e);
    return res.status(500).json({ message: e.message || 'Erro ao importar ingredientes' });
  }
});

export default router;
