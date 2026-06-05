# Menu Announcements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admins to configure, per menu (cardápio), a daily-dismissable alert modal and a persistent promotional banner that render on PublicMenu.

**Architecture:** Single 1-1 sidecar table `MenuAnnouncement` (popup + banner fields together). New backend route `/menu-announcements/:menuId` (GET/PUT + image upload). Pure-logic validation/sanitization extracted to `src/services/menuAnnouncementService.js` for TDD. Public payload extends `GET /public/menu/:slug` with an `announcement` object when enabled. Admin UI is a new Vue page under the Marketing module.

**Tech Stack:** Prisma + PostgreSQL, Express, Multer + Sharp (image upload/optimization), Vue 3 + Bootstrap 5, `node:test` + `node:assert/strict` (ESM tests with prisma mocks).

**Design doc:** [docs/plans/2026-06-05-menu-announcements-design.md](2026-06-05-menu-announcements-design.md)

**Conventions referenced:**
- Backend tests: extract pure logic into `src/services/` or `src/utils/`, test with prisma mocks (no HTTP layer)
- Frontend: use `<SelectInput>` / `<TextInput>` wrappers, Bootstrap 5 (see [frontend-deliverywl] skill)
- Dev env: Docker (`docker compose up -d`); Prisma uses `db push` in dev (not `migrate dev`)

---

## Task 1: Add `MenuAnnouncement` to Prisma schema

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add model after the `Menu` model block (around line 858)**

```prisma
model MenuAnnouncement {
  id              String   @id @default(uuid())
  menuId          String   @unique
  menu            Menu     @relation(fields: [menuId], references: [id], onDelete: Cascade)

  // ---- Popup (modal 1x/dia) ----
  popupEnabled    Boolean  @default(false)
  popupTitle      String?
  popupMessage    String   @default("")
  popupButtonText String?
  popupCtaUrl     String?
  popupCtaLabel   String?
  popupImageUrl   String?

  // ---- Banner (faixa topo PublicMenu) ----
  bannerEnabled   Boolean  @default(false)
  bannerText      String   @default("")
  bannerBgColor   String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

**Step 2: Add inverse relation in `Menu` model (inside the existing `Menu` block, around line 856)**

```prisma
  announcement   MenuAnnouncement?
```

**Step 3: Push schema to dev DB**

Run (inside the backend container OR locally if connected to the dev DB):
```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```
Expected: "Database is now in sync with the Prisma schema." and "Generated Prisma Client".

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(announcements): add MenuAnnouncement model"
```

---

## Task 2: Service module — validation & sanitization (TDD)

**Files:**
- Create: `delivery-saas-backend/src/services/menuAnnouncementService.js`
- Create: `delivery-saas-backend/tests/menuAnnouncement.service.test.mjs`

**Step 1: Write failing tests**

