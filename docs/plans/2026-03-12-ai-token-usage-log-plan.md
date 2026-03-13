# AI Token Usage Log & Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real token tracking to AI calls, a usage log page, and a dashboard with margin simulator in the SaaS Admin.

**Architecture:** New `AiTokenUsage` and `AiProviderPricing` Prisma models. Modify `aiProvider.js` to return token counts, modify `aiCreditManager.js` to persist them. New backend routes under `/saas/ai-usage`. New frontend page `SaasAiUsage.vue` with two tabs (Log + Dashboard).

**Tech Stack:** Express.js, Prisma, PostgreSQL, Vue 3 Composition API, Chart.js, Bootstrap 5

---

### Task 1: Prisma Schema — New Models

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add AiTokenUsage model**

Add after the `AiCreditTransaction` model (line ~1035):

```prisma
// Real token usage tracking per AI API call
model AiTokenUsage {
  id           String   @id @default(uuid())
  companyId    String
  company      Company  @relation(fields: [companyId], references: [id])
  userId       String?
  user         User?    @relation(fields: [userId], references: [id])
  serviceKey   String   // ex: "MENU_IMPORT_ITEM"
  provider     String   // "openai" | "gemini"
  model        String   // "gpt-4o-mini", "gemini-2.5-flash"
  inputTokens  Int
  outputTokens Int
  totalTokens  Int
  creditsSpent Int      // credits debited for this operation
  metadata     Json?
  createdAt    DateTime @default(now())

  @@index([companyId, createdAt])
  @@index([createdAt])
  @@index([serviceKey])
}
```

**Step 2: Add AiProviderPricing model**

Add right after `AiTokenUsage`:

```prisma
// Configurable pricing per AI provider/model (USD per million tokens)
model AiProviderPricing {
  id                    String   @id @default(uuid())
  provider              String   // "openai" | "gemini"
  model                 String   // "gpt-4o-mini", "gemini-2.5-flash"
  inputPricePerMillion  Decimal  // USD per 1M input tokens
  outputPricePerMillion Decimal  // USD per 1M output tokens
  isActive              Boolean  @default(true)
  createdAt             DateTime @default(now())

  @@unique([provider, model])
}
```

**Step 3: Add relations to Company and User models**

In the `Company` model (around line 110, after `aiCreditTransactions`), add:
```prisma
  aiTokenUsages        AiTokenUsage[]
```

In the `User` model, add:
```prisma
  aiTokenUsages        AiTokenUsage[]
```

**Step 4: Push schema to database**

Run: `cd delivery-saas-backend && npx prisma db push --skip-generate && npx prisma generate`

Note: Run inside Docker container if using Docker dev environment:
```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```

