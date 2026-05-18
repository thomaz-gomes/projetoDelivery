# AI Image Feedback & Brand Theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que o gerador de fotos de IA aprenda com feedback do operador (👍/👎 categorizado) e respeite um tema visual configurado por loja, tornando as imagens mais consistentes com a marca e menos repetitivas ao longo do tempo.

**Architecture:** 2 novos modelos (`BrandVisualTheme`, `MediaFeedback`) + 1 enum + campos novos em `Media` e `Company`. Endpoints CRUD de temas, endpoints de feedback por Media, endpoint manual de refresh de lições aprendidas via Gemini Flash. O endpoint `generate-pack` injeta tema + lições nos prompts e salva snapshot fiscal-grade do que foi gerado. Frontend ganha UI de cadastro de tema, dropdown de seleção no Studio IA, botões de feedback nas thumbnails e card de lições.

**Tech Stack:** Express + Prisma 6 + PostgreSQL (Docker), Vue 3 + Pinia, Gemini Vision + Flash + Nano Banana (REST), Node `--test` runner.

**Design doc:** `docs/plans/2026-05-18-ai-image-feedback-design.md`

**Branch:** `feat/ai-image-feedback` (já criada a partir de `feat/combo-products`).

**Working dir:** `d:/Users/gomes/Documents/GitHub/projetoDelivery-crud`.

---

## Fase A — Schema + Tema visual (CRUD)

### Task A1: Migration Prisma

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Adicionar enum + 2 modelos + campos**

Adicionar no final do arquivo (perto de Media/Company):

```prisma
enum MediaFeedbackReason {
  LIKED
  FOOD_DEFORMED
  SCENE_REPETITIVE
  OFF_BRAND
  WRONG_COLOR
  OTHER
}

model BrandVisualTheme {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  storeId   String?
  store     Store?   @relation(fields: [storeId], references: [id])
  name      String
  palette   String?
  mood      String?
  props     String?
  surface   String?
  lighting  String?
  isDefault Boolean  @default(false)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  medias    Media[]

  @@index([companyId])
  @@index([storeId])
}

model MediaFeedback {
  id        String              @id @default(uuid())
  mediaId   String
  media     Media               @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  userId    String?
  reason    MediaFeedbackReason
  note      String?
  createdAt DateTime            @default(now())

  @@index([mediaId])
  @@unique([mediaId, userId, reason], name: "uniq_media_user_reason")
}
```

Em `model Media` adicionar:

```prisma
  aiPromptSnapshot Json?
  aiThemeId        String?
  aiTheme          BrandVisualTheme? @relation(fields: [aiThemeId], references: [id])
  feedbacks        MediaFeedback[]
```

Em `model Company` adicionar:

```prisma
  aiLessonsCache Json?
  brandThemes    BrandVisualTheme[]
```

Em `model Store` adicionar:

```prisma
  brandThemes BrandVisualTheme[]
```

**Step 2: Aplicar migration (dev Docker)**

```bash
docker compose -p projetodelivery exec backend ./node_modules/.bin/prisma db push --skip-generate
docker compose -p projetodelivery exec backend ./node_modules/.bin/prisma generate
```
Expected: "Your database is now in sync with your Prisma schema."

