# AI Provider Per Service — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow SUPER_ADMIN to choose between Gemini and OpenAI for each text-based AI service via SaaS Settings.

**Architecture:** A new `ai_provider_map` SystemSetting stores a JSON object mapping each service key to `"gemini"` or `"openai"`. A central `aiProvider.js` module reads this map and routes `callTextAI()` calls to the correct provider. Image services (AI Studio enhance/generate, receipt photo OCR) remain hardcoded to Gemini.

**Tech Stack:** Express.js backend, Vue 3 frontend, SystemSetting table (Prisma), Google Generative AI REST API, OpenAI Chat Completions REST API.

---

### Task 1: Create `aiProvider.js` — unified text AI caller

**Files:**
- Create: `delivery-saas-backend/src/services/aiProvider.js`

**Step 1: Create the module**

```javascript
/**
 * aiProvider.js — Unified text AI caller.
 *
 * Reads `ai_provider_map` from SystemSetting to decide whether each
 * service key should be routed to Gemini or OpenAI.
 *
 * Image services (AI Studio enhance/generate, receipt photo) are NOT
 * handled here — they stay on Gemini directly.
 */

import { getSetting } from './systemSettings.js';

const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.5-flash';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Default provider per service key (used when ai_provider_map is missing or incomplete)
const DEFAULT_PROVIDERS = {
  NFE_IMPORT_MATCH:              'gemini',
  MENU_IMPORT_ITEM:              'openai',
  MENU_IMPORT_LINK:              'openai',
  MENU_IMPORT_PHOTO:             'openai',
  MENU_IMPORT_PLANILHA:          'openai',
  INGREDIENT_IMPORT_PARSE:       'openai',
  INGREDIENT_IMPORT_ITEM:        'openai',
  TECHNICAL_SHEET_IMPORT_PARSE:  'openai',
  TECHNICAL_SHEET_IMPORT_ITEM:   'openai',
  GENERATE_DESCRIPTION:          'gemini',
  POS_PARSER:                    'openai',
};

/**
 * Resolve which provider to use for a given service key.
 * @param {string} serviceKey
 * @returns {Promise<'gemini'|'openai'>}
 */
export async function getProviderForService(serviceKey) {
  const raw = await getSetting('ai_provider_map');
  if (raw) {
    try {
      const map = JSON.parse(raw);
      if (map[serviceKey]) return map[serviceKey];
    } catch { /* fall through to defaults */ }
  }
  return DEFAULT_PROVIDERS[serviceKey] || 'openai';
}

/**
 * Call a text-based AI model (Gemini or OpenAI) based on the configured provider
 * for the given service key.
 *
 * @param {string} serviceKey - Credit service key (e.g. 'NFE_IMPORT_MATCH')
 * @param {string} systemPrompt - System-level instructions
 * @param {string} userContent - User message content
 * @param {object} [options]
 * @param {number} [options.temperature=0] - Sampling temperature
 * @param {number} [options.maxTokens=8192] - Max output tokens
 * @param {number} [options.timeoutMs=120000] - Request timeout
 * @returns {Promise<string>} Raw text response from the model
 */
export async function callTextAI(serviceKey, systemPrompt, userContent, options = {}) {
  const provider = await getProviderForService(serviceKey);
  const { temperature = 0, maxTokens = 8192, timeoutMs = 120_000 } = options;

  if (provider === 'gemini') {
    return callGemini(systemPrompt, userContent, { temperature, maxTokens, timeoutMs });
  }
  return callOpenAI(systemPrompt, userContent, { temperature, maxTokens, timeoutMs });
}

// ── Gemini implementation ──────────────────────────────────────────────────

async function callGemini(systemPrompt, userContent, { temperature, maxTokens, timeoutMs }) {
  const apiKey = await getSetting('google_ai_api_key', 'GOOGLE_AI_API_KEY');
  if (!apiKey) throw Object.assign(new Error('Chave da API Google AI não configurada.'), { statusCode: 503 });

  const res = await fetch(
    `${GOOGLE_AI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── OpenAI implementation ──────────────────────────────────────────────────

async function callOpenAI(systemPrompt, userContent, { temperature, maxTokens, timeoutMs }) {
  const apiKey = await getSetting('openai_api_key', 'OPENAI_API_KEY');
  if (!apiKey) throw Object.assign(new Error('Chave da API OpenAI não configurada.'), { statusCode: 503 });
  const model = await getSetting('openai_model', 'OPENAI_MODEL') || 'gpt-4o-mini';

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};
  console.log(`[aiProvider/OpenAI] tokens: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}`);

  if (data.choices?.[0]?.finish_reason === 'length') {
    console.warn('[aiProvider/OpenAI] AVISO: resposta cortada (finish_reason=length)');
  }

  return rawContent;
}
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/aiProvider.js
git commit -m "feat(ai): add unified aiProvider.js with Gemini/OpenAI routing per service"
```

---

### Task 2: Add `ai_provider_map` to settings whitelist

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js:767`

