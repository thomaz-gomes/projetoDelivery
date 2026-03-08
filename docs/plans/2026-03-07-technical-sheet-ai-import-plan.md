# Technical Sheet AI Import — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable bulk creation of technical sheets (fichas técnicas) from photos, spreadsheets, PDFs, and Word documents using AI (GPT-4o), with intelligent ingredient matching.

**Architecture:** Async job-based processing (same pattern as `menuImport.js`) — POST to start job, GET to poll status, POST to apply results. GPT-4o does parsing + ingredient matching. Frontend modal with 3-step wizard (method → processing → review).

**Tech Stack:** Express.js, Prisma, OpenAI GPT-4o, xlsx library, Vue 3 + Bootstrap 5, SweetAlert2

---

### Task 1: Add `yield` field to TechnicalSheet (Prisma Schema)

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (TechnicalSheet model, ~line 1203)

**Step 1: Add yield field to schema**

In `schema.prisma`, find the `TechnicalSheet` model and add `yield` after `notes`:

```prisma
model TechnicalSheet {
  id        String               @id @default(uuid())
  companyId String
  company   Company              @relation(fields: [companyId], references: [id])
  name      String
  notes     String?
  yield     String?
  createdAt DateTime             @default(now())
  updatedAt DateTime             @updatedAt
  items     TechnicalSheetItem[]

  @@index([companyId, name], name: "company_technical_sheet_name_idx")
}
```

**Step 2: Push schema to dev database**

```bash
cd delivery-saas-backend && npx prisma db push
```

Expected: "Your database is now in sync with your Prisma schema."

**Step 3: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat: add yield field to TechnicalSheet model"
```

---

### Task 2: Update TechnicalSheet CRUD to support `yield`

**Files:**
- Modify: `delivery-saas-backend/src/routes/stock/technicalSheets.js`

**Step 1: Update create endpoint (POST /)**

At line 30, change:
```js
const { name, notes = '' } = req.body || {};
```
to:
```js
const { name, notes = '', yield: yieldValue } = req.body || {};
```

At line 39, change:
```js
const created = await prisma.technicalSheet.create({ data: { companyId, name, notes } });
```
to:
```js
const created = await prisma.technicalSheet.create({ data: { companyId, name, notes, yield: yieldValue || null } });
```

**Step 2: Update patch endpoint (PATCH /:id)**

At line 55, change:
```js
const { name, notes } = req.body || {};
const updated = await prisma.technicalSheet.update({ where: { id }, data: { name: name ?? existing.name, notes: notes ?? existing.notes } });
```
to:
```js
const { name, notes, yield: yieldValue } = req.body || {};
const updated = await prisma.technicalSheet.update({
  where: { id },
  data: {
    name: name ?? existing.name,
    notes: notes ?? existing.notes,
    yield: yieldValue !== undefined ? (yieldValue || null) : existing.yield,
  },
});
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/stock/technicalSheets.js
git commit -m "feat: support yield field in technicalSheets CRUD"
```

---

### Task 3: Register new AI credit service keys

**Files:**
- Modify: `delivery-saas-backend/src/services/aiCreditManager.js`

**Step 1: Add new service costs**

At line 41 (after `AI_STUDIO_ENHANCE`), add:

```js
  TECHNICAL_SHEET_IMPORT_PARSE: 5,  // por arquivo processado (foto/PDF/DOCX/planilha)
  TECHNICAL_SHEET_IMPORT_ITEM:  1,  // por ficha técnica aplicada
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/aiCreditManager.js
git commit -m "feat: add AI credit keys for technical sheet import"
```

---

### Task 4: Create backend route `technicalSheetImport.js`

**Files:**
- Create: `delivery-saas-backend/src/routes/stock/technicalSheetImport.js`

**Step 1: Create the file**

```js
/**
 * technicalSheetImport.js — Import de fichas técnicas via IA (GPT-4o)
 *
 * Padrão assíncrono (igual menuImport.js):
 *   POST /technical-sheets/ai-import/parse       → inicia job, retorna { jobId }
 *   GET  /technical-sheets/ai-import/parse/:jobId → polling de status
 *   POST /technical-sheets/ai-import/apply        → aplica fichas aprovadas
 */

import express from 'express';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';
import { checkCredits, debitCredits, AI_SERVICE_COSTS } from '../../services/aiCreditManager.js';
import { getSetting } from '../../services/systemSettings.js';

const router = express.Router();
router.use(authMiddleware);

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_IMPORT_MODEL || 'gpt-4o';

// Mapa de jobs em memória
const parseJobs = new Map();

// ─── OpenAI helper ──────────────────────────────────────────────────────────

async function callOpenAI(messages, timeoutMs = 120_000) {
  const key = await getSetting('openai_api_key', 'OPENAI_API_KEY');
  if (!key) throw new Error('Chave da API OpenAI não configurada.');
  const model = await getSetting('openai_model', 'OPENAI_IMPORT_MODEL') || OPENAI_MODEL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 16384, messages }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout: OpenAI não respondeu');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};
  console.log(`[OpenAI/TechSheet] tokens: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}`);

  if (data.choices?.[0]?.finish_reason === 'length') {
    console.warn('[OpenAI/TechSheet] AVISO: resposta cortada (finish_reason=length)');
  }

  return { json: extractJSON(rawContent), rawContent, usage };
}

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  throw new Error('IA não retornou JSON válido. Tente novamente.');
}

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(existingIngredients) {
  const ingredientList = existingIngredients.map(i => `- id:"${i.id}" | "${i.description}" | unidade: ${i.unit}`).join('\n');

  return `Você é um extrator especializado em fichas técnicas (receitas) de restaurantes e indústrias alimentícias.
Analise o conteúdo fornecido e retorne APENAS um JSON válido (sem texto extra, sem markdown) no formato:

{"sheets":[{"name":"Nome da Ficha","yield":"Rendimento (ex: 10 porções, 2kg)","items":[{"description":"Nome do ingrediente extraído","quantity":1.5,"unit":"KG","matchedIngredientId":"uuid-do-ingrediente-existente-ou-null","confidence":0.95}]}]}

Regras obrigatórias:
- Extraia TODAS as fichas técnicas/receitas do documento
- Para cada ficha: nome, rendimento (yield), e lista de ingredientes com quantidade e unidade
- "unit" deve ser normalizada para: UN, GR, KG, ML ou L
- "quantity" deve ser número decimal (ex: 1.5), nunca string
- Se a quantidade estiver em uma unidade diferente das permitidas, converta (ex: 500g → 0.5 KG, ou 500 GR)
- "yield" pode ser null se não informado no documento

INGREDIENTES EXISTENTES NA EMPRESA (use para matching):
${ingredientList || '(nenhum cadastrado)'}

Para cada ingrediente extraído:
- Se encontrar um ingrediente existente similar (por nome/sinônimo), preencha "matchedIngredientId" com o id dele e "confidence" com 0.0-1.0
- Se NÃO encontrar match, use "matchedIngredientId": null (será criado como novo)
- Considere sinônimos: "tomate" = "tomate italiano", "óleo" = "óleo de soja", etc.
- Priorize matches com mesma unidade quando possível
- Preserve 100% dos ingredientes — não omita nenhum`;
}