**Step 3: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(schema): brand themes + media feedback + AI lessons cache"
```

---

### Task A2: Helper de resolução de tema (TDD)

**Files:**
- Create: `delivery-saas-backend/tests/brandTheme.test.mjs`
- Create: `delivery-saas-backend/src/utils/brandTheme.js`

**Step 1: Teste failing**

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme, buildThemeBlock, buildLessonsBlock } from '../src/utils/brandTheme.js'

test('resolveTheme: themeId explícito tem prioridade', () => {
  const themes = [
    { id: 't1', isDefault: true, storeId: null },
    { id: 't2', isDefault: false, storeId: 's1' },
    { id: 't3', isDefault: false, storeId: null },
  ]
  assert.equal(resolveTheme(themes, 't3', 's1')?.id, 't3')
})

test('resolveTheme: usa tema da loja quando não há themeId', () => {
  const themes = [
    { id: 't1', isDefault: true, storeId: null },
    { id: 't2', isDefault: false, storeId: 's1' },
  ]
  assert.equal(resolveTheme(themes, null, 's1')?.id, 't2')
})

test('resolveTheme: usa default da empresa quando loja sem tema', () => {
  const themes = [{ id: 't1', isDefault: true, storeId: null }]
  assert.equal(resolveTheme(themes, null, 'sX')?.id, 't1')
})

test('resolveTheme: null quando sem temas', () => {
  assert.equal(resolveTheme([], null, 's1'), null)
})

test('buildThemeBlock: omite linhas vazias', () => {
  const out = buildThemeBlock({ palette: 'warm tones', mood: '', props: 'kraft paper', surface: null, lighting: undefined })
  assert.ok(out.includes('Palette: warm tones'))
  assert.ok(out.includes('Props to consider: kraft paper'))
  assert.ok(!out.includes('Mood:'))
  assert.ok(!out.includes('Surface:'))
})

test('buildThemeBlock: retorna string vazia quando tudo vazio', () => {
  assert.equal(buildThemeBlock(null), '')
  assert.equal(buildThemeBlock({}), '')
})

test('buildLessonsBlock: retorna bloco quando tem texto', () => {
  const out = buildLessonsBlock('Avoid dark wood.\nPrefer marble.')
  assert.ok(out.includes('LESSONS LEARNED'))
  assert.ok(out.includes('Avoid dark wood'))
})

test('buildLessonsBlock: string vazia retorna vazia', () => {
  assert.equal(buildLessonsBlock(''), '')
  assert.equal(buildLessonsBlock(null), '')
})
```

**Step 2: Rodar — deve falhar**

```bash
docker compose -p projetodelivery exec backend node --test tests/brandTheme.test.mjs
```
Expected: ERR_MODULE_NOT_FOUND.

**Step 3: Implementar**

`delivery-saas-backend/src/utils/brandTheme.js`:

```javascript
export function resolveTheme(themes, themeId, storeId) {
  if (!Array.isArray(themes) || themes.length === 0) return null
  if (themeId) {
    const t = themes.find(x => x.id === themeId)
    if (t) return t
  }
  if (storeId) {
    const t = themes.find(x => x.storeId === storeId && x.isActive !== false)
    if (t) return t
  }
  const def = themes.find(x => x.isDefault === true && x.storeId === null && x.isActive !== false)
  return def || null
}

export function buildThemeBlock(theme) {
  if (!theme) return ''
  const lines = []
  if (theme.palette) lines.push(`- Palette: ${theme.palette}`)
  if (theme.mood) lines.push(`- Mood: ${theme.mood}`)
  if (theme.surface) lines.push(`- Surface: ${theme.surface}`)
  if (theme.lighting) lines.push(`- Lighting: ${theme.lighting}`)
  if (theme.props) lines.push(`- Props to consider: ${theme.props}`)
  if (lines.length === 0) return ''
  return [
    'BRAND THEME (apply consistently across all scenes):',
    ...lines,
  ].join('\n')
}

export function buildLessonsBlock(text) {
  if (!text || !String(text).trim()) return ''
  return [
    'LESSONS LEARNED FROM PAST FEEDBACK (apply when relevant):',
    String(text).trim(),
  ].join('\n')
}
```

**Step 4: Rodar — deve passar**

```bash
docker compose -p projetodelivery exec backend node --test tests/brandTheme.test.mjs
```
Expected: `pass 8`.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/utils/brandTheme.js delivery-saas-backend/tests/brandTheme.test.mjs
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ai-image): brand theme resolver + prompt block builders"
```

---

### Task A3: Routes CRUD de BrandVisualTheme

**Files:**
- Create: `delivery-saas-backend/src/routes/brandThemes.js`
- Modify: `delivery-saas-backend/src/index.js` (mount no app)

**Step 1: Criar `routes/brandThemes.js`**

```javascript
import express from 'express'
import { prisma } from '../prisma.js'
import { requireAuth } from '../middleware/auth.js'  // ajustar import conforme padrão atual
import { requireRole } from '../middleware/roles.js' // idem

const router = express.Router()
router.use(requireAuth)

const ALLOWED_FIELDS = ['name', 'palette', 'mood', 'props', 'surface', 'lighting', 'isDefault', 'isActive', 'storeId']

function pickAllowed(body) {
  const out = {}
  for (const k of ALLOWED_FIELDS) {
    if (body[k] !== undefined) out[k] = body[k]
  }
  return out
}