Create `delivery-saas-backend/tests/menuAnnouncement.service.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateAnnouncementInput,
  sanitizeAnnouncementInput,
  buildPublicAnnouncement,
} from '../src/services/menuAnnouncementService.js'

test('validateAnnouncementInput: invalid hex bannerBgColor rejected', () => {
  const r = validateAnnouncementInput({ bannerBgColor: 'red' })
  assert.equal(r.ok, false)
  assert.match(r.error, /bannerBgColor/)
})

test('validateAnnouncementInput: valid hex bannerBgColor accepted', () => {
  const r = validateAnnouncementInput({ bannerBgColor: '#1A2B3C' })
  assert.equal(r.ok, true)
})

test('validateAnnouncementInput: null bannerBgColor accepted', () => {
  const r = validateAnnouncementInput({ bannerBgColor: null })
  assert.equal(r.ok, true)
})

test('validateAnnouncementInput: invalid popupCtaUrl rejected', () => {
  const r = validateAnnouncementInput({ popupCtaUrl: 'not a url' })
  assert.equal(r.ok, false)
  assert.match(r.error, /popupCtaUrl/)
})

test('validateAnnouncementInput: https URL accepted', () => {
  const r = validateAnnouncementInput({ popupCtaUrl: 'https://x.com/promo' })
  assert.equal(r.ok, true)
})

test('validateAnnouncementInput: popupMessage > 500 chars rejected', () => {
  const r = validateAnnouncementInput({ popupMessage: 'a'.repeat(501) })
  assert.equal(r.ok, false)
  assert.match(r.error, /popupMessage/)
})

test('validateAnnouncementInput: bannerText > 200 chars rejected', () => {
  const r = validateAnnouncementInput({ bannerText: 'a'.repeat(201) })
  assert.equal(r.ok, false)
})

test('sanitizeAnnouncementInput: strips HTML tags', () => {
  const out = sanitizeAnnouncementInput({
    popupMessage: 'olá <script>x</script><b>oi</b>',
    bannerText: 'compre <a href="x">aqui</a>',
    popupTitle: '<h1>Promo</h1>',
  })
  assert.equal(out.popupMessage, 'olá xoi')
  assert.equal(out.bannerText, 'compre aqui')
  assert.equal(out.popupTitle, 'Promo')
})

test('sanitizeAnnouncementInput: passes booleans/urls untouched', () => {
  const out = sanitizeAnnouncementInput({
    popupEnabled: true,
    bannerEnabled: false,
    popupCtaUrl: 'https://x.com',
  })
  assert.equal(out.popupEnabled, true)
  assert.equal(out.bannerEnabled, false)
  assert.equal(out.popupCtaUrl, 'https://x.com')
})

test('buildPublicAnnouncement: returns null when both disabled', () => {
  const out = buildPublicAnnouncement({ popupEnabled: false, bannerEnabled: false })
  assert.equal(out, null)
})

test('buildPublicAnnouncement: includes only popup fields when popupEnabled', () => {
  const out = buildPublicAnnouncement({
    popupEnabled: true,
    bannerEnabled: false,
    popupTitle: 'T', popupMessage: 'M', popupButtonText: 'OK',
    popupCtaUrl: null, popupCtaLabel: null, popupImageUrl: null,
    bannerText: 'should be hidden', bannerBgColor: '#000',
    updatedAt: new Date('2026-06-05T12:00:00Z'),
  })
  assert.equal(out.popupEnabled, true)
  assert.equal(out.popupMessage, 'M')
  assert.equal(out.bannerEnabled, false)
  assert.equal(out.bannerText, undefined)
  assert.equal(out.updatedAt, '2026-06-05T12:00:00.000Z')
})

test('buildPublicAnnouncement: includes only banner fields when bannerEnabled', () => {
  const out = buildPublicAnnouncement({
    popupEnabled: false,
    bannerEnabled: true,
    popupMessage: 'hidden',
    bannerText: 'BUY NOW', bannerBgColor: '#FF0000',
    updatedAt: new Date('2026-06-05T12:00:00Z'),
  })
  assert.equal(out.bannerEnabled, true)
  assert.equal(out.bannerText, 'BUY NOW')
  assert.equal(out.popupMessage, undefined)
})
```

**Step 2: Run tests to verify they fail**

```bash
docker compose exec backend node --test tests/menuAnnouncement.service.test.mjs
```
Expected: all tests FAIL with "Cannot find module '../src/services/menuAnnouncementService.js'".

**Step 3: Implement minimal service**

Create `delivery-saas-backend/src/services/menuAnnouncementService.js`:

```js
const HEX = /^#[0-9A-Fa-f]{6}$/

const LIMITS = {
  popupTitle: 100,
  popupMessage: 500,
  popupButtonText: 100,
  popupCtaLabel: 100,
  bannerText: 200,
}

function isValidUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' }
  catch { return false }
}

function stripTags(s) {
  if (typeof s !== 'string') return s
  return s.replace(/<[^>]*>/g, '').trim()
}

export function validateAnnouncementInput(input) {
  if (input.bannerBgColor != null && !HEX.test(input.bannerBgColor)) {
    return { ok: false, error: 'bannerBgColor must be #RRGGBB hex' }
  }
  if (input.popupCtaUrl != null && input.popupCtaUrl !== '' && !isValidUrl(input.popupCtaUrl)) {
    return { ok: false, error: 'popupCtaUrl must be a valid http(s) URL' }
  }
  for (const [field, max] of Object.entries(LIMITS)) {
    const v = input[field]
    if (typeof v === 'string' && v.length > max) {
      return { ok: false, error: `${field} exceeds ${max} chars` }
    }
  }
  return { ok: true }
}

export function sanitizeAnnouncementInput(input) {
  const out = { ...input }
  for (const f of ['popupTitle', 'popupMessage', 'popupButtonText', 'popupCtaLabel', 'bannerText']) {
    if (f in out) out[f] = stripTags(out[f])
  }
  return out
}

export function buildPublicAnnouncement(row) {
  if (!row) return null
  if (!row.popupEnabled && !row.bannerEnabled) return null
  const out = {
    popupEnabled: !!row.popupEnabled,
    bannerEnabled: !!row.bannerEnabled,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }
  if (row.popupEnabled) {
    out.popupTitle = row.popupTitle || null
    out.popupMessage = row.popupMessage || ''
    out.popupButtonText = row.popupButtonText || null
    out.popupCtaUrl = row.popupCtaUrl || null
    out.popupCtaLabel = row.popupCtaLabel || null
    out.popupImageUrl = row.popupImageUrl || null
  }
  if (row.bannerEnabled) {
    out.bannerText = row.bannerText || ''
    out.bannerBgColor = row.bannerBgColor || null
  }
  return out
}
```

**Step 4: Run tests to verify they pass**

```bash
docker compose exec backend node --test tests/menuAnnouncement.service.test.mjs
```
Expected: all tests PASS.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/services/menuAnnouncementService.js \
        delivery-saas-backend/tests/menuAnnouncement.service.test.mjs
git commit -m "feat(announcements): add validation/sanitization service with tests"
```

---

## Task 3: Backend routes — GET & PUT

**Files:**
- Create: `delivery-saas-backend/src/routes/menuAnnouncements.js`
- Modify: `delivery-saas-backend/src/index.js` (mount the router)

**Step 1: Create the routes file**

```js
// delivery-saas-backend/src/routes/menuAnnouncements.js
import express from 'express'
import { authMiddleware } from '../auth.js'
import prisma from '../prisma.js'
import {
  validateAnnouncementInput,
  sanitizeAnnouncementInput,
} from '../services/menuAnnouncementService.js'

const router = express.Router()

async function loadMenuForCompany(menuId, companyId) {
  const menu = await prisma.menu.findFirst({
    where: { id: menuId, store: { companyId } },
    select: { id: true },
  })
  return menu
}

router.get('/:menuId', authMiddleware(['ADMIN']), async (req, res) => {
  const { menuId } = req.params
  const companyId = req.user.companyId
  const menu = await loadMenuForCompany(menuId, companyId)
  if (!menu) return res.status(404).json({ error: 'menu not found' })
  const row = await prisma.menuAnnouncement.findUnique({ where: { menuId } })
  res.json(row || null)
})

router.put('/:menuId', authMiddleware(['ADMIN']), async (req, res) => {
  const { menuId } = req.params
  const companyId = req.user.companyId
  const menu = await loadMenuForCompany(menuId, companyId)
  if (!menu) return res.status(404).json({ error: 'menu not found' })

  const sanitized = sanitizeAnnouncementInput(req.body || {})
  const v = validateAnnouncementInput(sanitized)
  if (!v.ok) return res.status(400).json({ error: v.error })

  const allowed = [
    'popupEnabled', 'popupTitle', 'popupMessage', 'popupButtonText',
    'popupCtaUrl', 'popupCtaLabel', 'popupImageUrl',
    'bannerEnabled', 'bannerText', 'bannerBgColor',
  ]
  const data = {}
  for (const k of allowed) if (k in sanitized) data[k] = sanitized[k]

  const row = await prisma.menuAnnouncement.upsert({
    where: { menuId },
    create: { menuId, ...data },
    update: data,
  })
  res.json(row)
})