**Step 1: Add to whitelist**

In `saas.js` line 767, add `'ai_provider_map'` to the `SETTINGS_WHITELIST` array:

```javascript
// Before:
const SETTINGS_WHITELIST = ['openai_api_key', 'openai_model', 'credit_brl_price', 'google_ai_api_key']

// After:
const SETTINGS_WHITELIST = ['openai_api_key', 'openai_model', 'credit_brl_price', 'google_ai_api_key', 'ai_provider_map']
```

**Step 2: Invalidate cache on save**

In the `PUT /saas/settings` handler (line 807), add cache invalidation after upserting `ai_provider_map`:

```javascript
// After the upsert block (line 823), add:
import { invalidateSetting } from '../services/systemSettings.js';
// ... inside the for loop, after the upsert:
invalidateSetting(key);
```

Note: `invalidateSetting` is already exported from `systemSettings.js`. The import should be at the top of the file. The `invalidateSetting(key)` call goes inside the for-loop after each upsert/delete, so that saved settings take effect immediately.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(ai): add ai_provider_map to settings whitelist with cache invalidation"
```

---

### Task 3: Migrate `purchaseImportService.js` — NFE_IMPORT_MATCH

**Files:**
- Modify: `delivery-saas-backend/src/services/purchaseImportService.js:86-184`

**Step 1: Replace direct Gemini call with `callTextAI`**

Replace the `matchItemsWithAI` function body. Remove the direct `fetch` to Gemini API (lines 135-153) and use `callTextAI` instead:

```javascript
// Add import at top of file:
import { callTextAI } from './aiProvider.js';

// Remove these constants (no longer needed here):
// const GOOGLE_AI_BASE = '...'
// const GEMINI_MODEL = '...'
// Remove getGoogleAIKey function (only if not used elsewhere in the file)

// In matchItemsWithAI, replace lines 135-156 with:
const content = await callTextAI(
  'NFE_IMPORT_MATCH',
  systemPrompt,
  JSON.stringify({ nfeItems: nfeItemsJson, catalog: catalogJson }),
  { temperature: 0.1 },
);
```

Keep the existing JSON parsing logic (lines 158-167) and the debitCredits + return (lines 169-184) unchanged — just feed them `content` instead of extracting from the Gemini response.

**Important**: The `getGoogleAIKey` function is also used by `parseReceiptPhoto` (image service, stays on Gemini). Keep it if `parseReceiptPhoto` exists in this file; only remove constants/functions that become truly unused.

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/purchaseImportService.js
git commit -m "feat(ai): migrate NFE_IMPORT_MATCH to unified aiProvider"
```

---

### Task 4: Migrate `menuImport.js` — MENU_IMPORT_*

**Files:**
- Modify: `delivery-saas-backend/src/routes/menuImport.js:28-96`

**Step 1: Replace local `callOpenAI` with `callTextAI`**

```javascript
// Add import at top:
import { callTextAI } from '../services/aiProvider.js';

// Remove local constants: OPENAI_URL, OPENAI_MODEL (lines 28-29)
// Remove entire local callOpenAI function (lines 50-89)
// Remove extractJSON function (lines 91-96) — move to a shared helper or keep inline
```