function hasAnyVisualField(data) {
  return ['palette', 'mood', 'props', 'surface', 'lighting'].some(k => data[k] && String(data[k]).trim())
}

async function ensureSingleDefault(tx, companyId, themeId) {
  // desativa isDefault dos outros temas company-wide (storeId null)
  await tx.brandVisualTheme.updateMany({
    where: { companyId, storeId: null, isDefault: true, NOT: { id: themeId } },
    data: { isDefault: false },
  })
}

router.get('/', async (req, res) => {
  const companyId = req.user.companyId
  const rows = await prisma.brandVisualTheme.findMany({
    where: { companyId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    include: { store: { select: { id: true, name: true } } },
  })
  res.json(rows)
})

router.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const data = pickAllowed(req.body || {})
  if (!data.name || !String(data.name).trim()) {
    return res.status(400).json({ message: 'Nome é obrigatório' })
  }
  if (!hasAnyVisualField(data)) {
    return res.status(400).json({ message: 'Preencha pelo menos um campo visual (paleta, mood, props, superfície ou iluminação)' })
  }
  if (data.storeId) {
    const store = await prisma.store.findFirst({ where: { id: data.storeId, companyId } })
    if (!store) return res.status(400).json({ message: 'Loja inválida' })
  }
  try {
    const created = await prisma.$transaction(async (tx) => {
      const t = await tx.brandVisualTheme.create({ data: { ...data, companyId } })
      if (data.isDefault === true && !data.storeId) {
        await ensureSingleDefault(tx, companyId, t.id)
      }
      return t
    })
    res.status(201).json(created)
  } catch (e) {
    res.status(500).json({ message: e?.message || 'Falha ao criar tema' })
  }
})

router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const existing = await prisma.brandVisualTheme.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Tema não encontrado' })
  const data = pickAllowed(req.body || {})
  if (data.storeId) {
    const store = await prisma.store.findFirst({ where: { id: data.storeId, companyId } })
    if (!store) return res.status(400).json({ message: 'Loja inválida' })
  }
  const merged = { ...existing, ...data }
  if (!hasAnyVisualField(merged)) {
    return res.status(400).json({ message: 'Preencha pelo menos um campo visual' })
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.brandVisualTheme.update({ where: { id }, data })
      if (data.isDefault === true && !u.storeId) {
        await ensureSingleDefault(tx, companyId, id)
      }
      return u
    })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: e?.message || 'Falha ao atualizar tema' })
  }
})

router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const existing = await prisma.brandVisualTheme.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Tema não encontrado' })
  await prisma.brandVisualTheme.delete({ where: { id } })
  res.status(204).end()
})

export default router
```

(Os caminhos de `requireAuth` / `requireRole` devem casar com o que existe em outras rotas — copie o padrão de `routes/aiStudio.js`.)

**Step 2: Montar em `index.js`**

Adicionar import perto dos outros (linha ~79):
```javascript
import brandThemesRouter from './routes/brandThemes.js'
```

E `app.use` perto dos outros (linha ~303):
```javascript
app.use('/brand-themes', brandThemesRouter)
```

**Step 3: Smoke test manual**

Com backend rodando:
```bash
TOKEN=<seu jwt admin>
curl -X POST http://localhost:3000/brand-themes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Rústico","palette":"tons quentes","mood":"aconchegante","isDefault":true}'
curl -X GET http://localhost:3000/brand-themes -H "Authorization: Bearer $TOKEN"
```
Expected: 201 + lista com 1 item.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/brandThemes.js delivery-saas-backend/src/index.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ai-image): CRUD endpoints for brand visual themes"
```

---

## Fase B — Feedback de Media

### Task B1: Endpoints de feedback (em `media.js`)

**Files:**
- Modify: `delivery-saas-backend/src/routes/media.js`

**Step 1: Adicionar 3 endpoints**

No fim do arquivo (antes do `export default router`):