// ─── Processamento assíncrono ───────────────────────────────────────────────

async function runParseJob(jobId, method, files, companyId) {
  const job = parseJobs.get(jobId);
  if (!job) return;

  try {
    // Buscar ingredientes existentes da empresa para matching
    job.stage = 'loading_ingredients';
    const existingIngredients = await prisma.ingredient.findMany({
      where: { companyId },
      select: { id: true, description: true, unit: true },
      orderBy: { description: 'asc' },
    });
    console.log(`[TechSheetImport:${jobId}] ${existingIngredients.length} ingredientes existentes carregados`);

    const systemPrompt = buildSystemPrompt(existingIngredients);
    const allSheets = [];

    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      job.stage = 'ai_analyzing';
      job.currentFile = fi + 1;
      job.totalFiles = files.length;

      let messages;

      if (method === 'photo') {
        // Imagem: enviar como vision content
        const imageUrl = String(file).trim();
        if (!imageUrl.startsWith('data:image/')) continue;
        messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: files.length > 1
              ? `Analise esta imagem de ficha técnica/receita (${fi + 1} de ${files.length}) e extraia todas as fichas.`
              : 'Analise esta imagem de ficha técnica/receita e extraia todas as fichas com ingredientes, quantidades e rendimento.' },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ]},
        ];

      } else if (method === 'spreadsheet') {
        // Planilha: parse com xlsx → texto estruturado
        const base64Data = String(file).includes(',') ? String(file).split(',')[1] : String(file);
        const buffer = Buffer.from(base64Data, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });

        // Processa todas as abas
        const allRows = [];
        for (const sheetName of workbook.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
          if (rows.length) {
            allRows.push({ sheetName, rows });
          }
        }
        if (!allRows.length) throw new Error('Planilha vazia ou inválida');

        const sheetText = allRows.map(s => {
          const headers = Object.keys(s.rows[0] || {});
          return `Aba "${s.sheetName}" (${s.rows.length} linhas)\nColunas: ${headers.join(', ')}\nDados:\n${JSON.stringify(s.rows.slice(0, 200), null, 2)}`;
        }).join('\n\n');

        messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Planilha com fichas técnicas:\n\n${sheetText}\n\nExtraia todas as fichas técnicas com ingredientes, quantidades e rendimento.` },
        ];

      } else if (method === 'pdf') {
        // PDF: enviar como base64 image (GPT-4o suporta)
        const pdfData = String(file).trim();
        if (pdfData.startsWith('data:image/')) {
          // Se o frontend converteu páginas do PDF em imagens
          messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [
              { type: 'text', text: 'Analise esta imagem de ficha técnica/receita e extraia todas as fichas com ingredientes, quantidades e rendimento.' },
              { type: 'image_url', image_url: { url: pdfData, detail: 'high' } },
            ]},
          ];
        } else {
          // Texto extraído do PDF pelo frontend (via pdf.js)
          messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Documento de fichas técnicas:\n\n${String(file).slice(0, 24000)}\n\nExtraia todas as fichas técnicas com ingredientes, quantidades e rendimento.` },
          ];
        }

      } else if (method === 'docx') {
        // Word: texto extraído pelo frontend
        messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Documento de fichas técnicas:\n\n${String(file).slice(0, 24000)}\n\nExtraia todas as fichas técnicas com ingredientes, quantidades e rendimento.` },
        ];

      } else {
        throw new Error(`Método desconhecido: ${method}`);
      }

      const aiResult = await callOpenAI(messages);
      const parsed = aiResult.json;

      if (parsed?.sheets && Array.isArray(parsed.sheets)) {
        allSheets.push(...parsed.sheets);
      }
    }

    // Normalizar resultado
    const sheets = allSheets.map(sheet => ({
      name: String(sheet.name || 'Ficha sem nome').trim(),
      yield: sheet.yield ? String(sheet.yield).trim() : null,
      items: (sheet.items || []).map(item => ({
        description: String(item.description || '').trim(),
        quantity: parseFloat(item.quantity) || 0,
        unit: ['UN', 'GR', 'KG', 'ML', 'L'].includes(String(item.unit).toUpperCase())
          ? String(item.unit).toUpperCase()
          : 'UN',
        matchedIngredientId: item.matchedIngredientId || null,
        confidence: parseFloat(item.confidence) || 0,
      })).filter(item => item.description && item.quantity > 0),
    })).filter(sheet => sheet.items.length > 0);

    job.done = true;
    job.sheets = sheets;
    job.sheetCount = sheets.length;
    job.creditEstimate = {
      sheetCount: sheets.length,
      serviceKey: 'TECHNICAL_SHEET_IMPORT_ITEM',
      costPerUnit: AI_SERVICE_COSTS.TECHNICAL_SHEET_IMPORT_ITEM ?? 1,
      totalCost: sheets.length * (AI_SERVICE_COSTS.TECHNICAL_SHEET_IMPORT_ITEM ?? 1),
    };

  } catch (e) {
    console.error(`[TechSheetImport:${jobId}] Erro:`, e.message);
    job.done = true;
    job.error = e.message || 'Erro ao processar com IA';
  }

  // Limpar job após 15 min
  setTimeout(() => parseJobs.delete(jobId), 15 * 60 * 1000);
}

// ─── POST /ai-import/parse ─────────────────────────────────────────────────

router.post('/ai-import/parse', requireRole('ADMIN'), async (req, res) => {
  const { method, files } = req.body;
  if (!method || !files || !Array.isArray(files) || !files.length) {
    return res.status(400).json({ message: 'method e files (array) são obrigatórios' });
  }

  const validMethods = ['photo', 'spreadsheet', 'pdf', 'docx'];
  if (!validMethods.includes(method)) {
    return res.status(400).json({ message: `Método inválido. Use: ${validMethods.join(', ')}` });
  }

  const companyId = req.user?.companyId;
  if (!companyId) return res.status(401).json({ message: 'Não autenticado' });

  // Verificar créditos mínimos
  const check = await checkCredits(companyId, 'TECHNICAL_SHEET_IMPORT_PARSE', files.length);
  if (!check.ok) {
    return res.status(402).json({
      message: 'Créditos de IA insuficientes.',
      balance: check.balance,
      monthlyLimit: check.monthlyLimit,
    });
  }

  // Debitar créditos do parse imediatamente (custo por arquivo)
  await debitCredits(companyId, 'TECHNICAL_SHEET_IMPORT_PARSE', files.length,
    { method, fileCount: files.length, source: 'technical_sheet_import_parse' }, req.user?.id);

  const jobId = randomUUID();
  parseJobs.set(jobId, {
    done: false, sheets: null, error: null, sheetCount: 0,
    stage: 'pending', currentFile: 0, totalFiles: files.length, method,
  });

  res.json({ jobId });

  runParseJob(jobId, method, files, companyId).catch(e => {
    const job = parseJobs.get(jobId);
    if (job) { job.done = true; job.error = e.message; }
  });
});

// ─── GET /ai-import/parse/:jobId ───────────────────────────────────────────

router.get('/ai-import/parse/:jobId', (req, res) => {
  const job = parseJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job não encontrado ou expirado' });
  res.json(job);
});

// ─── POST /ai-import/apply ─────────────────────────────────────────────────

router.post('/ai-import/apply', requireRole('ADMIN'), async (req, res) => {
  try {
    const { sheets } = req.body;
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Não autenticado' });
    if (!Array.isArray(sheets) || !sheets.length) {
      return res.status(400).json({ message: 'Nenhuma ficha para importar' });
    }

    // Verificar e debitar créditos (1 por ficha)
    const check = await checkCredits(companyId, 'TECHNICAL_SHEET_IMPORT_ITEM', sheets.length);
    if (!check.ok) {
      return res.status(402).json({
        message: `Créditos insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}.`,
        required: check.totalCost,
        balance: check.balance,
      });
    }
    await debitCredits(companyId, 'TECHNICAL_SHEET_IMPORT_ITEM', sheets.length,
      { sheetCount: sheets.length, source: 'technical_sheet_import_apply' }, req.user?.id);

    const ALLOWED_UNITS = ['UN', 'GR', 'KG', 'ML', 'L'];
    let createdSheets = 0;
    let createdIngredients = 0;
    let createdItems = 0;

    for (const sheetData of sheets) {
      const name = String(sheetData.name || '').trim();
      if (!name) continue;

      // Create technical sheet
      const newSheet = await prisma.technicalSheet.create({
        data: {
          companyId,
          name,
          notes: sheetData.notes || null,
          yield: sheetData.yield || null,
        },
      });
      createdSheets++;

      // Process items
      for (const item of (sheetData.items || [])) {
        const quantity = parseFloat(item.quantity);
        if (!quantity || quantity <= 0) continue;

        let ingredientId = item.ingredientId || null;

        // If marked as new ingredient, create it
        if (!ingredientId && item.newIngredient && item.description) {
          const unit = ALLOWED_UNITS.includes(String(item.unit).toUpperCase())
            ? String(item.unit).toUpperCase()
            : 'UN';
          const newIng = await prisma.ingredient.create({
            data: {
              companyId,
              description: String(item.description).trim(),
              unit,
            },
          });
          ingredientId = newIng.id;
          createdIngredients++;
        }

        // Validate ingredient exists and belongs to company
        if (ingredientId) {
          const exists = await prisma.ingredient.findFirst({
            where: { id: ingredientId, companyId },
          });
          if (!exists) {
            console.warn(`[TechSheetImport] Ingredient ${ingredientId} not found, skipping item`);
            continue;
          }

          await prisma.technicalSheetItem.create({
            data: { technicalSheetId: newSheet.id, ingredientId, quantity },
          });
          createdItems++;
        }
      }
    }

    return res.json({
      success: true,
      created: { sheets: createdSheets, ingredients: createdIngredients, items: createdItems },
    });

  } catch (e) {
    console.error('[TechSheetImport/apply]', e);
    return res.status(500).json({ message: e.message || 'Erro ao importar fichas técnicas' });
  }
});

export default router;
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/stock/technicalSheetImport.js
git commit -m "feat: add technical sheet AI import backend route"
```