**Step 5: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add AiTokenUsage and AiProviderPricing models"
```

---

### Task 2: Modify aiProvider.js — Return Token Usage

**Files:**
- Modify: `delivery-saas-backend/src/services/aiProvider.js`

**Step 1: Modify geminiText to return usage data**

Change `geminiText` (line 60-88) to return an object instead of just text:

```js
async function geminiText(systemPrompt, userContent, opts) {
  const { temperature = 0.2, maxTokens, timeoutMs = 60_000 } = opts;
  const apiKey = await getGeminiKey();

  const generationConfig = { temperature };
  if (maxTokens) generationConfig.maxOutputTokens = maxTokens;

  const res = await fetch(
    `${GOOGLE_AI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig,
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};

  return {
    text,
    tokenUsage: {
      provider: 'gemini',
      model: GEMINI_MODEL,
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0,
    },
  };
}
```

**Step 2: Modify geminiVision similarly**

Change `geminiVision` (line 90-125) return to match:

```js
async function geminiVision(systemPrompt, textPrompt, imageBase64, mimeType, opts) {
  const { temperature = 0.2, maxTokens = 400, timeoutMs = 30_000 } = opts;
  const apiKey = await getGeminiKey();

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        { text: textPrompt },
      ],
    }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(
    `${GOOGLE_AI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};

  return {
    text,
    tokenUsage: {
      provider: 'gemini',
      model: GEMINI_MODEL,
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0,
    },
  };
}
```

**Step 3: Modify openaiText similarly**

Change `openaiText` (line 129-175) return:

```js
async function openaiText(systemPrompt, userContent, opts) {
  const { temperature = 0.2, maxTokens, timeoutMs = 60_000 } = opts;
  const apiKey = await getOpenAIKey();
  const model  = await getOpenAIModel();

  const body = {
    model,
    temperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent },
    ],
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  if (choice?.finish_reason === 'length') {
    console.warn('[aiProvider] OpenAI response truncated (finish_reason=length)');
  }

  const usage = data.usage || {};
  return {
    text: choice?.message?.content || '',
    tokenUsage: {
      provider: 'openai',
      model,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
  };
}
```

**Step 4: Modify openaiVision similarly**

Change `openaiVision` (line 177-233) return:

```js
async function openaiVision(systemPrompt, textPrompt, imageBase64, mimeType, opts) {
  const { temperature = 0.2, maxTokens = 400, timeoutMs = 30_000 } = opts;
  const apiKey = await getOpenAIKey();
  const model  = await getOpenAIModel();

  const dataUri = `data:${mimeType};base64,${imageBase64}`;

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: textPrompt },
      { type: 'image_url', image_url: { url: dataUri } },
    ],
  });

  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  };

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  if (choice?.finish_reason === 'length') {
    console.warn('[aiProvider] OpenAI vision response truncated (finish_reason=length)');
  }

  const usage = data.usage || {};
  return {
    text: choice?.message?.content || '',
    tokenUsage: {
      provider: 'openai',
      model,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
  };
}
```

**Step 5: Update public API functions (callTextAI, callVisionAI)**

These now return `{ text, tokenUsage }` instead of plain string. Update the JSDoc:

```js
/**
 * Sends a text prompt to the AI provider configured for the given service.
 * @returns {Promise<{ text: string, tokenUsage: { provider: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number } }>}
 */
export async function callTextAI(serviceKey, systemPrompt, userContent, options = {}) {
  const provider = await getProviderForService(serviceKey);
  return provider === 'gemini'
    ? geminiText(systemPrompt, userContent, options)
    : openaiText(systemPrompt, userContent, options);
}

/**
 * Sends a text + image prompt to the AI provider configured for the given service.
 * @returns {Promise<{ text: string, tokenUsage: { provider: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number } }>}
 */
export async function callVisionAI(serviceKey, systemPrompt, textPrompt, imageBase64, mimeType, options = {}) {
  const provider = await getProviderForService(serviceKey);
  return provider === 'gemini'
    ? geminiVision(systemPrompt, textPrompt, imageBase64, mimeType, options)
    : openaiVision(systemPrompt, textPrompt, imageBase64, mimeType, options);
}
```

**Step 6: Commit**

```bash
git add delivery-saas-backend/src/services/aiProvider.js
git commit -m "feat(aiProvider): return token usage from all AI calls"
```

---

### Task 3: Update All Callers of callTextAI / callVisionAI

Since the return type changed from `string` to `{ text, tokenUsage }`, every caller must be updated.

**Files to search and modify:**

Run: `grep -rn "callTextAI\|callVisionAI" delivery-saas-backend/src/ --include="*.js"`

Each caller currently does something like:
```js
const result = await callTextAI(serviceKey, system, user)
// uses `result` as a string
```

Must become:
```js
const { text: result, tokenUsage } = await callTextAI(serviceKey, system, user)
// `result` is now the string, `tokenUsage` is available for logging
```

**Step 1: Find all callers**

Search the codebase for every import/usage of `callTextAI` and `callVisionAI`.

**Step 2: Update each caller**

For each caller, destructure the return value. The `tokenUsage` object should be passed to `debitCredits` via metadata so it can be persisted (Task 4 will handle the persistence side).

Pattern for each caller:
```js
// Before:
const rawText = await callTextAI('SERVICE_KEY', systemPrompt, userPrompt)
await debitCredits(companyId, 'SERVICE_KEY', quantity, { someMetadata }, userId)