export default router
```

**Step 2: Mount in `src/index.js`**

Find the route mounting block (~line 269–274 where `publicMenuRouter` and others are mounted). Add an import at the top (next to other `import ... from './routes/...'` imports):

```js
import menuAnnouncementsRouter from './routes/menuAnnouncements.js'
```

And mount it (after the other private routers, before `/public/...` mounts):

```js
app.use('/menu-announcements', menuAnnouncementsRouter)
```

**Step 3: Smoke check the server starts**

```bash
docker compose restart backend
docker compose logs --tail 30 backend
```
Expected: no startup errors.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/menuAnnouncements.js \
        delivery-saas-backend/src/index.js
git commit -m "feat(announcements): GET/PUT routes mounted at /menu-announcements"
```

---

## Task 4: Image upload endpoints (POST/DELETE)

**Files:**
- Modify: `delivery-saas-backend/src/routes/menuAnnouncements.js`

**Step 1: Add multer + sharp at top of file**

```js
import multer from 'multer'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'announcements')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) cb(null, true)
    else cb(new Error('unsupported mime'), false)
  },
})
```

**Step 2: Add upload route**

```js
router.post('/:menuId/image', authMiddleware(['ADMIN']), upload.single('file'), async (req, res) => {
  const { menuId } = req.params
  const companyId = req.user.companyId
  const menu = await loadMenuForCompany(menuId, companyId)
  if (!menu) return res.status(404).json({ error: 'menu not found' })
  if (!req.file) return res.status(400).json({ error: 'file required' })

  const ext = req.file.mimetype === 'image/png' ? 'png'
    : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg'
  const filename = `${menuId}-${Date.now()}.${ext}`
  const filepath = path.join(UPLOAD_DIR, filename)

  const optimized = await sharp(req.file.buffer)
    .resize({ width: 1080, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer()
  await fs.promises.writeFile(filepath, optimized)

  // remove previous image if present
  const existing = await prisma.menuAnnouncement.findUnique({ where: { menuId }, select: { popupImageUrl: true } })
  if (existing?.popupImageUrl?.startsWith('/public/uploads/announcements/')) {
    const oldPath = path.join(process.cwd(), existing.popupImageUrl.replace(/^\//, ''))
    fs.promises.unlink(oldPath).catch(() => {})
  }

  const url = `/public/uploads/announcements/${filename}`
  await prisma.menuAnnouncement.upsert({
    where: { menuId },
    create: { menuId, popupImageUrl: url },
    update: { popupImageUrl: url },
  })
  res.json({ url })
})

router.delete('/:menuId/image', authMiddleware(['ADMIN']), async (req, res) => {
  const { menuId } = req.params
  const companyId = req.user.companyId
  const menu = await loadMenuForCompany(menuId, companyId)
  if (!menu) return res.status(404).json({ error: 'menu not found' })

  const existing = await prisma.menuAnnouncement.findUnique({ where: { menuId }, select: { popupImageUrl: true } })
  if (existing?.popupImageUrl?.startsWith('/public/uploads/announcements/')) {
    const oldPath = path.join(process.cwd(), existing.popupImageUrl.replace(/^\//, ''))
    fs.promises.unlink(oldPath).catch(() => {})
  }
  await prisma.menuAnnouncement.update({ where: { menuId }, data: { popupImageUrl: null } })
  res.json({ ok: true })
})
```

**Step 3: Manual smoke (curl with valid JWT — admin user from seed)**