Each place that calls `callOpenAI(messages)` now calls `callTextAI(serviceKey, systemPrompt, userContent)`. The service key varies by invocation context:
- Link import: `'MENU_IMPORT_LINK'`
- Photo import: `'MENU_IMPORT_PHOTO'`
- Spreadsheet import: `'MENU_IMPORT_PLANILHA'`

The response is raw text (string), so wrap with the same `extractJSON` logic:

```javascript
function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  throw new Error('IA não retornou JSON válido. Tente novamente.');
}
```

Keep `extractJSON` as a local function (it's simple enough to keep per-file).

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/menuImport.js
git commit -m "feat(ai): migrate menuImport to unified aiProvider"
```

---

### Task 5: Migrate `ingredientImport.js` — INGREDIENT_IMPORT_*

**Files:**
- Modify: `delivery-saas-backend/src/routes/stock/ingredientImport.js:21-75`

**Step 1: Same pattern as menuImport**

```javascript
// Add import at top:
import { callTextAI } from '../../services/aiProvider.js';

// Remove: OPENAI_URL, OPENAI_MODEL constants (lines 21-22)
// Remove: local callOpenAI function (lines 30-68)
// Keep: extractJSON (local)

// Replace all callOpenAI(messages) calls with:
// const rawText = await callTextAI('INGREDIENT_IMPORT_PARSE', systemPrompt, userContent);
// const result = extractJSON(rawText);
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/stock/ingredientImport.js
git commit -m "feat(ai): migrate ingredientImport to unified aiProvider"
```

---

### Task 6: Migrate `technicalSheetImport.js` — TECHNICAL_SHEET_IMPORT_*

**Files:**
- Modify: `delivery-saas-backend/src/routes/stock/technicalSheetImport.js:21-77`

**Step 1: Same pattern as ingredientImport**

```javascript
// Add import:
import { callTextAI } from '../../services/aiProvider.js';

// Remove: OPENAI_URL, OPENAI_MODEL, local callOpenAI
// Keep: extractJSON (local)
// Replace callOpenAI calls with callTextAI('TECHNICAL_SHEET_IMPORT_PARSE', ...)
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/stock/technicalSheetImport.js
git commit -m "feat(ai): migrate technicalSheetImport to unified aiProvider"
```

---

### Task 7: Migrate `aiParser.js` — POS_PARSER

**Files:**
- Modify: `delivery-saas-backend/src/aiParser.js:1-133`

**Step 1: Replace direct OpenAI call with `callTextAI`**

```javascript
// Replace the dynamic import + fetch logic with:
import { callTextAI } from './services/aiProvider.js';

async function parseSaiposWithAI(content, filename = 'unknown') {
  const user = `Filename: ${filename}\n---BEGIN CONTENT---\n${String(content).slice(0, 20000)}\n---END CONTENT---\n\nPlease parse the content and return the JSON object described in the system prompt.`;

  const rawText = await callTextAI('POS_PARSER', system, user, { temperature: 0, maxTokens: 1500 });

  // Parse JSON from response (existing logic)
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    const m = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) { /* leave null */ } }
  }
  return { parsed, text: rawText };
}
```

Keep the `system` prompt string as-is (the large system prompt at lines 26-82).

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/aiParser.js
git commit -m "feat(ai): migrate aiParser (POS_PARSER) to unified aiProvider"
```

---

### Task 8: Migrate `aiStudio.js` — GENERATE_DESCRIPTION

**Files:**
- Modify: `delivery-saas-backend/src/routes/aiStudio.js:497-604`

**Step 1: Replace Gemini call for description with `callTextAI`**

The `generate-description` endpoint sends an image + text prompt to Gemini Vision. Since `callTextAI` is text-only, we handle this differently:

For `GENERATE_DESCRIPTION`, the prompt describes the product and asks for a description. When using OpenAI, we send the image URL in the message content array. When using Gemini, we send inline base64.

**Approach**: Add a `callVisionAI` function to `aiProvider.js` that handles image+text for both providers, OR keep the existing Gemini Vision code for this endpoint but swap to OpenAI when configured.

Simpler approach: Since the product image is already loaded as base64, add an optional `imageBase64` + `mimeType` param to `callTextAI`:

In `aiProvider.js`, add a new export:

```javascript
/**
 * Call AI with image + text input (for services that analyze images but return text).
 * Routes to Gemini Vision or OpenAI GPT-4o Vision based on provider config.
 */
export async function callVisionAI(serviceKey, textPrompt, imageBase64, mimeType, options = {}) {
  const provider = await getProviderForService(serviceKey);
  const { temperature = 0.2, maxTokens = 400, timeoutMs = 30_000 } = options;

  if (provider === 'gemini') {
    return callGeminiVision(textPrompt, imageBase64, mimeType, { temperature, maxTokens, timeoutMs });
  }
  return callOpenAIVision(textPrompt, imageBase64, mimeType, { temperature, maxTokens, timeoutMs });
}

async function callGeminiVision(textPrompt, imageBase64, mimeType, { temperature, maxTokens, timeoutMs }) {
  const apiKey = await getSetting('google_ai_api_key', 'GOOGLE_AI_API_KEY');
  if (!apiKey) throw Object.assign(new Error('Chave da API Google AI não configurada.'), { statusCode: 503 });

  const res = await fetch(
    `${GOOGLE_AI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: textPrompt },
          ],
        }],
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini Vision error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.find(p => p.text)?.text?.trim() || '';
}

async function callOpenAIVision(textPrompt, imageBase64, mimeType, { temperature, maxTokens, timeoutMs }) {
  const apiKey = await getSetting('openai_api_key', 'OPENAI_API_KEY');
  if (!apiKey) throw Object.assign(new Error('Chave da API OpenAI não configurada.'), { statusCode: 503 });
  const model = await getSetting('openai_model', 'OPENAI_MODEL') || 'gpt-4o-mini';

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: 'text', text: textPrompt },
        ],
      }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI Vision error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}
```

Then in `aiStudio.js` line 545, replace the direct Gemini Vision fetch with:

```javascript
import { callVisionAI } from '../services/aiProvider.js';

// Replace lines 545-591 with:
const description = await callVisionAI(
  'GENERATE_DESCRIPTION',
  textPrompt,     // the existing text prompt string (lines 556-573)
  imageBase64,
  mimeType,
);
if (!description) throw new Error('Modelo não retornou descrição');
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/aiProvider.js delivery-saas-backend/src/routes/aiStudio.js
git commit -m "feat(ai): migrate generate-description to unified aiProvider with Vision support"
```

---

### Task 9: Add AI provider table to `SaasSettings.vue`

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasSettings.vue`

**Step 1: Add reactive state and service definitions**

In the `<script setup>` section, add after the existing `SERVICE_DEFS` (around line 28):

```javascript
// Provider per service configuration
const AI_PROVIDER_SERVICES = [
  { key: 'NFE_IMPORT_MATCH',             label: 'NFe Matching (ingredientes)',          icon: 'bi-receipt',        default: 'gemini'  },
  { key: 'MENU_IMPORT_LINK',             label: 'Importar cardápio via link',           icon: 'bi-link-45deg',     default: 'openai'  },
  { key: 'MENU_IMPORT_PHOTO',            label: 'Importar cardápio via foto',           icon: 'bi-camera',         default: 'openai'  },
  { key: 'MENU_IMPORT_PLANILHA',         label: 'Importar cardápio via planilha',       icon: 'bi-table',          default: 'openai'  },
  { key: 'MENU_IMPORT_ITEM',             label: 'Por item importado (cardápio)',        icon: 'bi-list-check',     default: 'openai'  },
  { key: 'INGREDIENT_IMPORT_PARSE',      label: 'Import ingredientes (parse)',          icon: 'bi-box-seam',       default: 'openai'  },
  { key: 'INGREDIENT_IMPORT_ITEM',       label: 'Por item importado (ingrediente)',     icon: 'bi-box-seam',       default: 'openai'  },
  { key: 'TECHNICAL_SHEET_IMPORT_PARSE', label: 'Import fichas técnicas (parse)',       icon: 'bi-journal-text',   default: 'openai'  },
  { key: 'TECHNICAL_SHEET_IMPORT_ITEM',  label: 'Por item importado (ficha técnica)',   icon: 'bi-journal-text',   default: 'openai'  },
  { key: 'GENERATE_DESCRIPTION',         label: 'Gerar descrição de produto',           icon: 'bi-pencil-square',  default: 'gemini'  },
  { key: 'POS_PARSER',                   label: 'Parser de POS (Saipos)',               icon: 'bi-printer',        default: 'openai'  },
]

const providerMap = ref({})
const savingProviders = ref(false)
const savedProviders = ref(false)
const errorProviders = ref(null)
```