// After:
const { text: rawText, tokenUsage } = await callTextAI('SERVICE_KEY', systemPrompt, userPrompt)
await debitCredits(companyId, 'SERVICE_KEY', quantity, { someMetadata, tokenUsage }, userId)
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/
git commit -m "feat: update all AI callers to capture token usage"
```

---

### Task 4: Modify aiCreditManager.js — Persist Token Usage

**Files:**
- Modify: `delivery-saas-backend/src/services/aiCreditManager.js`

**Step 1: Add logTokenUsage function**

Add at the end of the file, before closing:

```js
/**
 * Persists real token usage from an AI API call.
 * Called after debitCredits when tokenUsage is available in metadata.
 *
 * @param {string} companyId
 * @param {string} serviceKey
 * @param {number} creditsSpent
 * @param {{ provider: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number }} tokenUsage
 * @param {string} [userId]
 * @param {object} [metadata]
 */
export async function logTokenUsage(companyId, serviceKey, creditsSpent, tokenUsage, userId = null, metadata = null) {
  if (!tokenUsage || !tokenUsage.provider) return
  try {
    await prisma.aiTokenUsage.create({
      data: {
        companyId,
        userId,
        serviceKey,
        provider: tokenUsage.provider,
        model: tokenUsage.model || 'unknown',
        inputTokens: tokenUsage.inputTokens || 0,
        outputTokens: tokenUsage.outputTokens || 0,
        totalTokens: tokenUsage.totalTokens || 0,
        creditsSpent,
        metadata,
      },
    })
  } catch (err) {
    // Non-critical — log but don't fail the main operation
    console.error('[aiCreditManager] logTokenUsage error:', err.message)
  }
}
```

**Step 2: Modify debitCredits to auto-log token usage**

Inside `debitCredits`, after the transaction succeeds, check if `metadata.tokenUsage` exists and call `logTokenUsage`:

After the `return { newBalance, spent }` block (around line 215), add before the return:

```js
  // Auto-log token usage if present in metadata
  if (metadata?.tokenUsage) {
    const tu = metadata.tokenUsage
    // Remove tokenUsage from the credit transaction metadata to avoid duplication
    const cleanMeta = { ...metadata }
    delete cleanMeta.tokenUsage
    await logTokenUsage(companyId, serviceKey, totalCost, tu, userId, cleanMeta)
  }

  return {
    newBalance: updatedCompany.aiCreditsBalance,
    spent: totalCost,
  }
```

Do the same for the unlimited credits path (around line 168).

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/services/aiCreditManager.js
git commit -m "feat(aiCreditManager): auto-persist token usage on debit"
```

---