Skip if no easy admin token available. Otherwise:
```bash
curl -X POST -H "Authorization: Bearer <token>" -F "file=@some.png" \
  http://localhost:3000/menu-announcements/<menuId>/image
```
Expected: `{"url": "/public/uploads/announcements/..."}`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/menuAnnouncements.js
git commit -m "feat(announcements): popup image upload + delete endpoints"
```

---

## Task 5: Expose `announcement` in PublicMenu payload

**Files:**
- Modify: `delivery-saas-backend/src/routes/publicMenu.js`

**Step 1: Locate the menu fetch in the `GET /menu/:slug` handler**

Read the handler that resolves a `slug` to a `Menu` row and serializes it to the public payload. Add `announcement: true` to its Prisma `include`/`select`.

**Step 2: Apply `buildPublicAnnouncement` to the result**

At the top of the file, add:
```js
import { buildPublicAnnouncement } from '../services/menuAnnouncementService.js'
```

In the serialization, before responding:
```js
payload.announcement = buildPublicAnnouncement(menu.announcement)
```
(adjust to match the local variable name for the loaded menu).

**Step 3: Add a test for the payload helper**

Append to `delivery-saas-backend/tests/menuAnnouncement.service.test.mjs`:

```js
test('buildPublicAnnouncement: undefined when row missing returns null', () => {
  assert.equal(buildPublicAnnouncement(undefined), null)
})
```

Run:
```bash
docker compose exec backend node --test tests/menuAnnouncement.service.test.mjs
```
Expected: PASS.

**Step 4: Manual smoke**

```bash
curl http://localhost:3000/public/menu/<slug> | jq .announcement
```
Expected: `null` initially; after a PUT with `popupEnabled: true`, returns the popup object.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/publicMenu.js \
        delivery-saas-backend/tests/menuAnnouncement.service.test.mjs
git commit -m "feat(announcements): expose announcement in public menu payload"
```

---

## Task 6: Frontend route + Sidebar entry

**Files:**
- Modify: `delivery-saas-frontend/src/router.js`
- Modify: `delivery-saas-frontend/src/components/Sidebar.vue`

**Step 1: Add route in `router.js`** (next to the other `/marketing/*` routes around line 225–254)

```js
{
  path: '/marketing/menu-notifications',
  component: () => import('./views/marketing/MenuNotifications.vue'),
  meta: { requiresAuth: true, role: 'ADMIN' },
},
```

Also add a label entry in the `routeTitles` map (look for `['/marketing/campaigns', 'Campanhas']` around line 537):

```js
['/marketing/menu-notifications', 'Avisos no Cardápio'],
```

**Step 2: Add Sidebar entry**

Find the Marketing group in `Sidebar.vue` (search for `marketing/campaigns` or `Brand Themes`). Add a new `<router-link>` (or array entry, depending on local pattern) for `/marketing/menu-notifications` with label "Avisos no Cardápio" and an icon (e.g. `bi-megaphone`).

**Step 3: Smoke-check**

Visit `http://localhost:5173/marketing/menu-notifications`. Expect a 404 component error from the not-yet-created `MenuNotifications.vue` — that's expected here.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/router.js delivery-saas-frontend/src/components/Sidebar.vue
git commit -m "feat(announcements): add /marketing/menu-notifications route + sidebar entry"
```

---

## Task 7: MenuNotifications.vue scaffold (menu selector + load/save)

**Files:**
- Create: `delivery-saas-frontend/src/views/marketing/MenuNotifications.vue`

**Step 1: Implement scaffold**

```vue
<template>
  <div class="container py-4">
    <h2 class="mb-3">Avisos no Cardápio</h2>

    <div class="row mb-4">
      <div class="col-md-6">
        <label class="form-label">Cardápio</label>
        <SelectInput v-model="menuId" :options="menuOptions" @change="loadAnnouncement" />
      </div>
    </div>

    <div v-if="loading" class="text-muted">Carregando…</div>
    <template v-else-if="menuId">
      <!-- popup card -->
      <PopupSection v-model="form" />
      <!-- banner card -->
      <BannerSection v-model="form" />

      <div class="position-sticky bottom-0 bg-white py-3 border-top">
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'Salvando…' : 'Salvar' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import api from '../../api.js'
import SelectInput from '../../components/SelectInput.vue'
// Sections are added in later tasks — for this step, render placeholder divs:
const PopupSection = { template: '<div class="card mb-3"><div class="card-body">popup-here</div></div>' }
const BannerSection = { template: '<div class="card mb-3"><div class="card-body">banner-here</div></div>' }

const menus = ref([])
const menuId = ref('')
const form = ref(defaults())
const loading = ref(false)
const saving = ref(false)

const menuOptions = computed(() =>
  menus.value.map(m => ({ value: m.id, label: m.name }))
)