---

### Task 5: Mount the new route in `index.js`

**Files:**
- Modify: `delivery-saas-backend/src/index.js`

**Step 1: Add import**

After line 40 (`import technicalSheetsRouter from './routes/stock/technicalSheets.js'`), add:

```js
import technicalSheetImportRouter from './routes/stock/technicalSheetImport.js'
```

**Step 2: Mount route**

After line 198 (`app.use('/technical-sheets', requireModule('STOCK'), technicalSheetsRouter);`), add:

```js
app.use('/technical-sheets', requireModule('STOCK'), technicalSheetImportRouter);
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/index.js
git commit -m "feat: mount technical sheet import route"
```

---

### Task 6: Create frontend modal `TechnicalSheetAiImportModal.vue`

**Files:**
- Create: `delivery-saas-frontend/src/components/TechnicalSheetAiImportModal.vue`

**Step 1: Create the component**

This is the largest file. It follows the exact same 3-step pattern as `MenuAiImportModal.vue` but adapted for technical sheets with ingredient matching UI.

```vue
<template>
  <div class="modal d-block ai-import-backdrop" tabindex="-1" role="dialog" @click.self="handleBackdropClick">
    <div class="modal-dialog modal-xl modal-dialog-scrollable modal-fullscreen-sm-down" role="document">
      <div class="modal-content">

        <!-- Header -->
        <div class="modal-header">
          <div>
            <h5 class="modal-title mb-0">
              <i class="bi bi-stars me-2 text-warning"></i>Importar Fichas Técnicas com IA
            </h5>
          </div>
          <button type="button" class="btn-close" @click="$emit('close')" :disabled="parsing || applying"></button>
        </div>

        <!-- Progress Steps -->
        <div class="modal-header border-0 py-2 px-4">
          <div class="d-flex align-items-center w-100 step-progress">
            <div
              v-for="(label, i) in steps"
              :key="i"
              class="step-item d-flex align-items-center"
              :class="{ active: step === i + 1, done: step > i + 1 }"
            >
              <div class="step-circle">
                <i v-if="step > i + 1" class="bi bi-check-lg"></i>
                <span v-else>{{ i + 1 }}</span>
              </div>
              <span class="step-label d-none d-sm-inline ms-1">{{ label }}</span>
              <div v-if="i < steps.length - 1" class="step-line"></div>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="modal-body px-4">

          <!-- STEP 1: Método -->
          <div v-if="step === 1">
            <p class="text-muted mb-3">Como deseja importar as fichas técnicas?</p>
            <div class="row g-3">
              <div class="col-6 col-sm-3" v-for="m in methods" :key="m.key">
                <div
                  class="method-card"
                  :class="{ selected: method === m.key }"
                  @click="method = m.key"
                  role="button"
                  tabindex="0"
                >
                  <i :class="m.icon + ' method-icon ' + m.color"></i>
                  <div class="method-title">{{ m.title }}</div>
                  <div class="method-desc text-muted small">{{ m.desc }}</div>
                  <div class="text-primary-emphasis small mt-1 fw-semibold">{{ m.cost }} crédito(s) / arquivo</div>
                </div>
              </div>
            </div>
          </div>

          <!-- STEP 2: Upload -->
          <div v-if="step === 2">

            <!-- Photo -->
            <div v-if="method === 'photo'">
              <label class="form-label fw-semibold">Fotos das fichas técnicas</label>
              <input ref="photoInput" type="file" accept="image/*" multiple class="d-none" @change="handleFileChange($event)" />
              <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="d-none" @change="handleFileChange($event)" />
              <div v-if="filePreviews.length === 0" class="dropzone" :class="{ 'drag-over': dragging }"
                @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="handleDrop($event)">
                <div class="dropzone-inner">
                  <i class="bi bi-images dropzone-icon text-muted"></i>
                  <div class="dropzone-text mb-3">Selecione as fotos das fichas técnicas</div>
                  <div class="d-flex gap-2 justify-content-center flex-wrap">
                    <button type="button" class="btn btn-outline-primary btn-sm px-3" @click="$refs.photoInput.click()">
                      <i class="bi bi-folder2-open me-1"></i>Galeria
                    </button>
                    <button type="button" class="btn btn-outline-success btn-sm px-3" @click="$refs.cameraInput.click()">
                      <i class="bi bi-camera me-1"></i>Câmera
                    </button>
                  </div>
                </div>
              </div>
              <div v-else class="photo-grid" :class="{ 'drag-over': dragging }"
                @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="handleDrop($event)">
                <div v-for="(preview, i) in filePreviews" :key="i" class="photo-thumb">
                  <img :src="preview" :alt="`Foto ${i + 1}`" />
                  <button type="button" class="photo-remove-btn" @click.stop="removeFile(i)" title="Remover">
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
                <div class="photo-add-btn" @click="$refs.photoInput.click()" role="button" title="Adicionar">
                  <i class="bi bi-plus-lg"></i>
                </div>
              </div>
            </div>

            <!-- Spreadsheet -->
            <div v-if="method === 'spreadsheet'">
              <label class="form-label fw-semibold">Planilha com fichas técnicas</label>
              <div class="dropzone" :class="{ 'drag-over': dragging, 'has-file': fileNames.length }"
                @dragover.prevent="dragging = true" @dragleave="dragging = false"
                @drop.prevent="handleDrop($event)" @click="$refs.fileInput.click()" role="button">
                <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" class="d-none" @change="handleFileChange($event)" />
                <div v-if="!fileNames.length" class="dropzone-inner">
                  <i class="bi bi-file-earmark-spreadsheet dropzone-icon text-muted"></i>
                  <div class="dropzone-text">Arraste a planilha aqui ou toque para selecionar</div>
                  <div class="small text-muted mt-1">.xlsx, .xls, .csv</div>
                </div>
                <div v-else class="dropzone-inner">
                  <i class="bi bi-file-earmark-check dropzone-icon text-success"></i>
                  <div class="dropzone-text fw-semibold">{{ fileNames.join(', ') }}</div>
                  <div class="small text-muted mt-1">Toque para trocar</div>
                </div>
              </div>
            </div>

            <!-- PDF -->
            <div v-if="method === 'pdf'">
              <label class="form-label fw-semibold">PDF com fichas técnicas</label>
              <div class="dropzone" :class="{ 'drag-over': dragging, 'has-file': fileNames.length }"
                @dragover.prevent="dragging = true" @dragleave="dragging = false"
                @drop.prevent="handleDrop($event)" @click="$refs.fileInput.click()" role="button">
                <input ref="fileInput" type="file" accept=".pdf" class="d-none" @change="handleFileChange($event)" />
                <div v-if="!fileNames.length" class="dropzone-inner">
                  <i class="bi bi-file-earmark-pdf dropzone-icon text-muted"></i>
                  <div class="dropzone-text">Arraste o PDF aqui ou toque para selecionar</div>
                </div>
                <div v-else class="dropzone-inner">
                  <i class="bi bi-file-earmark-check dropzone-icon text-success"></i>
                  <div class="dropzone-text fw-semibold">{{ fileNames.join(', ') }}</div>
                  <div class="small text-muted mt-1">Toque para trocar</div>
                </div>
              </div>
              <div class="form-text mt-2">O PDF será convertido em imagens para análise pela IA.</div>
            </div>

            <!-- DOCX -->
            <div v-if="method === 'docx'">
              <label class="form-label fw-semibold">Documento Word com fichas técnicas</label>
              <div class="dropzone" :class="{ 'drag-over': dragging, 'has-file': fileNames.length }"
                @dragover.prevent="dragging = true" @dragleave="dragging = false"
                @drop.prevent="handleDrop($event)" @click="$refs.fileInput.click()" role="button">
                <input ref="fileInput" type="file" accept=".docx,.doc" class="d-none" @change="handleFileChange($event)" />
                <div v-if="!fileNames.length" class="dropzone-inner">
                  <i class="bi bi-file-earmark-word dropzone-icon text-muted"></i>
                  <div class="dropzone-text">Arraste o documento aqui ou toque para selecionar</div>
                </div>
                <div v-else class="dropzone-inner">
                  <i class="bi bi-file-earmark-check dropzone-icon text-success"></i>
                  <div class="dropzone-text fw-semibold">{{ fileNames.join(', ') }}</div>
                  <div class="small text-muted mt-1">Toque para trocar</div>
                </div>
              </div>
            </div>

            <div v-if="parseError" class="alert alert-danger mt-3">
              <i class="bi bi-exclamation-triangle me-2"></i>{{ parseError }}
            </div>
          </div>

          <!-- STEP 3: Revisão -->
          <div v-if="step === 3">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <div>
                <span class="badge bg-success me-2">{{ sheets.length }} fichas</span>
                <span class="badge bg-secondary">{{ totalItems }} ingredientes</span>
              </div>
              <button class="btn btn-sm btn-outline-secondary" @click="step = 2">
                <i class="bi bi-arrow-left me-1"></i>Voltar
              </button>
            </div>

            <!-- Credit estimate -->
            <div v-if="creditEstimate" class="alert d-flex align-items-start gap-2 mb-3"
              :class="canImport ? 'alert-info' : 'alert-danger'">
              <i class="bi bi-stars mt-1" style="font-size:1.1rem;flex-shrink:0"></i>
              <div class="flex-grow-1">
                <div>
                  Esta operação consumirá <strong>{{ creditEstimate.totalCost }} crédito(s)</strong>
                  <small class="text-muted ms-1">({{ creditEstimate.sheetCount }} fichas × {{ creditEstimate.costPerUnit }} crédito cada)</small>
                </div>
                <div v-if="!canImport" class="mt-1 fw-semibold">
                  <i class="bi bi-lock me-1"></i>Saldo atual: {{ aiCreditsStore.balance ?? '—' }} crédito(s).
                </div>
              </div>
            </div>

            <!-- Sheets accordion -->
            <div v-for="(sheet, si) in sheets" :key="si" class="review-sheet mb-3">
              <div class="review-sheet-header d-flex align-items-center justify-content-between" @click="toggleSheet(si)" role="button">
                <div class="d-flex align-items-center gap-2">
                  <i class="bi" :class="sheetCollapsed[si] ? 'bi-chevron-right' : 'bi-chevron-down'"></i>
                  <input v-model="sheet.name" class="form-control form-control-sm review-sheet-name" placeholder="Nome da ficha" @click.stop />
                </div>
                <div class="d-flex align-items-center gap-2">
                  <div v-if="sheet.yield" class="small text-muted">
                    <i class="bi bi-cup-hot me-1"></i>
                    <input v-model="sheet.yield" class="form-control form-control-sm d-inline-block" style="width:120px" placeholder="Rendimento" @click.stop />
                  </div>
                  <span class="badge bg-light text-dark border">{{ (sheet.items || []).length }} itens</span>
                  <button class="btn btn-sm btn-outline-danger" @click.stop="removeSheet(si)" title="Remover ficha">
                    <i class="bi bi-trash"></i>
                  </button>
                </div>
              </div>

              <div v-if="!sheetCollapsed[si]" class="review-items mt-2">
                <div class="table-responsive">
                  <table class="table table-sm mb-0">
                    <thead>
                      <tr>
                        <th style="min-width:180px">Ingrediente Extraído</th>
                        <th style="min-width:220px">Match</th>
                        <th style="width:90px">Qtd</th>
                        <th style="width:90px">Unidade</th>
                        <th style="width:40px"></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, ii) in sheet.items" :key="ii">
                        <td>
                          <span class="small">{{ item.description }}</span>
                        </td>
                        <td>
                          <div v-if="item.newIngredient" class="d-flex align-items-center gap-1">
                            <span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">
                              <i class="bi bi-plus-circle me-1"></i>Criar novo
                            </span>
                            <button class="btn btn-sm btn-link p-0" @click="item.newIngredient = false; item.ingredientId = null" title="Buscar existente">
                              <i class="bi bi-arrow-repeat"></i>
                            </button>
                          </div>
                          <div v-else>
                            <select v-model="item.ingredientId" class="form-select form-select-sm">
                              <option :value="null">-- Criar novo --</option>
                              <option v-for="ing in existingIngredients" :key="ing.id" :value="ing.id">
                                {{ ing.description }} ({{ ing.unit }})
                              </option>
                            </select>
                            <div v-if="item.ingredientId && item.confidence >= 0.7" class="mt-1">
                              <span class="badge bg-success-subtle text-success-emphasis small">
                                <i class="bi bi-check-circle me-1"></i>{{ Math.round(item.confidence * 100) }}% confiança
                              </span>
                            </div>
                            <div v-else-if="item.ingredientId && item.confidence > 0 && item.confidence < 0.7" class="mt-1">
                              <span class="badge bg-warning-subtle text-warning-emphasis small">
                                <i class="bi bi-exclamation-triangle me-1"></i>{{ Math.round(item.confidence * 100) }}% confiança
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <input v-model.number="item.quantity" type="number" step="any" min="0" class="form-control form-control-sm" />
                        </td>
                        <td>
                          <select v-model="item.unit" class="form-select form-select-sm">
                            <option v-for="u in units" :key="u" :value="u">{{ u }}</option>
                          </select>
                        </td>
                        <td>
                          <button class="btn btn-sm btn-outline-danger" @click="removeItem(si, ii)" title="Remover">
                            <i class="bi bi-x-lg"></i>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- Loading overlay -->
          <div v-if="parsing" class="parsing-overlay">
            <div class="text-center px-3">
              <div class="spinner-border text-primary mb-3" role="status">
                <span class="visually-hidden">Analisando...</span>
              </div>
              <div class="fw-semibold">{{ parsingStageLabel }}</div>
              <div class="small text-muted mt-1">{{ parsingStageHint }}</div>
              <div class="progress mt-3" style="height:4px;width:220px;margin:0 auto">
                <div class="progress-bar progress-bar-striped progress-bar-animated w-100"></div>
              </div>
              <div v-if="parsingElapsed > 15" class="small text-muted mt-2">
                {{ parsingElapsed }}s aguardando...
              </div>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <template v-if="step === 1">
            <button class="btn btn-outline-secondary" @click="$emit('close')">Cancelar</button>
            <button class="btn btn-primary" :disabled="!method" @click="step = 2">
              Continuar <i class="bi bi-arrow-right ms-1"></i>
            </button>
          </template>
          <template v-if="step === 2">
            <button class="btn btn-outline-secondary" @click="step = 1" :disabled="parsing">Voltar</button>
            <button class="btn btn-primary" :disabled="!canParse || parsing" @click="parseContent">
              <span v-if="parsing"><span class="spinner-border spinner-border-sm me-1"></span>Analisando...</span>
              <span v-else><i class="bi bi-stars me-1"></i>Analisar com IA</span>
            </button>
          </template>
          <template v-if="step === 3">
            <button class="btn btn-outline-secondary" @click="$emit('close')" :disabled="applying">Cancelar</button>
            <button class="btn btn-success" :disabled="!canImport || applying" @click="doImport">
              <span v-if="applying"><span class="spinner-border spinner-border-sm me-1"></span>Importando...</span>
              <span v-else-if="!canImport"><i class="bi bi-lock me-1"></i>Créditos insuficientes</span>
              <span v-else>
                <i class="bi bi-check-circle me-1"></i>Importar {{ sheets.length }} fichas
                <small v-if="creditEstimate" class="opacity-75 ms-1">(−{{ creditEstimate.totalCost }} créditos)</small>
              </span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, watch } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'
import { useAiCreditsStore } from '../stores/aiCredits.js'

const emit = defineEmits(['close', 'imported'])
const aiCreditsStore = useAiCreditsStore()

const units = ['UN', 'GR', 'KG', 'ML', 'L']
const steps = ['Método', 'Upload', 'Revisão']
const step = ref(1)
const method = ref('')
const parsing = ref(false)
const applying = ref(false)
const parseError = ref('')
const dragging = ref(false)

const methods = [
  { key: 'photo', title: 'Foto', desc: 'Fotos ou screenshots', icon: 'bi bi-camera', color: 'text-success', cost: 5 },
  { key: 'spreadsheet', title: 'Planilha', desc: '.xlsx ou .csv', icon: 'bi bi-file-earmark-spreadsheet', color: 'text-warning', cost: 5 },
  { key: 'pdf', title: 'PDF', desc: 'Documento PDF', icon: 'bi bi-file-earmark-pdf', color: 'text-danger', cost: 5 },
  { key: 'docx', title: 'Word', desc: 'Documento .docx', icon: 'bi bi-file-earmark-word', color: 'text-primary', cost: 5 },
]

// Files
const fileBase64Array = ref([])
const filePreviews = ref([])
const fileNames = ref([])

// Review
const sheets = ref([])
const sheetCollapsed = reactive({})
const existingIngredients = ref([])
const creditEstimate = ref(null)

const totalItems = computed(() =>
  sheets.value.reduce((acc, s) => acc + (s.items?.length || 0), 0)
)

const canParse = computed(() => fileBase64Array.value.length > 0)

const canImport = computed(() => {
  if (sheets.value.length === 0) return false
  if (!creditEstimate.value) return true
  return aiCreditsStore.hasCredits(creditEstimate.value.totalCost)
})

onMounted(async () => {
  aiCreditsStore.fetch()
  // Load existing ingredients for the review step
  try {
    const { data } = await api.get('/ingredients')
    existingIngredients.value = data || []
  } catch (_) {}
})

// Reset files when method changes
watch(method, () => {
  fileBase64Array.value = []
  filePreviews.value = []
  fileNames.value = []
  parseError.value = ''
})

// ── File Handling ──────────────────────────────────────────────────────────

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// For PDFs: convert to images using canvas (one image per page)
async function pdfToImages(base64) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
  const data = base64.includes(',') ? base64.split(',')[1] : base64
  const pdfData = Uint8Array.from(atob(data), c => c.charCodeAt(0))
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise
  const images = []
  const maxPages = Math.min(pdf.numPages, 10) // limit to 10 pages
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 2.0 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    images.push(canvas.toDataURL('image/jpeg', 0.85))
  }
  return images
}

// For DOCX: extract text using mammoth
async function docxToText(base64) {
  const mammoth = await import('mammoth')
  const data = base64.includes(',') ? base64.split(',')[1] : base64
  const buffer = Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value
}

async function handleFileChange(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  for (const file of files) await processFile(file)
}

async function handleDrop(event) {
  dragging.value = false
  const files = Array.from(event.dataTransfer.files || [])
  for (const file of files) await processFile(file)
}

async function processFile(file) {
  try {
    const base64 = await readFileAsBase64(file)
    if (method.value === 'photo') {
      fileBase64Array.value.push(base64)
      filePreviews.value.push(base64)
      fileNames.value.push(file.name)
    } else {
      // Single file for spreadsheet/pdf/docx
      fileBase64Array.value = [base64]
      fileNames.value = [file.name]
    }
  } catch (e) {
    console.error('File read error', e)
  }
}

function removeFile(index) {
  fileBase64Array.value.splice(index, 1)
  filePreviews.value.splice(index, 1)
  fileNames.value.splice(index, 1)
}

// ── Parse ──────────────────────────────────────────────────────────────────

const jobStage = ref('pending')
const parsingElapsed = ref(0)
let _elapsedTimer = null
let _pollTimer = null

const _stageLabelMap = {
  pending: { label: 'Iniciando...', hint: 'Preparando o processamento' },
  loading_ingredients: { label: 'Carregando ingredientes...', hint: 'Buscando ingredientes existentes para matching' },
  ai_analyzing: { label: 'Analisando com IA (GPT-4o)...', hint: 'Extraindo fichas técnicas e fazendo matching de ingredientes' },
}

const parsingStageLabel = computed(() => _stageLabelMap[jobStage.value]?.label || 'Analisando com IA...')
const parsingStageHint = computed(() => _stageLabelMap[jobStage.value]?.hint || 'Aguarde...')

async function parseContent() {
  parseError.value = ''
  parsing.value = true
  parsingElapsed.value = 0
  jobStage.value = 'pending'
  _elapsedTimer = setInterval(() => { parsingElapsed.value++ }, 1000)

  try {
    let filesToSend = [...fileBase64Array.value]

    // Pre-process PDF: convert to images
    if (method.value === 'pdf' && filesToSend.length) {
      jobStage.value = 'converting_pdf'
      const images = await pdfToImages(filesToSend[0])
      filesToSend = images
    }

    // Pre-process DOCX: extract text
    if (method.value === 'docx' && filesToSend.length) {
      jobStage.value = 'converting_docx'
      const text = await docxToText(filesToSend[0])
      filesToSend = [text]
    }

    // For PDF, we send as 'photo' method (images) to the backend
    const backendMethod = method.value === 'pdf' ? 'photo' : method.value

    const res = await api.post('/technical-sheets/ai-import/parse',
      { method: backendMethod, files: filesToSend }, { timeout: 10000 })
    const { jobId } = res.data

    // Polling
    await new Promise((resolve, reject) => {
      function poll() {
        _pollTimer = setTimeout(async () => {
          try {
            const { data } = await api.get(`/technical-sheets/ai-import/parse/${jobId}`, { timeout: 8000 })
            if (data.stage) jobStage.value = data.stage
            if (data.done) {
              if (data.error) reject(new Error(data.error))
              else resolve(data)
            } else {
              poll()
            }
          } catch (e) { reject(e) }
        }, 1500)
      }
      poll()
    }).then(data => {
      sheets.value = (data.sheets || []).map(sheet => ({
        name: sheet.name,
        yield: sheet.yield,
        items: (sheet.items || []).map(item => {
          // Determine if this is a new ingredient or matched
          const isNew = !item.matchedIngredientId
          return {
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            ingredientId: item.matchedIngredientId || null,
            newIngredient: isNew,
            confidence: item.confidence || 0,
          }
        }),
      }))
      sheets.value.forEach((_, i) => { sheetCollapsed[i] = false })
      if (data.creditEstimate) creditEstimate.value = data.creditEstimate

      if (sheets.value.length === 0) {
        parseError.value = 'A IA não encontrou fichas técnicas no conteúdo. Tente com outro formato.'
        return
      }
      step.value = 3
    })

  } catch (e) {
    if (e.response?.status === 402) {
      parseError.value = e.response.data?.message || 'Créditos de IA insuficientes.'
    } else {
      parseError.value = e.response?.data?.message || e.message || 'Erro ao processar com IA'
    }
  } finally {
    parsing.value = false
    clearInterval(_elapsedTimer)
    clearTimeout(_pollTimer)
  }
}

// ── Review editing ──────────────────────────────────────────────────────────

function toggleSheet(si) { sheetCollapsed[si] = !sheetCollapsed[si] }
function removeSheet(si) { sheets.value.splice(si, 1) }
function removeItem(si, ii) { sheets.value[si].items.splice(ii, 1) }

// ── Apply ───────────────────────────────────────────────────────────────────

async function doImport() {
  applying.value = true
  try {
    const cleanSheets = sheets.value
      .filter(s => s.name?.trim() && s.items?.length)
      .map(s => ({
        name: s.name,
        yield: s.yield || null,
        items: s.items.map(item => ({
          ingredientId: item.newIngredient ? null : item.ingredientId,
          newIngredient: item.newIngredient || !item.ingredientId,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
        })),
      }))

    const { data } = await api.post('/technical-sheets/ai-import/apply', { sheets: cleanSheets })

    aiCreditsStore.fetch()

    Swal.fire({
      toast: true, position: 'top-end', showConfirmButton: false, timer: 4000,
      icon: 'success',
      title: `${data.created?.sheets || 0} fichas importadas com sucesso!`,
      html: data.created?.ingredients ? `<small>${data.created.ingredients} novos ingredientes criados</small>` : '',
    })

    emit('imported')
    emit('close')
  } catch (e) {
    if (e.response?.status === 402) {
      Swal.fire({ icon: 'warning', title: 'Créditos insuficientes', html: e.response.data?.message })
    } else {
      Swal.fire({ icon: 'error', title: 'Erro ao importar', text: e.response?.data?.message || e.message })
    }
  } finally {
    applying.value = false
  }
}

function handleBackdropClick() {
  if (!parsing.value && !applying.value) emit('close')
}
</script>

<style scoped>
.ai-import-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 1055;
  display: flex; align-items: center; justify-content: center;
}
.step-progress { gap: 0; }
.step-item { display: flex; align-items: center; flex: 1; }
.step-circle {
  width: 28px; height: 28px; border-radius: 50%; background: #dee2e6; color: #6c757d;
  font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 0.2s, color 0.2s;
}
.step-item.active .step-circle { background: #0d6efd; color: #fff; }
.step-item.done .step-circle { background: #198754; color: #fff; }
.step-label { font-size: 13px; color: #6c757d; white-space: nowrap; }
.step-item.active .step-label { color: #0d6efd; font-weight: 600; }
.step-item.done .step-label { color: #198754; }
.step-line { flex: 1; height: 2px; background: #dee2e6; margin: 0 6px; }
.method-card {
  border: 2px solid #dee2e6; border-radius: 12px; padding: 20px 16px; text-align: center;
  cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; user-select: none;
}
.method-card:hover { border-color: #0d6efd; box-shadow: 0 2px 8px rgba(13, 110, 253, 0.12); }
.method-card.selected { border-color: #0d6efd; background: #f0f5ff; }
.method-icon { font-size: 2rem; display: block; margin-bottom: 8px; }
.method-title { font-weight: 600; font-size: 15px; }
.method-desc { font-size: 12px; margin-top: 4px; }
.dropzone {
  border: 2px dashed #ced4da; border-radius: 12px; padding: 32px 16px; cursor: pointer;
  transition: border-color 0.15s, background 0.15s; background: #fff; min-height: 160px;
  display: flex; align-items: center; justify-content: center;
}
.dropzone:hover, .dropzone.drag-over { border-color: #0d6efd; background: #f0f5ff; }
.dropzone.has-file { border-color: #198754; background: #f0fff4; }
.dropzone-inner { text-align: center; }
.dropzone-icon { font-size: 2.5rem; display: block; margin-bottom: 8px; }
.dropzone-text { font-size: 14px; font-weight: 500; }
.photo-grid {
  display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; border: 2px dashed #ced4da;
  border-radius: 12px; background: #f8f9fa; min-height: 120px;
}
.photo-grid.drag-over { border-color: #0d6efd; background: #f0f5ff; }
.photo-thumb { position: relative; width: 96px; height: 96px; border-radius: 8px; overflow: hidden; border: 1px solid #dee2e6; }
.photo-thumb img { width: 100%; height: 100%; object-fit: cover; }
.photo-remove-btn {
  position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%;
  background: rgba(220, 53, 69, 0.88); color: #fff; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-size: 10px; padding: 0;
}
.photo-add-btn {
  width: 96px; height: 96px; border-radius: 8px; border: 2px dashed #ced4da;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  color: #6c757d; font-size: 1.5rem;
}
.photo-add-btn:hover { border-color: #0d6efd; color: #0d6efd; background: #f0f5ff; }
.review-sheet { background: #f8f9fa; border-radius: 10px; padding: 12px; border: 1px solid #e9ecef; }
.review-sheet-header { padding-bottom: 8px; cursor: pointer; }
.review-sheet-name {
  font-weight: 600; background: transparent; border: 1px solid transparent;
  border-radius: 4px; padding: 2px 6px; transition: border-color 0.15s; max-width: 300px;
}
.review-sheet-name:focus { border-color: #86b7fe; background: #fff; outline: none; box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.15); }
.review-items { padding-left: 4px; }
.parsing-overlay {
  position: absolute; inset: 0; background: rgba(255, 255, 255, 0.88);
  display: flex; align-items: center; justify-content: center; z-index: 10;
}
.gap-2 { gap: 0.5rem; }
</style>
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/components/TechnicalSheetAiImportModal.vue
git commit -m "feat: add TechnicalSheetAiImportModal component"
```