```javascript
const VALID_REASONS = ['LIKED', 'FOOD_DEFORMED', 'SCENE_REPETITIVE', 'OFF_BRAND', 'WRONG_COLOR', 'OTHER']

router.post('/:id/feedback', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const userId = req.user.id
  const { id } = req.params
  const { reason, note } = req.body || {}

  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ message: 'Razão inválida' })
  }
  if (reason === 'OTHER' && (!note || !String(note).trim())) {
    return res.status(400).json({ message: 'Observação é obrigatória quando o motivo é "Outro"' })
  }

  const media = await prisma.media.findFirst({ where: { id, companyId } })
  if (!media) return res.status(404).json({ message: 'Imagem não encontrada' })

  try {
    const created = await prisma.mediaFeedback.create({
      data: { mediaId: id, userId, reason, note: note ? String(note).slice(0, 500) : null },
    })
    res.status(201).json(created)
  } catch (e) {
    // unique constraint: usuário tentou dar a mesma reason 2x
    if (e?.code === 'P2002') {
      return res.status(409).json({ message: 'Você já marcou este motivo nesta imagem' })
    }
    res.status(500).json({ message: e?.message || 'Falha ao salvar feedback' })
  }
})

router.delete('/:id/feedback/:feedbackId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const userId = req.user.id
  const { id, feedbackId } = req.params
  const fb = await prisma.mediaFeedback.findFirst({
    where: { id: feedbackId, mediaId: id, userId, media: { companyId } },
  })
  if (!fb) return res.status(404).json({ message: 'Feedback não encontrado' })
  await prisma.mediaFeedback.delete({ where: { id: feedbackId } })
  res.status(204).end()
})

router.get('/:id/feedbacks', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const media = await prisma.media.findFirst({ where: { id, companyId } })
  if (!media) return res.status(404).json({ message: 'Imagem não encontrada' })
  const rows = await prisma.mediaFeedback.findMany({
    where: { mediaId: id },
    orderBy: { createdAt: 'desc' },
  })
  res.json(rows)
})
```

**Step 2: Smoke test manual**