function defaults() {
  return {
    popupEnabled: false, popupTitle: '', popupMessage: '',
    popupButtonText: 'Entendi', popupCtaUrl: '', popupCtaLabel: '',
    popupImageUrl: null,
    bannerEnabled: false, bannerText: '', bannerBgColor: '#0d6efd',
  }
}

onMounted(async () => {
  const { data } = await api.get('/menus')
  menus.value = data || []
  if (menus.value.length) {
    menuId.value = menus.value[0].id
    await loadAnnouncement()
  }
})

async function loadAnnouncement() {
  loading.value = true
  try {
    const { data } = await api.get(`/menu-announcements/${menuId.value}`)
    form.value = data ? { ...defaults(), ...data } : defaults()
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const { data } = await api.put(`/menu-announcements/${menuId.value}`, form.value)
    form.value = { ...defaults(), ...data }
    // toast: project's standard
    window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: 'Salvo' } }))
  } catch (e) {
    window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: e?.response?.data?.error || 'Erro ao salvar' } }))
  } finally {
    saving.value = false
  }
}
</script>
```

**Note:** Verify the actual menus-list endpoint (`/menus`) and the toast pattern used in the project; adjust the two highlighted spots if different. Reuse whatever `CampaignsList.vue` / `BrandThemes.vue` already use.

**Step 2: Manual smoke**

Reload `/marketing/menu-notifications`. Pick a cardápio → expect placeholders to render and "Salvar" to PUT and return the row (Network tab).

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/marketing/MenuNotifications.vue
git commit -m "feat(announcements): scaffold admin page with menu selector + load/save"
```

---

## Task 8: Popup section (form + live preview)

**Files:**
- Modify: `delivery-saas-frontend/src/views/marketing/MenuNotifications.vue`

**Step 1: Replace the placeholder `PopupSection` with an inline component or move to a child file**

Add inside the script setup:

```js
import TextInput from '../../components/TextInput.vue'
```

Replace the placeholder definition with a real template + script for `PopupSection`. Use `defineComponent` + `v-model` so it edits a shared object (or, simpler, inline the markup directly in the page and drop the child wrapper).

**Inline option (recommended for brevity):** delete the `PopupSection` placeholder and replace `<PopupSection v-model="form" />` with the form markup directly:

```vue
<div class="card mb-3">
  <div class="card-body">
    <div class="form-check form-switch mb-3">
      <input class="form-check-input" type="checkbox" id="popupOn" v-model="form.popupEnabled" />
      <label class="form-check-label" for="popupOn"><strong>Modal de aviso (1x/dia)</strong></label>
    </div>

    <div v-if="form.popupEnabled" class="row">
      <div class="col-lg-7">
        <TextInput label="Título (opcional)" v-model="form.popupTitle" maxlength="100" />
        <div class="mb-3">
          <label class="form-label">Mensagem</label>
          <textarea class="form-control" rows="4" maxlength="500" v-model="form.popupMessage"></textarea>
          <small class="text-muted">{{ form.popupMessage.length }}/500</small>
        </div>
        <TextInput label="Texto do botão" v-model="form.popupButtonText" maxlength="100" placeholder="Entendi" />
        <TextInput label="Link CTA (opcional)" v-model="form.popupCtaUrl" placeholder="https://…" />
        <TextInput label="Label do CTA" v-model="form.popupCtaLabel" maxlength="100" placeholder="Saiba mais" />
        <div class="mb-3">
          <label class="form-label d-block">Imagem (opcional)</label>
          <div v-if="form.popupImageUrl" class="mb-2">
            <img :src="form.popupImageUrl" class="img-thumbnail" style="max-width:200px" />
            <button class="btn btn-sm btn-outline-danger ms-2" @click="removeImage">Remover</button>
          </div>
          <input type="file" class="form-control" accept="image/png,image/jpeg,image/webp" @change="uploadImage" />
        </div>
      </div>

      <div class="col-lg-5">
        <div class="text-muted small mb-1">Preview</div>
        <div class="border rounded p-3" style="max-width:340px">
          <img v-if="form.popupImageUrl" :src="form.popupImageUrl" class="img-fluid mb-2" />
          <h5 v-if="form.popupTitle">{{ form.popupTitle }}</h5>
          <p class="mb-2" style="white-space:pre-wrap">{{ form.popupMessage }}</p>
          <div class="d-flex gap-2">
            <button class="btn btn-primary btn-sm">{{ form.popupButtonText || 'Entendi' }}</button>
            <a v-if="form.popupCtaUrl && form.popupCtaLabel" class="btn btn-outline-secondary btn-sm">
              {{ form.popupCtaLabel }}
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

Add the upload handler at script-setup level:

```js
async function uploadImage(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const fd = new FormData()
  fd.append('file', file)
  const { data } = await api.post(`/menu-announcements/${menuId.value}/image`, fd)
  form.value.popupImageUrl = data.url
}
async function removeImage() {
  await api.delete(`/menu-announcements/${menuId.value}/image`)
  form.value.popupImageUrl = null
}
```

**Step 2: Manual smoke**

Toggle popup on, fill fields, upload image — preview updates live. Save → reload → state preserved.

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/marketing/MenuNotifications.vue
git commit -m "feat(announcements): popup form + image upload + live preview"
```