---

### Task 7: Add "Importar com IA" button to TechnicalSheets.vue

**Files:**
- Modify: `delivery-saas-frontend/src/views/stock/TechnicalSheets.vue`

**Step 1: Import the modal component**

After line 6 (`import TechnicalSheetForm from '../../components/TechnicalSheetForm.vue';`), add:

```js
import TechnicalSheetAiImportModal from '../../components/TechnicalSheetAiImportModal.vue';
```

**Step 2: Add state for showing the import modal**

After line 19 (`const itemIng = ref(null);`), add:

```js
const showAiImport = ref(false);
```

**Step 3: Add the button in the #actions template**

At line 99, change:
```html
<template #actions>
  <button class="btn btn-primary" @click="openCreate">Nova Ficha</button>
</template>
```
to:
```html
<template #actions>
  <button class="btn btn-outline-primary me-2" @click="showAiImport = true">
    <i class="bi bi-stars me-1"></i>Importar com IA
  </button>
  <button class="btn btn-primary" @click="openCreate">Nova Ficha</button>
</template>
```

**Step 4: Add the modal component in the template**

After the closing `</div>` of the main container (line 185), but before `</template>`, add:

```html
<TechnicalSheetAiImportModal
  v-if="showAiImport"
  @close="showAiImport = false"
  @imported="showAiImport = false; fetch()"
/>
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/stock/TechnicalSheets.vue
git commit -m "feat: add AI import button to technical sheets list"
```