### Task 5: Backend Routes — AI Usage Log & Provider Pricing

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js`

**Step 1: Add GET /saas/ai-usage — Paginated token usage log**

Add at the end of the saas router (before `export`):

```js
// -------- AI Token Usage Log (SUPER_ADMIN) --------
saasRouter.get('/ai-usage', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { page = 1, limit = 25, companyId, serviceKey, provider, dateFrom, dateTo } = req.query
    const where = {}
    if (companyId) where.companyId = companyId
    if (serviceKey) where.serviceKey = serviceKey
    if (provider) where.provider = provider
    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59.999Z')
    }

    const skip = (Number(page) - 1) * Number(limit)
    const [rows, total] = await Promise.all([
      prisma.aiTokenUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
        include: {
          company: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.aiTokenUsage.count({ where }),
    ])

    res.json({ rows, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    console.error('[saas] GET /ai-usage error:', err)
    res.status(500).json({ message: 'Erro ao buscar log de uso de tokens' })
  }
})
```

**Step 2: Add GET /saas/ai-usage/summary — Aggregated dashboard data**

```js
saasRouter.get('/ai-usage/summary', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { months = 6 } = req.query
    const since = new Date()
    since.setMonth(since.getMonth() - Number(months))

    // Monthly aggregation
    const rows = await prisma.aiTokenUsage.findMany({
      where: { createdAt: { gte: since } },
      select: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        creditsSpent: true,
        serviceKey: true,
        provider: true,
        model: true,
        createdAt: true,
      },
    })

    // Load pricing and settings
    const [pricings, settings] = await Promise.all([
      prisma.aiProviderPricing.findMany({ where: { isActive: true } }),
      prisma.systemSetting.findMany({
        where: { key: { in: ['credit_brl_price', 'usd_to_brl'] } },
      }),
    ])

    const creditBrlPrice = parseFloat(settings.find(s => s.key === 'credit_brl_price')?.value || '0')
    const usdToBrl = parseFloat(settings.find(s => s.key === 'usd_to_brl')?.value || '5.80')

    // Build pricing lookup: "provider:model" -> { input, output }
    const pricingMap = {}
    for (const p of pricings) {
      pricingMap[`${p.provider}:${p.model}`] = {
        input: parseFloat(p.inputPricePerMillion),
        output: parseFloat(p.outputPricePerMillion),
      }
    }

    // Aggregate by month
    const monthly = {}
    const byService = {}
    let totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, costBrl: 0, revenueBrl: 0, creditsSpent: 0 }

    for (const row of rows) {
      // Calculate cost
      const key = `${row.provider}:${row.model}`
      const pricing = pricingMap[key] || { input: 0, output: 0 }
      const costUsd = (row.inputTokens / 1_000_000 * pricing.input) + (row.outputTokens / 1_000_000 * pricing.output)
      const costBrl = costUsd * usdToBrl
      const revenueBrl = row.creditsSpent * creditBrlPrice

      // Monthly bucket
      const monthKey = `${row.createdAt.getFullYear()}-${String(row.createdAt.getMonth() + 1).padStart(2, '0')}`
      if (!monthly[monthKey]) monthly[monthKey] = { costBrl: 0, revenueBrl: 0, creditsSpent: 0, totalTokens: 0 }
      monthly[monthKey].costBrl += costBrl
      monthly[monthKey].revenueBrl += revenueBrl
      monthly[monthKey].creditsSpent += row.creditsSpent
      monthly[monthKey].totalTokens += row.totalTokens

      // By service
      if (!byService[row.serviceKey]) byService[row.serviceKey] = { costBrl: 0, revenueBrl: 0, creditsSpent: 0, count: 0 }
      byService[row.serviceKey].costBrl += costBrl
      byService[row.serviceKey].revenueBrl += revenueBrl
      byService[row.serviceKey].creditsSpent += row.creditsSpent
      byService[row.serviceKey].count++

      // Totals
      totals.inputTokens += row.inputTokens
      totals.outputTokens += row.outputTokens
      totals.totalTokens += row.totalTokens
      totals.costUsd += costUsd
      totals.costBrl += costBrl
      totals.revenueBrl += revenueBrl
      totals.creditsSpent += row.creditsSpent
    }

    totals.profitBrl = totals.revenueBrl - totals.costBrl
    totals.marginPct = totals.revenueBrl > 0 ? ((totals.profitBrl / totals.revenueBrl) * 100) : 0

    res.json({ totals, monthly, byService, creditBrlPrice, usdToBrl })
  } catch (err) {
    console.error('[saas] GET /ai-usage/summary error:', err)
    res.status(500).json({ message: 'Erro ao gerar sumário de uso de IA' })
  }
})
```

**Step 3: Add CRUD for AiProviderPricing**

```js
// -------- AI Provider Pricing (SUPER_ADMIN) --------
saasRouter.get('/ai-provider-pricing', requireRole('SUPER_ADMIN'), async (_req, res) => {
  const rows = await prisma.aiProviderPricing.findMany({ orderBy: [{ provider: 'asc' }, { model: 'asc' }] })
  res.json(rows)
})