---

## Task 9: Banner section (form + live preview with auto-contrast)

**Files:**
- Modify: `delivery-saas-frontend/src/views/marketing/MenuNotifications.vue`

**Step 1: Add YIQ contrast helper at script-setup level**

```js
function contrastTextColor(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return '#fff'
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  return ((r*299 + g*587 + b*114) / 1000) >= 128 ? '#111' : '#fff'
}
```

**Step 2: Replace the placeholder `BannerSection`**

```vue
<div class="card mb-3">
  <div class="card-body">
    <div class="form-check form-switch mb-3">
      <input class="form-check-input" type="checkbox" id="bannerOn" v-model="form.bannerEnabled" />
      <label class="form-check-label" for="bannerOn"><strong>Faixa promocional</strong></label>
    </div>

    <div v-if="form.bannerEnabled" class="row">
      <div class="col-lg-7">
        <div class="mb-3">
          <label class="form-label">Texto</label>
          <textarea class="form-control" rows="2" maxlength="200" v-model="form.bannerText"></textarea>
          <small class="text-muted">{{ form.bannerText.length }}/200</small>
        </div>
        <div class="mb-3">
          <label class="form-label">Cor de fundo</label>
          <input type="color" class="form-control form-control-color" v-model="form.bannerBgColor" />
        </div>
      </div>
      <div class="col-lg-5">
        <div class="text-muted small mb-1">Preview</div>
        <div class="px-3 py-2 text-center"
             :style="{ background: form.bannerBgColor, color: contrastTextColor(form.bannerBgColor) }">
          {{ form.bannerText || 'Sua mensagem aqui' }}
        </div>
      </div>
    </div>
  </div>
</div>
```

**Step 3: Manual smoke**

Toggle banner on, change color → preview text auto-flips between light/dark.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/marketing/MenuNotifications.vue
git commit -m "feat(announcements): banner form + live preview with auto-contrast"
```

---

## Task 10: PublicMenu — render promotional banner

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue`

**Step 1: Add the banner template right after the PWA install banner** (around line 16, after the closing `</div>` of `.pwa-install-banner`):

```vue
<div
  v-if="announcement?.bannerEnabled && announcement.bannerText"
  class="menu-announcement-bar text-center px-3 py-2"
  :style="{ background: announcement.bannerBgColor || '#0d6efd', color: announcementBarTextColor }"
>
  {{ announcement.bannerText }}
</div>
```

**Step 2: Wire up the `announcement` ref + computed text color**

Find where the menu payload is loaded (search for the `/public/menu/` axios call). Capture `announcement` from the response into a new `const announcement = ref(null)` in the script setup, set it when the payload arrives.

Add the computed:

```js
const announcementBarTextColor = computed(() => {
  const hex = announcement.value?.bannerBgColor
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return '#fff'
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  return ((r*299 + g*587 + b*114) / 1000) >= 128 ? '#111' : '#fff'
})
```

**Step 3: Manual smoke**