---

### Task 8: Update TechnicalSheetEdit.vue to show yield field

**Files:**
- Modify: `delivery-saas-frontend/src/views/stock/TechnicalSheetEdit.vue`

**Step 1: Add yield input**

At line 57, after the notes `TextInput`, add a new column:

Change:
```html
<div class="row g-2 mb-3">
  <div class="col-md-6"><TextInput v-model="sheet.name" inputClass="form-control" placeholder="Nome da ficha" required /></div>
  <div class="col-md-6"><TextInput v-model="sheet.notes" inputClass="form-control" placeholder="Observações (opcional)" /></div>
</div>
```
to:
```html
<div class="row g-2 mb-3">
  <div class="col-md-5"><TextInput v-model="sheet.name" inputClass="form-control" placeholder="Nome da ficha" required /></div>
  <div class="col-md-4"><TextInput v-model="sheet.notes" inputClass="form-control" placeholder="Observações (opcional)" /></div>
  <div class="col-md-3"><TextInput v-model="sheet.yield" inputClass="form-control" placeholder="Rendimento (ex: 10 porções)" /></div>
</div>
```

**Step 2: Include yield in save payload**

At line 29, change:
```js
await api.patch(`/technical-sheets/${id}`, { name: sheet.value.name, notes: sheet.value.notes });
```
to:
```js
await api.patch(`/technical-sheets/${id}`, { name: sheet.value.name, notes: sheet.value.notes, yield: sheet.value.yield });
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/stock/TechnicalSheetEdit.vue
git commit -m "feat: show yield field in technical sheet edit view"
```