saasRouter.post('/ai-provider-pricing', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { provider, model, inputPricePerMillion, outputPricePerMillion } = req.body
  if (!provider || !model) return res.status(400).json({ message: 'provider e model são obrigatórios' })
  try {
    const row = await prisma.aiProviderPricing.upsert({
      where: { provider_model: { provider, model } },
      update: { inputPricePerMillion, outputPricePerMillion, isActive: true },
      create: { provider, model, inputPricePerMillion, outputPricePerMillion },
    })
    res.json(row)
  } catch (err) {
    console.error('[saas] POST /ai-provider-pricing error:', err)
    res.status(500).json({ message: 'Erro ao salvar pricing' })
  }
})

saasRouter.put('/ai-provider-pricing/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { inputPricePerMillion, outputPricePerMillion, isActive } = req.body
  try {
    const row = await prisma.aiProviderPricing.update({
      where: { id: req.params.id },
      data: { inputPricePerMillion, outputPricePerMillion, isActive },
    })
    res.json(row)
  } catch (err) {
    console.error('[saas] PUT /ai-provider-pricing error:', err)
    res.status(500).json({ message: 'Erro ao atualizar pricing' })
  }
})

saasRouter.delete('/ai-provider-pricing/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  await prisma.aiProviderPricing.delete({ where: { id: req.params.id } })
  res.json({ ok: true })
})
```

**Step 4: Add usd_to_brl to the settings GET/PUT**

In the existing `GET /saas/settings` handler, make sure `usd_to_brl` is included in the allowed keys list. In the `PUT /saas/settings` handler, add `'usd_to_brl'` to the whitelist of saveable keys.

Search for the settings whitelist in `saas.js` and add `'usd_to_brl'`.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(saas): add AI usage log, summary, and provider pricing routes"
```

---

### Task 6: Add usd_to_brl to SaasSettings.vue

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasSettings.vue`

**Step 1: Add usd_to_brl field to settings ref**

In the `settings` ref (line 5-10), add:
```js
usd_to_brl: '',
```

**Step 2: Load the value on mount**

In the `load()` function (around line 109), after loading `credit_brl_price`, add:
```js
const usdRow = data.find(r => r.key === 'usd_to_brl')
if (usdRow && usdRow.isSet) {
  settings.value.usd_to_brl = usdRow.value
}
```

**Step 3: Save the value**

In the `saveCredits()` function (around line 84-106), add alongside `credit_brl_price`:
```js
await api.put('/saas/settings', [
  { key: 'credit_brl_price', value: String(settings.value.credit_brl_price).replace(',', '.') },
  { key: 'usd_to_brl', value: String(settings.value.usd_to_brl).replace(',', '.') },
])
```

**Step 4: Add the UI field**

In the template, inside the "Créditos de IA" card (after the "Valor por crédito" input around line 448), add:

```html
<!-- Cotação USD→BRL -->
<div class="mb-4 p-3 rounded-3 bg-light border">
  <label class="form-label fw-semibold mb-1">
    <i class="bi bi-currency-exchange me-1"></i>Cotação USD → BRL
  </label>
  <div class="input-group" style="max-width: 240px;">
    <span class="input-group-text">US$ 1 =</span>
    <input
      type="number"
      class="form-control"
      v-model="settings.usd_to_brl"
      min="0"
      step="0.01"
      placeholder="ex: 5.80"
    />
    <span class="input-group-text">BRL</span>
  </div>
  <div class="form-text">
    Taxa de câmbio para calcular custo real dos tokens em reais.
    Atualize manualmente conforme necessário.
  </div>