**Step 2: Load provider map from settings**

Add to the `load()` function, after loading other settings:

```javascript
// Inside load(), after the existing logic:
const providerRow = data.find(r => r.key === 'ai_provider_map')
if (providerRow && providerRow.isSet && providerRow.value) {
  try {
    const map = JSON.parse(providerRow.value)
    providerMap.value = map
  } catch { /* ignore invalid JSON */ }
}
// Fill defaults for any missing keys
for (const svc of AI_PROVIDER_SERVICES) {
  if (!providerMap.value[svc.key]) {
    providerMap.value[svc.key] = svc.default
  }
}
```

**Step 3: Save provider map function**

```javascript
async function saveProviders() {
  savingProviders.value = true
  savedProviders.value = false
  errorProviders.value = null
  try {
    await api.put('/saas/settings', [{ key: 'ai_provider_map', value: JSON.stringify(providerMap.value) }])
    savedProviders.value = true
    setTimeout(() => { savedProviders.value = false }, 3000)
  } catch (e) {
    errorProviders.value = e?.response?.data?.message || 'Erro ao salvar provedores de IA'
  } finally {
    savingProviders.value = false
  }
}
```

**Step 4: Add the UI card between "Google AI Studio" card and "Créditos de IA" card**

Insert after the Google AI Studio card closing `</div>` (after line 323):

```html
<!-- Provedor de IA por serviço -->
<div class="card border-0 shadow-sm mb-4">
  <div class="card-body">
    <h5 class="card-title mb-1">
      <i class="bi bi-shuffle me-2 text-info"></i>Provedor de IA por Serviço
    </h5>
    <p class="text-muted small mb-4">
      Escolha qual provedor de IA (Gemini ou OpenAI) será usado para cada serviço de texto.
      Serviços de imagem (AI Studio) usam sempre Gemini.
    </p>

    <div v-if="errorProviders" class="alert alert-danger py-2 small">{{ errorProviders }}</div>
    <div v-if="savedProviders" class="alert alert-success py-2 small">Provedores salvos com sucesso.</div>

    <div class="table-responsive">
      <table class="table table-sm align-middle mb-3">
        <thead class="table-light">
          <tr>
            <th>Serviço</th>
            <th style="width: 180px;">Provedor</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="svc in AI_PROVIDER_SERVICES" :key="svc.key">
            <td>
              <i class="bi me-2 text-primary" :class="svc.icon"></i>
              {{ svc.label }}
              <code class="ms-2 text-muted" style="font-size: 0.7rem;">{{ svc.key }}</code>
            </td>
            <td>
              <select class="form-select form-select-sm" v-model="providerMap[svc.key]">
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <button class="btn btn-info text-white" @click="saveProviders" :disabled="savingProviders">
      <span v-if="savingProviders" class="spinner-border spinner-border-sm me-2"></span>
      <i v-else class="bi bi-floppy me-2"></i>
      Salvar provedores
    </button>
  </div>
</div>
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasSettings.vue
git commit -m "feat(ai): add AI provider per-service configuration UI in SaaS Settings"
```

---

### Task 10: End-to-end test

**Steps:**
1. Restart backend container: `docker compose restart backend`
2. Open SaaS Settings (`/saas/settings`) as SUPER_ADMIN
3. Verify the "Provedor de IA por Serviço" table appears with dropdowns
4. Change NFE_IMPORT_MATCH from Gemini to OpenAI, save
5. Trigger a purchase import match — verify it calls OpenAI instead of Gemini (check logs)
6. Change back to Gemini, save, verify it calls Gemini
7. Verify image services (AI Studio enhance/generate) still use Gemini regardless of settings