```bash
# pegue um media.id da galeria
MEDIA=<id>
curl -X POST http://localhost:3000/media/$MEDIA/feedback \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"LIKED"}'
curl -X GET http://localhost:3000/media/$MEDIA/feedbacks -H "Authorization: Bearer $TOKEN"
```
Expected: 201, depois lista com 1 entrada.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/media.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ai-image): media feedback endpoints (POST/DELETE/GET)"
```

---

## Fase C — Pipeline modificado + lições aprendidas

### Task C1: Endpoint `POST /ai-studio/lessons/refresh`

**Files:**
- Modify: `delivery-saas-backend/src/routes/aiStudio.js`

**Step 1: Adicionar endpoint antes do `export default router`**

```javascript
router.post('/lessons/refresh', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId

  // Coleta feedbacks recentes (últimos 90 dias)
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const feedbacks = await prisma.mediaFeedback.findMany({
    where: { media: { companyId }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { media: { select: { aiPromptSnapshot: true } } },
  })

  if (feedbacks.length === 0) {
    return res.status(400).json({ message: 'Sem feedback nos últimos 90 dias. Dê feedback nas imagens primeiro.' })
  }

  // Agrupa por reason
  const groups = {}
  for (const f of feedbacks) {
    const key = f.reason
    if (!groups[key]) groups[key] = []
    const scene = f.media?.aiPromptSnapshot?.scene || '(sem contexto)'
    groups[key].push({ scene, note: f.note || '' })
  }

  const sections = Object.entries(groups).map(([reason, items]) => {
    const lines = items.slice(0, 10).map(it => `- "${it.scene.slice(0, 120)}"${it.note ? ` — note: "${it.note.slice(0, 120)}"` : ''}`)
    return `${reason} (count: ${items.length}):\n${lines.join('\n')}`
  }).join('\n\n')

  const prompt =
    `You are auditing AI-generated food photos for a Brazilian restaurant.\n` +
    `Below are pieces of feedback from operators about images.\n\n` +
    `FEEDBACK (last 90 days):\n${sections}\n\n` +
    `TASK: Summarize the patterns into actionable lessons for the next image generation.\n` +
    `Max 5 bullet points, each under 25 words. Mix avoid (based on negative reasons) and prefer (based on LIKED).\n` +
    `Be specific. No platitudes. Output plain text, one lesson per line, no markdown.`

  try {
    const apiKey = await getGoogleAIKey()
    const r = await fetch(
      `${GOOGLE_AI_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
          thinkingConfig: { thinkingBudget: 0 },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    )
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      throw new Error(`Gemini Flash error ${r.status}: ${errText.slice(0, 200)}`)
    }
    const data = await r.json()
    const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim()
    if (!text) throw new Error('Resumo vazio da IA')

    const cache = {
      text,
      updatedAt: new Date().toISOString(),
      feedbacksConsidered: feedbacks.length,
    }
    await prisma.company.update({ where: { id: companyId }, data: { aiLessonsCache: cache } })
    res.json(cache)
  } catch (e) {
    console.error('[AI Studio] lessons/refresh failed:', e?.message || e)
    res.status(500).json({ message: e?.message || 'Falha ao atualizar lições' })
  }
})

router.get('/lessons', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { aiLessonsCache: true } })
  res.json(c?.aiLessonsCache || null)
})
```

(`getGoogleAIKey`, `GOOGLE_AI_BASE`, `GEMINI_TEXT_MODEL` já existem no arquivo — reusar.)

**Step 2: Smoke test (depois de ter feedback no banco)**

```bash
curl -X POST http://localhost:3000/ai-studio/lessons/refresh \
  -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/ai-studio/lessons -H "Authorization: Bearer $TOKEN"
```
Expected: JSON com `text`, `updatedAt`, `feedbacksConsidered`.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/aiStudio.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ai-image): manual lessons refresh endpoint via Gemini Flash"
```

---

### Task C2: Injetar tema + lições em `generate-pack`

**Files:**
- Modify: `delivery-saas-backend/src/routes/aiStudio.js`

**Step 1: Importar helpers**

No topo do arquivo:
```javascript
import { resolveTheme, buildThemeBlock, buildLessonsBlock } from '../utils/brandTheme.js'
```

**Step 2: Modificar handler `generate-pack`**

Localizar o handler (linha ~603). Após `const { photoBase64, quantity = 3, aspectRatio = '1:1' } = req.body || {}` adicionar:
```javascript
const { themeId = null, storeId = null } = req.body || {}
```

Antes da etapa 2 (geração de cenários, ~linha 712), adicionar:
```javascript
// Carrega tema (se houver) e lições aprendidas
const [themes, company] = await Promise.all([
  prisma.brandVisualTheme.findMany({ where: { companyId, isActive: true } }),
  prisma.company.findUnique({ where: { id: companyId }, select: { aiLessonsCache: true } }),
])
const theme = resolveTheme(themes, themeId, storeId)
const lessonsText = company?.aiLessonsCache?.text || ''
const themeBlock = buildThemeBlock(theme)
const lessonsBlock = buildLessonsBlock(lessonsText)
```

No prompt do Gemini Flash (cenários), inserir os blocos antes das RULES:
```javascript
text:
  `You are a creative director ...\n\n` +
  `CONTEXT:\n- Product: ${productName}\n- Cuisine type: ${cuisineType}\n- Product details: ${productDescription.slice(0, 300)}\n\n` +
  (themeBlock ? themeBlock + '\n\n' : '') +
  (lessonsBlock ? lessonsBlock + '\n\n' : '') +
  `Generate exactly ${qty} different scene/setting descriptions for professional food photography of this product.\n\n` +
  `RULES:\n` +
  // ... resto do prompt como já está
```

No prompt do Imagen (etapa 3, ~linha 787), inserir bloco de estilo:
```javascript
const brandStyleBlock = theme
  ? `\nBRAND STYLE (apply to background, surface, lighting, props — NOT the food):\n` +
    [theme.palette && `- Palette: ${theme.palette}`,
     theme.mood && `- Mood: ${theme.mood}`,
     theme.lighting && `- Lighting: ${theme.lighting}`,
     theme.surface && `- Surface: ${theme.surface}`,
     theme.props && `- Props: ${theme.props}`].filter(Boolean).join('\n')
  : ''

const imagenPrompt =
  `You are a professional food photographer ...\n` +
  // ... mantém o resto ...
  `SCENE CONCEPT: ${scene}\n` +
  brandStyleBlock + '\n' +
  // ...
```

No `prisma.media.create` (linha ~842), adicionar `aiThemeId` e `aiPromptSnapshot`:
```javascript
const mediaRecord = await prisma.media.create({
  data: {
    id: newId, companyId, filename, mimeType: 'image/webp', size: optimized.length,
    url: newUrl, aiEnhanced: true,
    aiThemeId: theme?.id || null,
    aiPromptSnapshot: {
      scene,
      themeSnapshot: theme ? {
        name: theme.name, palette: theme.palette, mood: theme.mood,
        props: theme.props, surface: theme.surface, lighting: theme.lighting,
      } : null,
      lessonsApplied: lessonsText || null,
      imagenPrompt: imagenPrompt.slice(0, 2000),
    },
  },
})
```

**Step 3: Smoke test**

```bash
# cria um tema padrão primeiro (Task A3)
# depois gera um pack
curl -X POST http://localhost:3000/ai-studio/generate-pack \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"photoBase64":"data:image/jpeg;base64,...","quantity":2}'
```
Inspeciona no banco: `SELECT id, "aiThemeId", "aiPromptSnapshot" FROM "Media" ORDER BY "createdAt" DESC LIMIT 2;` — deve mostrar themeSnapshot populado.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/aiStudio.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ai-image): inject brand theme + lessons in generate-pack pipeline"
```

---

## Fase D — Frontend

### Task D1: Tela "Temas Visuais" no admin

**Files:**
- Create: `delivery-saas-frontend/src/views/BrandThemes.vue`
- Modify: `delivery-saas-frontend/src/router.js` (rota nova)
- Modify: navegação do admin (sidebar/menu — procurar onde StudioIA aparece)

**Step 1: View `BrandThemes.vue`**

Estrutura:
- Tabela/cards listando temas (`GET /brand-themes`).
- Botão "Novo tema" abre modal com form.
- Cada linha tem botões editar/duplicar/excluir.

Form:
- `name` (text input)
- `storeId` (select: "Todas as lojas" ou loja específica)
- `palette`, `mood`, `props`, `surface`, `lighting` (text inputs)
- `isDefault` (checkbox)

Validação no front:
- Nome obrigatório.
- Pelo menos 1 campo visual preenchido.

Submit:
- POST `/brand-themes` (novo) ou PATCH `/brand-themes/:id` (edição).

Invocar skill `frontend-deliverywl` para padrão visual (Bootstrap 5, cards/tabela, TextInput/SelectInput).

**Step 2: Rota e menu**

Adicionar em `router.js`:
```javascript
{ path: '/admin/brand-themes', component: () => import('./views/BrandThemes.vue'), meta: { requiresAuth: true, role: 'ADMIN' } }
```

Item de menu na sidebar (junto de "Studio IA" ou "Configurações"). Procurar onde StudioIA está e replicar.

**Step 3: Smoke manual**

Acessar `/admin/brand-themes`, criar/editar/excluir um tema. Validar persistência.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/BrandThemes.vue delivery-saas-frontend/src/router.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ai-image): admin UI for brand visual themes"
```

---

### Task D2: Botões 👍/👎 + mini-modal nas thumbs

**Files:**
- Create: `delivery-saas-frontend/src/components/MediaFeedbackButtons.vue`
- Modify: `delivery-saas-frontend/src/views/StudioIA.vue`
- Modify: `delivery-saas-frontend/src/components/MediaLibrary/MediaLibraryModal.vue`

**Step 1: Componente `MediaFeedbackButtons.vue`**

Props: `mediaId`, `existingFeedbacks` (array).
Emits: `update` (após criar/deletar).

Renderiza 2 botões no canto:
- 👍 — toggle: se já existe feedback LIKED do usuário atual, clicar deleta; senão cria.
- 👎 — abre mini-modal com radio (FOOD_DEFORMED / SCENE_REPETITIVE / OFF_BRAND / WRONG_COLOR / OTHER) + textarea para `note`. Cancelar/Confirmar.

Confirmar → POST `/media/:id/feedback`. Validação: se OTHER, note obrigatório.

Indicadores:
- Badge verde "✓ curtida" quando há LIKED do usuário.
- Badge cinza "feedback enviado" quando há outros feedbacks; tooltip lista razões.

**Step 2: Integrar em StudioIA e MediaLibraryModal**

Em ambas: ao renderizar uma thumb com `item.aiEnhanced === true`, sobrepor `<MediaFeedbackButtons :media-id="item.id" :existing-feedbacks="item.feedbacks || []" @update="refetch" />`.

Backend já retorna `aiEnhanced`; precisa expor `feedbacks` no `GET /media`? Solução simples: cada thumb chama `GET /media/:id/feedbacks` lazy quando expande, ou prefetch quando galeria carrega. Decisão: prefetch no `GET /media` adicionando `include: { feedbacks: { where: { userId: req.user.id } } }`. Atualizar `routes/media.js` para incluir.

**Step 3: Smoke test**

Galeria do Studio IA → curtir uma imagem → badge aparece. Rejeitar outra com motivo → confirmação. Recarregar página → badges persistem.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/components/MediaFeedbackButtons.vue \
        delivery-saas-frontend/src/views/StudioIA.vue \
        delivery-saas-frontend/src/components/MediaLibrary/MediaLibraryModal.vue \
        delivery-saas-backend/src/routes/media.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ai-image): 👍/👎 feedback buttons in image gallery"
```

---

### Task D3: Dropdown de tema + card de lições no Studio IA

**Files:**
- Modify: `delivery-saas-frontend/src/views/StudioIA.vue`

**Step 1: Seletor de tema antes de "Gerar pack"**

Carregar temas com `GET /brand-themes` no mount. Dropdown:
- "— Sem tema (genérico) —" (value: `null`)
- Lista de temas: `{name} (storeName?)` ou `{name} (padrão)`.

Pré-seleciona: tema da `storeId` ativa OU `isDefault`.

Ao chamar `generate-pack`, incluir `themeId` no body.

**Step 2: Card "Lições aprendidas"**

Carregar `GET /ai-studio/lessons` no mount.
- Se `null` → mostra estado vazio: "Ainda sem lições. Dê feedback nas imagens e clique em 'Atualizar agora'."
- Se preenchido → mostra `text` em `<pre>` ou linhas formatadas; "Última atualização: X dias atrás · N feedbacks".

Botão "Atualizar agora":
- Disable se está carregando.
- POST `/ai-studio/lessons/refresh`.
- Sucesso: recarrega card.
- Erro 400 (sem feedback): toast "Você precisa dar feedback nas imagens primeiro."

**Step 3: Smoke test**

Studio IA: dropdown lista temas; ao mudar e gerar, verifica que `aiThemeId` no Media é o esperado. Card atualiza ao clicar "Atualizar agora".

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/StudioIA.vue
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ai-image): theme dropdown + lessons card in Studio IA"
```

---

## Fase E — QA

### Task E1: Teste end-to-end manual

1. Cadastrar tema visual "Rústico" no admin.
2. Studio IA → gerar pack com tema "Rústico".
3. Conferir banco: `Media.aiThemeId` populado + `aiPromptSnapshot.themeSnapshot` correto.
4. Curtir 2 imagens, rejeitar 1 com "scene_repetitive" e 1 com "off_brand".
5. Clicar "Atualizar lições agora" no Studio IA.
6. Confirmar que `Company.aiLessonsCache.text` aparece no card.
7. Gerar novo pack → conferir que `aiPromptSnapshot.lessonsApplied` reflete o texto cacheado.
8. Conferir queries SQL do design doc (taxa de aprovação por tema, razões mais comuns).

### Task E2: Doc operacional curto

**Files:**
- Create: `docs/operacao/temas-visuais-e-feedback.md`

Passos para o operador:
- O que é tema visual e por que importa.
- Como cadastrar um tema (passo a passo).
- Como dar feedback nas imagens.
- Quando clicar em "Atualizar lições agora".
- O que NÃO esperar (sistema não muda imagens já geradas; melhora as próximas).

**Commit:**
```bash
git add docs/operacao/temas-visuais-e-feedback.md
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "docs(operacao): guia de temas visuais e feedback de IA"
```

---

## Notas

- **Ordem importa**: A1 (schema) → A2 (helpers + testes) → A3 (CRUD temas) → B (feedback) → C (pipeline) → D (front) → E (QA). Não pula.
- **Tasks independentes**: D1 (CRUD UI), D2 (feedback UI) e D3 (Studio IA mods) podem rodar em paralelo se houver mais de uma sessão; só compartilham CSS/store global.
- **Cuidado com migration**: Task A1 usa `prisma db push` no dev (não cria migration file). Para produção, depois gerar migration com `prisma migrate dev --name brand_themes_and_feedback`.
- **Custo do refresh de lições**: ~$0.001 por chamada (Gemini Flash). Não passa pelo `aiCreditManager` — é custo da plataforma.
- **Compatibilidade**: pipelines sem tema e sem lições funcionam exatamente como hoje (blocos do prompt não são adicionados quando vazios).