</div>
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasSettings.vue
git commit -m "feat(settings): add USD to BRL exchange rate field"
```

---

### Task 7: Frontend — SaasAiUsage.vue (Log Tab)

**Files:**
- Create: `delivery-saas-frontend/src/views/SaasAiUsage.vue`
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Create the SaasAiUsage.vue component**

Create file at `delivery-saas-frontend/src/views/SaasAiUsage.vue`.

Use the `frontend-deliverywl` skill for styling guidance.

The component should have:
- Two tabs: "Log" and "Dashboard" (using Bootstrap nav-tabs)
- `activeTab` ref defaulting to `'log'`

**Log tab content:**
- Filter bar: date range (dateFrom, dateTo), company select, service select, provider select
- Table with columns: Data, Empresa, Usuário, Serviço, Provider/Model, Tokens (in/out), Custo (BRL), Créditos, Receita (BRL), Lucro
- Pagination controls
- Summary row at bottom

**Data loading:**
- `api.get('/saas/ai-usage', { params: filters })` for the log
- `api.get('/saas/ai-usage/summary')` for dashboard
- `api.get('/saas/ai-provider-pricing')` for cost calculation
- `api.get('/saas/companies')` for company filter dropdown

**Cost calculation on frontend (for log table):**
```js
function calcCost(row) {
  const pricing = pricingMap.value[`${row.provider}:${row.model}`] || { input: 0, output: 0 }
  const costUsd = (row.inputTokens / 1_000_000 * pricing.input) + (row.outputTokens / 1_000_000 * pricing.output)
  return costUsd * usdToBrl.value
}
function calcRevenue(row) {
  return row.creditsSpent * creditBrlPrice.value
}
```

**Step 2: Add route in router.js**

At the top of router.js, add import:
```js
import SaasAiUsage from './views/SaasAiUsage.vue';
```

In the routes array (after the `/saas/settings` route, around line 241), add:
```js
,{ path: '/saas/ai-usage', component: SaasAiUsage, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
```

**Step 3: Add link in SaasAdmin.vue dashboard**

In `SaasAdmin.vue`, add a quick-action card or link to `/saas/ai-usage`:
```html
<router-link to="/saas/ai-usage" class="btn btn-outline-info">
  <i class="bi bi-graph-up me-2"></i>Uso de IA & Tokens
</router-link>
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasAiUsage.vue delivery-saas-frontend/src/router.js
git commit -m "feat(frontend): add SaasAiUsage page with token usage log"
```

---

### Task 8: Frontend — Dashboard Tab (Charts + Margin Simulator)

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasAiUsage.vue`

**Step 1: Add dashboard data loading**

On mount (or when switching to dashboard tab), call:
```js
const { data: summary } = await api.get('/saas/ai-usage/summary', { params: { months: 6 } })
```

**Step 2: Add summary cards**

4 cards at top of dashboard tab:
- Total Custo (BRL) — `summary.totals.costBrl`
- Total Receita (BRL) — `summary.totals.revenueBrl`
- Margem % — `summary.totals.marginPct`
- Lucro (BRL) — `summary.totals.profitBrl` (green if positive, red if negative)

**Step 3: Add Chart.js charts**

Import and register Chart.js:
```js
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)
```

Three charts using `<canvas>` refs:
1. **Bar chart** — Custo vs Receita by month (using `summary.monthly`)
2. **Line chart** — Profit trend (derived from monthly data)
3. **Doughnut chart** — Cost distribution by service (using `summary.byService`)

Use the pattern from `ProductsReport.vue` — destroy charts on unmount, use color array.

**Step 4: Add margin simulator**

Below the charts:
```html
<div class="card border-0 shadow-sm">
  <div class="card-body">
    <h6><i class="bi bi-sliders me-2"></i>Simulador de Margem</h6>
    <div class="row align-items-end mb-3">
      <div class="col-auto">
        <label class="form-label">Margem desejada (%)</label>
        <input type="number" class="form-control" v-model.number="desiredMargin" min="0" max="500" step="5" />
      </div>
      <div class="col-auto">
        <p class="mb-0">Preço sugerido por crédito: <strong>R$ {{ suggestedPrice }}</strong></p>
      </div>
    </div>
    <!-- Projection table -->
    <table class="table table-sm">
      <thead><tr><th>Serviço</th><th>Créditos</th><th>Custo Médio</th><th>Preço Atual</th><th>Preço Novo</th><th>Lucro Projetado</th></tr></thead>
      <tbody>...</tbody>
    </table>
  </div>
</div>
```

**Simulation logic:**
```js
const desiredMargin = ref(50) // default 50%

const suggestedPrice = computed(() => {
  if (!summary.value?.totals?.costBrl || !summary.value?.totals?.creditsSpent) return '—'
  const avgCostPerCredit = summary.value.totals.costBrl / summary.value.totals.creditsSpent
  const price = avgCostPerCredit / (1 - desiredMargin.value / 100)
  return price.toFixed(4).replace('.', ',')
})
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasAiUsage.vue
git commit -m "feat(frontend): add AI usage dashboard with charts and margin simulator"
```

---

### Task 9: Provider Pricing Management in SaasSettings

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasSettings.vue`

**Step 1: Add provider pricing section**

Add a new card after the "Provedor de IA por Serviço" card. This card shows a table of provider/model pricing:

| Provider | Model | Input (USD/M) | Output (USD/M) | Actions |
|----------|-------|---------------|-----------------|---------|

With "Add Model" button that shows inline form fields.

**Step 2: Add data loading**

```js
const providerPricings = ref([])
const newPricing = ref({ provider: 'openai', model: '', inputPricePerMillion: '', outputPricePerMillion: '' })

async function loadPricings() {
  const { data } = await api.get('/saas/ai-provider-pricing')
  providerPricings.value = data
}

async function savePricing(p) {
  if (p.id) {
    await api.put(`/saas/ai-provider-pricing/${p.id}`, p)
  } else {
    await api.post('/saas/ai-provider-pricing', p)
  }
  await loadPricings()
}

async function deletePricing(id) {
  if (!confirm('Remover este modelo?')) return
  await api.delete(`/saas/ai-provider-pricing/${id}`)
  await loadPricings()
}
```

**Step 3: Load on mount**

Add `await loadPricings()` to the `onMounted` block.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasSettings.vue
git commit -m "feat(settings): add AI provider pricing management UI"
```

---

### Task 10: Seed Default Provider Pricing

**Files:**
- Modify: `delivery-saas-backend/prisma/seed.js` (or create inline script)

**Step 1: Add seed data for common models**

Create a small script or add to existing seed to upsert default pricing:

```js
const defaults = [
  { provider: 'openai', model: 'gpt-4o-mini', inputPricePerMillion: 0.15, outputPricePerMillion: 0.60 },
  { provider: 'openai', model: 'gpt-4o', inputPricePerMillion: 2.50, outputPricePerMillion: 10.00 },
  { provider: 'gemini', model: 'gemini-2.5-flash', inputPricePerMillion: 0.15, outputPricePerMillion: 0.60 },
]

for (const d of defaults) {
  await prisma.aiProviderPricing.upsert({
    where: { provider_model: { provider: d.provider, model: d.model } },
    update: {},
    create: d,
  })
}
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/prisma/seed.js
git commit -m "feat(seed): add default AI provider pricing"
```

---

### Task 11: Final Integration Test

**Step 1: Start the dev environment**

```bash
docker compose up -d
```

**Step 2: Verify schema push**

```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```

**Step 3: Run the seed**

```bash
docker compose exec backend npx prisma db seed
```

**Step 4: Manual test checklist**

1. Open SaaS Settings → verify USD→BRL field appears and saves
2. Open SaaS Settings → verify Provider Pricing table loads with defaults, can edit/add/delete
3. Trigger an AI operation (e.g., import a menu item with AI) → check `AiTokenUsage` table has a new row with real token counts
4. Open `/saas/ai-usage` → Log tab shows the usage record with calculated cost/revenue/profit
5. Switch to Dashboard tab → charts render with data, summary cards show correct values
6. Adjust margin slider → suggested price updates, projection table recalculates

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete AI token usage tracking, log, dashboard, and margin simulator"
```