Enable banner in admin, save. Open the public menu URL on mobile (or DevTools mobile mode). Dismiss the PWA banner → faixa fica visível abaixo.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/PublicMenu.vue
git commit -m "feat(announcements): render promotional banner on PublicMenu"
```

---

## Task 11: PublicMenu — render alert modal with daily dismiss

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue`

**Step 1: Add a modal template** (place near the bottom of the template, alongside other modals):

```vue
<div v-if="showAnnouncementPopup" class="modal fade show d-block" style="background:rgba(0,0,0,.5)" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body text-center">
        <img v-if="announcement.popupImageUrl" :src="announcement.popupImageUrl" class="img-fluid mb-3" />
        <h5 v-if="announcement.popupTitle" class="mb-2">{{ announcement.popupTitle }}</h5>
        <p style="white-space:pre-wrap">{{ announcement.popupMessage }}</p>
      </div>
      <div class="modal-footer">
        <a v-if="announcement.popupCtaUrl && announcement.popupCtaLabel"
           :href="announcement.popupCtaUrl" target="_blank" rel="noopener"
           class="btn btn-outline-secondary">{{ announcement.popupCtaLabel }}</a>
        <button class="btn btn-primary" @click="dismissAnnouncementPopup">
          {{ announcement.popupButtonText || 'Entendi' }}
        </button>
      </div>
    </div>
  </div>
</div>
```

**Step 2: Add state + dismiss logic at script-setup level**

```js
const showAnnouncementPopup = ref(false)

function announcementDismissKey() {
  return `menu_announcement_dismiss_${menuIdFromPayload.value}`  // adjust to local var
}

function evalAnnouncementPopup() {
  if (!announcement.value?.popupEnabled) return
  const today = new Date().toISOString().slice(0, 10)
  const version = announcement.value.updatedAt
  let stored = {}
  try { stored = JSON.parse(localStorage.getItem(announcementDismissKey()) || '{}') } catch {}
  if (stored.date === today && stored.version === version) return
  setTimeout(() => { showAnnouncementPopup.value = true }, 400)
}

function dismissAnnouncementPopup() {
  showAnnouncementPopup.value = false
  const today = new Date().toISOString().slice(0, 10)
  const version = announcement.value?.updatedAt
  try {
    localStorage.setItem(announcementDismissKey(), JSON.stringify({ date: today, version }))
  } catch {}
}
```

**Step 3: Call `evalAnnouncementPopup()` after the public menu payload loads** (same callback site where the banner is wired up).

**Step 4: Manual smoke**

- Enable popup in admin, save. Open public URL → modal appears after ~400ms.
- Click "Entendi" → modal closes. Reload → modal does NOT reappear today.
- Admin edits the message → save. Reload public → modal reappears immediately.
- Open in incognito → modal appears (no localStorage).

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/PublicMenu.vue
git commit -m "feat(announcements): render daily-dismiss alert modal on PublicMenu"
```

---

## Task 12: Final manual verification

**No code changes** — exercise every path end-to-end:

1. Admin page: create a popup with title + message + button text + CTA link + image. Save. Reload. State preserved.
2. Toggle popup OFF → save → public payload omits popup (curl `/public/menu/<slug>`).
3. Toggle popup ON, change text → public reloaded → modal reappears for previously-dismissed user (verify in same browser).
4. Banner: set color `#FFFF00` → text should render dark. Set `#000080` → text should render white.
5. Mobile DevTools view: PWA banner → dismiss → faixa visible below.
6. Multi-tenant: log in as a different company's admin → GET on another company's menuId returns 404.
7. Image upload: upload 3 MB PNG → 400 (`fileSize`). Upload `.svg` → 400 (`mime`). Upload 1.5 MB JPG → 200, file lands in `public/uploads/announcements/`.
8. Image replace: upload a new image → old file gets `unlink`'d (check disk).

**No commit** — verification only.

---

## Out of scope (explicit YAGNI)

- Multiple campaigns per menu / scheduling (`startsAt`/`endsAt`).
- Rich text editor or markdown.
- Click/impression analytics on the announcement (separate from existing `MenuEvent`).
- Translating/localizing the banner per visitor language.
- Push notifications.