---

### Task 9: Install frontend dependencies (pdfjs-dist, mammoth)

**Files:**
- Modify: `delivery-saas-frontend/package.json`

**Step 1: Install pdfjs-dist and mammoth**

```bash
cd delivery-saas-frontend && npm install pdfjs-dist mammoth
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/package.json delivery-saas-frontend/package-lock.json
git commit -m "feat: add pdfjs-dist and mammoth for PDF/DOCX processing"
```

---

### Task 10: Manual testing

**Step 1: Start Docker dev environment**

```bash
docker compose up -d
```

**Step 2: Test the flow**

1. Navigate to `/technical-sheets` in the frontend
2. Click "Importar com IA"
3. Select "Foto" method
4. Upload a photo of a recipe/technical sheet
5. Wait for AI analysis
6. Review the extracted sheets — verify:
   - Sheet names are correct
   - Ingredients are matched to existing ones (with confidence badges)
   - New ingredients show "Criar novo" badge
   - Quantities and units are correct
7. Click "Importar X fichas"
8. Verify sheets appear in the list
9. Open a sheet and verify:
   - Yield field is displayed
   - Items have correct ingredients linked
   - New ingredients were created in the system

**Step 3: Test with spreadsheet**

Repeat with a .xlsx file containing recipe data.

**Step 4: Test with PDF**

Repeat with a PDF document containing recipes.

**Step 5: Test credit system**

Verify credits are debited correctly (5 per file parsed + 1 per sheet applied).

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete technical sheet AI import feature"
```
