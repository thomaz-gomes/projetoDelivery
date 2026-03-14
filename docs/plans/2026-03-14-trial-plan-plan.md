# Trial Plan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a TRIAL plan system where companies can temporarily upgrade to a trial plan, then automatically revert when it expires.

**Architecture:** New `isTrial` and `trialDurationDays` fields on `SaasPlan`, new `CompanyTrial` table to track trial state per company. Trial activation swaps the subscription plan; expiration reverts it. Job-based expiration via `/saas/jobs/expire-trials`.

**Tech Stack:** Prisma (PostgreSQL), Express.js, Vue 3 + Bootstrap 5, Pinia

---

### Task 1: Add Trial Fields to SaasPlan Schema

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma:919-940`

**Step 1: Add isTrial and trialDurationDays fields to SaasPlan model**

In `schema.prisma`, inside the `SaasPlan` model (after line 934 `isSystem`), add:

```prisma
  isTrial            Boolean  @default(false)
  trialDurationDays  Int?
```

The model should look like:
```prisma
model SaasPlan {
  id                    String   @id @default(uuid())
  name                  String
  price                 Decimal  @default(0)
  menuLimit             Int?
  storeLimit            Int?
  unlimitedMenus        Boolean  @default(false)
  unlimitedStores       Boolean  @default(false)
  aiCreditsMonthlyLimit Int      @default(100)
  unlimitedAiCredits    Boolean  @default(false)
  isActive              Boolean  @default(true)
  isDefault             Boolean  @default(false)
  isSystem              Boolean  @default(false)
  isTrial              Boolean  @default(false)
  trialDurationDays    Int?
  createdAt             DateTime @default(now())

  modules       SaasPlanModule[]
  prices        SaasPlanPrice[]
  subscriptions SaasSubscription[]
}
```

**Step 2: Run prisma db push**

Run: `cd delivery-saas-backend && npx prisma db push --skip-generate`
Expected: Schema changes applied successfully

**Step 3: Run prisma generate**

Run: `cd delivery-saas-backend && npx prisma generate`
Expected: Prisma Client generated

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add isTrial and trialDurationDays to SaasPlan"
```

---

### Task 2: Create CompanyTrial Model

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add CompanyTrial model after SaasSubscription model (after line ~1009)**

```prisma
// Company trial tracking — one active trial per company at a time
model CompanyTrial {
  id               String    @id @default(cuid())
  companyId        String
  company          Company   @relation(fields: [companyId], references: [id])
  trialPlanId      String
  trialPlan        SaasPlan  @relation("TrialPlan", fields: [trialPlanId], references: [id])
  originalPlanId   String
  originalPlan     SaasPlan  @relation("OriginalPlan", fields: [originalPlanId], references: [id])
  originalPeriod   String?
  durationDays     Int
  priceAfterTrial  Decimal   @default(0)
  status           String    @default("ACTIVE") // ACTIVE, EXPIRED, CANCELED
  startedAt        DateTime  @default(now())
  expiresAt        DateTime
  expiredAt        DateTime?
  createdAt        DateTime  @default(now())

  @@index([companyId, status])
}
```

**Step 2: Add relations to SaasPlan and Company**

In `SaasPlan` model, add after `subscriptions`:
```prisma
  trialsAsTrialPlan    CompanyTrial[] @relation("TrialPlan")
  trialsAsOriginalPlan CompanyTrial[] @relation("OriginalPlan")
```

In `Company` model, find the relations section and add:
```prisma
  companyTrials CompanyTrial[]
```

**Step 3: Run prisma db push**

Run: `cd delivery-saas-backend && npx prisma db push --skip-generate`
Expected: Schema changes applied successfully

**Step 4: Run prisma generate**

Run: `cd delivery-saas-backend && npx prisma generate`
Expected: Prisma Client generated

**Step 5: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add CompanyTrial model for trial tracking"
```

---

### Task 3: Seed the Trial Plan

**Files:**
- Modify: `delivery-saas-backend/scripts/seed_saas.mjs`

**Step 1: Add trial plan creation at the end of the seed (before the "garante subscription" block at line 98)**

After the Starter plan block (line ~96), add:

```javascript
  // ── Plano Trial (isSystem + isTrial, começa inativo) ───────────────────
  let trialPlan = await prisma.saasPlan.findFirst({ where: { isTrial: true } });
  if (!trialPlan) {
    trialPlan = await prisma.saasPlan.create({
      data: {
        name: 'Trial',
        price: '0',
        menuLimit: null,
        storeLimit: null,
        unlimitedMenus: true,
        unlimitedStores: true,
        isActive: false,
        isDefault: false,
        isSystem: true,
        isTrial: true,
        trialDurationDays: 7,
      }
    });
    console.log('Plano "Trial" criado (inativo — configure módulos e ative manualmente).');
  } else {
    await prisma.saasPlan.update({
      where: { id: trialPlan.id },
      data: { isSystem: true, isTrial: true }
    });
    console.log('Plano "Trial" já existe — atualizado.');
  }
```

**Step 2: Run the seed**

Run: `cd delivery-saas-backend && node scripts/seed_saas.mjs`
Expected: Output includes `Plano "Trial" criado`

**Step 3: Commit**

```bash
git add delivery-saas-backend/scripts/seed_saas.mjs
git commit -m "feat(seed): add Trial plan to seed_saas"
```

---

### Task 4: Backend — Trial Routes (activate, eligibility, reset, expire job)

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js`

**Step 1: Add trial eligibility endpoint**

After the existing subscription routes (after the `GET /subscription/me` block ~line 215), add:

```javascript
// -------- Trial --------
// Check if current company is eligible for trial
saasRouter.get('/trial/eligibility', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  try {
    // Find trial plan
    const trialPlan = await prisma.saasPlan.findFirst({ where: { isTrial: true, isActive: true } })
    if (!trialPlan) return res.json({ eligible: false, reason: 'Plano trial não disponível' })

    // Check if company has an active trial
    const activeTrial = await prisma.companyTrial.findFirst({
      where: { companyId, status: 'ACTIVE' }
    })
    if (activeTrial) return res.json({ eligible: false, reason: 'Você já possui um trial ativo', activeTrial })

    // Check if company already used trial (and it wasn't reset)
    // A company is eligible if it has no previous trials, OR all previous trials were followed by a newer reset
    // Simple logic: eligible if no EXPIRED trial exists that is the most recent one
    const lastTrial = await prisma.companyTrial.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' }
    })
    if (lastTrial && (lastTrial.status === 'EXPIRED' || lastTrial.status === 'CANCELED')) {
      return res.json({ eligible: false, reason: 'Você já utilizou o período de trial' })
    }

    res.json({
      eligible: true,
      trialPlan: {
        id: trialPlan.id,
        name: trialPlan.name,
        durationDays: trialPlan.trialDurationDays,
        price: trialPlan.price,
        modules: undefined // will be populated if needed
      }
    })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao verificar elegibilidade', error: e?.message })
  }
})
```

**Step 2: Add trial activation endpoint**

```javascript
// Activate trial for current company
saasRouter.post('/trial/activate', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  try {
    // Find trial plan
    const trialPlan = await prisma.saasPlan.findFirst({
      where: { isTrial: true, isActive: true },
      include: { modules: { include: { module: true } } }
    })
    if (!trialPlan) return res.status(400).json({ message: 'Plano trial não disponível' })

    // Check eligibility
    const activeTrial = await prisma.companyTrial.findFirst({
      where: { companyId, status: 'ACTIVE' }
    })
    if (activeTrial) return res.status(400).json({ message: 'Você já possui um trial ativo' })

    const lastTrial = await prisma.companyTrial.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' }
    })
    if (lastTrial && (lastTrial.status === 'EXPIRED' || lastTrial.status === 'CANCELED')) {
      return res.status(400).json({ message: 'Você já utilizou o período de trial' })
    }

    // Get current subscription
    const currentSub = await prisma.saasSubscription.findUnique({ where: { companyId } })
    if (!currentSub) return res.status(400).json({ message: 'Empresa sem assinatura ativa' })

    const durationDays = trialPlan.trialDurationDays || 7
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + durationDays)

    // Create trial record
    const trial = await prisma.companyTrial.create({
      data: {
        companyId,
        trialPlanId: trialPlan.id,
        originalPlanId: currentSub.planId,
        originalPeriod: currentSub.period,
        durationDays,
        priceAfterTrial: trialPlan.price,
        status: 'ACTIVE',
        expiresAt
      }
    })

    // Switch subscription to trial plan
    await prisma.saasSubscription.update({
      where: { companyId },
      data: { planId: trialPlan.id }
    })

    res.status(201).json(trial)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao ativar trial', error: e?.message })
  }
})
```

**Step 3: Add trial reset endpoint (SUPER_ADMIN)**

```javascript
// Reset trial for a company (SUPER_ADMIN) — allows re-activation
saasRouter.post('/companies/:id/reset-trial', requireRole('SUPER_ADMIN'), async (req, res) => {
  const companyId = req.params.id
  try {
    // Cancel any active trial first (revert plan)
    const activeTrial = await prisma.companyTrial.findFirst({
      where: { companyId, status: 'ACTIVE' }
    })
    if (activeTrial) {
      // Revert subscription to original plan
      await prisma.saasSubscription.update({
        where: { companyId },
        data: { planId: activeTrial.originalPlanId, period: activeTrial.originalPeriod }
      })
      await prisma.companyTrial.update({
        where: { id: activeTrial.id },
        data: { status: 'CANCELED', expiredAt: new Date() }
      })
    }

    // Mark all trials as expired (cleanup)
    await prisma.companyTrial.updateMany({
      where: { companyId, status: { in: ['EXPIRED', 'CANCELED'] } },
      data: { status: 'EXPIRED' }
    })

    // Delete all trial records so company becomes eligible again
    await prisma.companyTrial.deleteMany({ where: { companyId } })

    res.json({ ok: true, message: 'Trial resetado. Empresa pode ativar novamente.' })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao resetar trial', error: e?.message })
  }
})
```

**Step 4: Add expire-trials job endpoint**

```javascript
// Job: expire trials that have passed their expiresAt date
saasRouter.post('/jobs/expire-trials', requireRole('SUPER_ADMIN'), async (_req, res) => {
  try {
    const now = new Date()
    const expiredTrials = await prisma.companyTrial.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } }
    })

    let reverted = 0
    for (const trial of expiredTrials) {
      try {
        // Revert subscription to original plan
        await prisma.saasSubscription.update({
          where: { companyId: trial.companyId },
          data: { planId: trial.originalPlanId, period: trial.originalPeriod }
        })
        // Mark trial as expired
        await prisma.companyTrial.update({
          where: { id: trial.id },
          data: { status: 'EXPIRED', expiredAt: now }
        })
        reverted++
      } catch (err) {
        console.error(`Failed to expire trial ${trial.id}:`, err)
      }
    }

    res.json({ ok: true, expired: reverted, total: expiredTrials.length })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao expirar trials', error: e?.message })
  }
})
```

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(api): add trial activate, eligibility, reset, and expire-trials endpoints"
```

---

### Task 5: Backend — Filter Trial Plans from Client-Facing Endpoints

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js:69-72`

**Step 1: Update GET /saas/plans to filter trial plans for non-SUPER_ADMIN**

Replace the current `GET /plans` route (line 69-72):

```javascript
saasRouter.get('/plans', requireRole('SUPER_ADMIN'), async (_req, res) => {
  const rows = await prisma.saasPlan.findMany({ include: { modules: { include: { module: true } }, prices: true }, orderBy: { createdAt: 'desc' } })
  res.json(rows)
})
```

With:

```javascript
saasRouter.get('/plans', authMiddleware, async (req, res) => {
  const where = {}
  // Non-SUPER_ADMIN users should not see trial plans
  if (req.user.role !== 'SUPER_ADMIN') {
    where.isTrial = false
  }
  const rows = await prisma.saasPlan.findMany({ where, include: { modules: { include: { module: true } }, prices: true }, orderBy: { createdAt: 'desc' } })
  res.json(rows)
})
```

Note: This changes from `requireRole('SUPER_ADMIN')` to `authMiddleware` so ADMIN users can also list plans (minus trial). If plans listing was already restricted to SUPER_ADMIN only and no client needs it, keep `requireRole('SUPER_ADMIN')` and just add the `isTrial` filter. Check if any client view calls GET /saas/plans — if yes, use `authMiddleware`; if only admin views, keep `requireRole('SUPER_ADMIN')` and add the filter.

**Step 2: Update PUT /saas/plans to accept trialDurationDays**

In the `PUT /plans/:id` route (line 96-127), update the destructuring to include `trialDurationDays`:

```javascript
const { name, price, menuLimit, storeLimit, unlimitedMenus, unlimitedStores, aiCreditsMonthlyLimit, unlimitedAiCredits, moduleIds, isDefault, trialDurationDays } = req.body || {}
```

And in the `prisma.saasPlan.update` data object, add:

```javascript
...(trialDurationDays !== undefined && { trialDurationDays: Number(trialDurationDays) }),
```

**Step 3: Update GET /subscription/me to include trial info**

After the existing `GET /subscription/me` route (line ~212-215), enhance it to include active trial info:

Replace:
```javascript
saasRouter.get('/subscription/me', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const sub = await prisma.saasSubscription.findUnique({ where: { companyId }, include: { plan: { include: { modules: { include: { module: true } } } } } })
  res.json(sub)
```

With:
```javascript
saasRouter.get('/subscription/me', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const sub = await prisma.saasSubscription.findUnique({ where: { companyId }, include: { plan: { include: { modules: { include: { module: true } } } } } })

  // Attach active trial info if exists
  const activeTrial = await prisma.companyTrial.findFirst({
    where: { companyId, status: 'ACTIVE' }
  })
  const result = sub ? { ...sub, activeTrial: activeTrial || null } : sub
  res.json(result)
```

**Step 4: Update GET /companies to include trial info**

In the `GET /companies` route (line 717-732), add trial info to the select. After the `saasSubscription` select, add a companyTrials include:

```javascript
const rows = await prisma.company.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, slug: true, createdAt: true,
      saasSubscription: {
        select: {
          id: true, status: true, period: true,
          plan: { select: { id: true, name: true, price: true, isTrial: true } }
        }
      },
      companyTrials: {
        where: { status: 'ACTIVE' },
        select: { id: true, status: true, expiresAt: true, durationDays: true, startedAt: true },
        take: 1
      },
      _count: { select: { stores: true, users: true } }
    }
  })
```

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(api): filter trial plans for clients, add trialDurationDays to PUT, include trial info in responses"
```

---

### Task 6: Frontend — SaasPlans.vue — Show Trial Plan with Duration Field

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasPlans.vue`

**Step 1: Add trialDurationDays to planForm**

Update `emptyPlanForm` (line 33):

```javascript
const emptyPlanForm = () => ({ name: '', price: 0, menuLimit: null, storeLimit: null, unlimitedMenus: false, unlimitedStores: false, aiCreditsMonthlyLimit: 100, unlimitedAiCredits: false, prices: [], trialDurationDays: null })
```

Update `openEditPlan` (line 68-82) to include:
```javascript
trialDurationDays: p.trialDurationDays ?? null
```

Update `savePlan` payload (line 91) to include:
```javascript
const payload = { ...planForm.value, price: Number(planForm.value.price || 0) }
if (planForm.value.trialDurationDays != null) {
  payload.trialDurationDays = Number(planForm.value.trialDurationDays)
}
```

**Step 2: Update plan listing to show all plans (including Trial)**

Currently the view shows only the default/system plan (line 58). Change the display to show ALL plans in a list/table instead of just `plan.value`.

Replace the SECTION 1 card body content. Instead of showing a single plan, show a list of plans. The Trial plan should show a "Trial" badge.

In the `<template>` section, replace the plan display section (lines 264-372) with:

```html
<!-- ====== SECTION 1: Plans ====== -->
<div class="card mb-4">
  <div class="card-header d-flex justify-content-between align-items-center">
    <h5 class="mb-0"><i class="bi bi-list-check me-2"></i>Planos</h5>
    <button v-if="!showPlanForm" class="btn btn-sm btn-primary" @click="showPlanForm = true; editingPlanId = null; planForm = emptyPlanForm()">
      <i class="bi bi-plus-lg me-1"></i>Novo plano
    </button>
  </div>
  <div class="card-body">
    <!-- Plan Form -->
    <div v-if="showPlanForm" class="border border-primary rounded p-3 mb-3">
      <h6>{{ editingPlanId ? 'Editar plano' : 'Novo plano' }}</h6>
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">Nome do plano</label>
          <input v-model="planForm.name" class="form-control" placeholder="Ex: Básico, Pro, Enterprise" />
        </div>
        <div class="col-md-6">
          <label class="form-label">Preço padrão (R$)</label>
          <input v-model.number="planForm.price" type="number" step="0.01" class="form-control" />
          <small class="text-muted">Usado se não houver preços por período</small>
        </div>
      </div>

      <!-- Trial duration (only shown for trial plans) -->
      <div v-if="editingPlanId && plans.find(p => p.id === editingPlanId)?.isTrial" class="row g-3 mt-2">
        <div class="col-md-4">
          <label class="form-label">Duração do Trial (dias)</label>
          <input v-model.number="planForm.trialDurationDays" type="number" min="1" class="form-control" />
          <small class="text-muted">Período gratuito antes da cobrança</small>
        </div>
      </div>

      <!-- Preços por período -->
      <div class="mt-3">
        <label class="form-label">Preços por período</label>
        <div v-for="(pr, idx) in planForm.prices" :key="idx" class="d-flex gap-2 mb-2 align-items-center">
          <select v-model="pr.period" class="form-select" style="max-width: 160px;">
            <option v-for="opt in PERIOD_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <div class="input-group" style="max-width: 200px;">
            <span class="input-group-text">R$</span>
            <input v-model.number="pr.price" type="number" step="0.01" class="form-control" />
          </div>
          <button class="btn btn-outline-danger btn-sm" @click.prevent="planForm.prices.splice(idx,1)">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <button class="btn btn-sm btn-outline-primary" @click.prevent="planForm.prices.push({ period: 'MONTHLY', price: 0 })">
          <i class="bi bi-plus me-1"></i>Adicionar período
        </button>
      </div>

      <!-- Módulos do plano -->
      <div class="mt-3">
        <label class="form-label">Módulos incluídos</label>
        <div class="d-flex flex-wrap gap-2">
          <div v-for="mod in modules" :key="mod.id" class="form-check">
            <input
              class="form-check-input"
              type="checkbox"
              :id="'planmod-' + mod.id"
              :value="mod.id"
              v-model="planForm.moduleIds"
            />
            <label class="form-check-label" :for="'planmod-' + mod.id">{{ mod.name }}</label>
          </div>
        </div>
      </div>

      <!-- Limites -->
      <div class="row g-3 mt-2">
        <div class="col-md-3">
          <label class="form-label">Limite de cardápios</label>
          <input v-model.number="planForm.menuLimit" type="number" min="0" class="form-control" :disabled="planForm.unlimitedMenus" />
        </div>
        <div class="col-md-3">
          <label class="form-label">Limite de lojas</label>
          <input v-model.number="planForm.storeLimit" type="number" min="0" class="form-control" :disabled="planForm.unlimitedStores" />
        </div>
        <div class="col-md-6 d-flex align-items-end gap-3">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" v-model="planForm.unlimitedMenus" id="chkMenus" />
            <label class="form-check-label" for="chkMenus">Cardápios ilimitados</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="checkbox" v-model="planForm.unlimitedStores" id="chkStores" />
            <label class="form-check-label" for="chkStores">Lojas ilimitadas</label>
          </div>
        </div>
      </div>

      <!-- Creditos de IA -->
      <div class="row g-3 mt-2">
        <div class="col-md-3">
          <label class="form-label">Créditos de IA / mês</label>
          <input v-model.number="planForm.aiCreditsMonthlyLimit" type="number" min="0" class="form-control" :disabled="planForm.unlimitedAiCredits" />
        </div>
        <div class="col-md-6 d-flex align-items-end">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" v-model="planForm.unlimitedAiCredits" id="chkAiCredits" />
            <label class="form-check-label" for="chkAiCredits">Créditos IA ilimitados</label>
          </div>
        </div>
      </div>

      <div class="mt-3 d-flex gap-2">
        <button class="btn btn-primary" @click="savePlan">
          <i class="bi bi-check-lg me-1"></i>Salvar
        </button>
        <button class="btn btn-outline-secondary" @click="cancelPlanForm">Cancelar</button>
      </div>
    </div>

    <!-- Plans list -->
    <div v-if="plans.length === 0 && !showPlanForm" class="text-center py-3 text-muted">
      <p>Nenhum plano cadastrado.</p>
    </div>
    <div v-else class="row g-3">
      <div v-for="p in plans" :key="p.id" class="col-md-6 col-lg-4">
        <div class="card h-100" :class="{ 'border-info': p.isTrial }">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div>
                <h6 class="mb-0">{{ p.name }}</h6>
                <div class="d-flex gap-1 mt-1">
                  <span v-if="p.isSystem" class="badge bg-secondary">Sistema</span>
                  <span v-if="p.isDefault" class="badge bg-primary">Padrão</span>
                  <span v-if="p.isTrial" class="badge bg-info">Trial</span>
                  <span v-if="!p.isActive" class="badge bg-warning text-dark">Inativo</span>
                </div>
              </div>
              <span class="h6 mb-0 text-primary">R$ {{ Number(p.price).toFixed(2) }}</span>
            </div>
            <div class="small text-muted mb-2">
              <span class="me-2"><i class="bi bi-journal-text me-1"></i>{{ p.unlimitedMenus ? 'Ilimitado' : (p.menuLimit ?? '--') }}</span>
              <span class="me-2"><i class="bi bi-shop me-1"></i>{{ p.unlimitedStores ? 'Ilimitado' : (p.storeLimit ?? '--') }}</span>
              <span><i class="bi bi-stars me-1"></i>{{ p.unlimitedAiCredits ? 'Ilimitado' : ((p.aiCreditsMonthlyLimit ?? 100) + ' cr/mês') }}</span>
            </div>
            <div v-if="p.isTrial && p.trialDurationDays" class="small text-info mb-2">
              <i class="bi bi-clock me-1"></i>{{ p.trialDurationDays }} dias de trial
            </div>
            <div v-if="p.modules && p.modules.length" class="mb-2">
              <span v-for="pm in p.modules" :key="pm.moduleId" class="badge bg-light text-dark border me-1 mb-1">
                {{ pm.module?.name || pm.moduleId }}
              </span>
            </div>
            <div v-if="p.prices && p.prices.length" class="mb-2">
              <span v-for="pr in p.prices" :key="pr.id" class="badge bg-info text-dark me-1">
                {{ periodLabel(pr.period) }}: R$ {{ Number(pr.price).toFixed(2) }}
              </span>
            </div>
            <div class="d-flex gap-1 mt-2">
              <button class="btn btn-sm btn-outline-primary" @click="openEditPlan(p)">
                <i class="bi bi-pencil me-1"></i>Editar
              </button>
              <button v-if="!p.isSystem" class="btn btn-sm btn-outline-danger" @click="deletePlan(p)">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

**Step 3: Add moduleIds to planForm and openEditPlan**

Update `emptyPlanForm`:
```javascript
const emptyPlanForm = () => ({ name: '', price: 0, menuLimit: null, storeLimit: null, unlimitedMenus: false, unlimitedStores: false, aiCreditsMonthlyLimit: 100, unlimitedAiCredits: false, prices: [], trialDurationDays: null, moduleIds: [] })
```

Update `openEditPlan`:
```javascript
function openEditPlan(p) {
  editingPlanId.value = p.id
  planForm.value = {
    name: p.name,
    price: Number(p.price || 0),
    menuLimit: p.menuLimit,
    storeLimit: p.storeLimit,
    unlimitedMenus: p.unlimitedMenus || false,
    unlimitedStores: p.unlimitedStores || false,
    aiCreditsMonthlyLimit: p.aiCreditsMonthlyLimit ?? 100,
    unlimitedAiCredits: p.unlimitedAiCredits || false,
    prices: (p.prices || []).map(pr => ({ period: pr.period, price: String(Number(pr.price || 0)) })),
    trialDurationDays: p.trialDurationDays ?? null,
    moduleIds: (p.modules || []).map(pm => pm.moduleId || pm.module?.id).filter(Boolean)
  }
  showPlanForm.value = true
}
```

Update `savePlan` to include moduleIds in payload:
```javascript
async function savePlan() {
  if (!planForm.value.name) return
  const payload = { ...planForm.value, price: Number(planForm.value.price || 0) }
  if (Array.isArray(payload.prices)) payload.prices = payload.prices.map(p => ({ period: p.period, price: String(Number(p.price || 0)) }))
  if (payload.trialDurationDays != null) payload.trialDurationDays = Number(payload.trialDurationDays)
  try {
    if (editingPlanId.value) {
      await api.put(`/saas/plans/${editingPlanId.value}`, payload)
    } else {
      await api.post('/saas/plans', payload)
    }
    showPlanForm.value = false
    editingPlanId.value = null
    await loadAll()
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao salvar' })
  }
}
```

**Step 4: Add deletePlan function**

```javascript
async function deletePlan(p) {
  if (p.isSystem) return
  const result = await Swal.fire({
    title: `Remover "${p.name}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar'
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/saas/plans/${p.id}`)
    await loadAll()
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao remover plano' })
  }
}
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasPlans.vue
git commit -m "feat(frontend): update SaasPlans to show all plans with trial badge and duration field"
```

---

### Task 7: Frontend — SaasCompanies.vue — Trial Badge and Reset Button

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasCompanies.vue`

**Step 1: Add resetTrial function**

After the `changePassword` function (line ~228), add:

```javascript
async function resetTrial(c) {
  const result = await Swal.fire({
    title: `Resetar trial de "${c.name}"?`,
    text: 'O trial atual será cancelado (se ativo) e a empresa poderá ativar novamente.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Sim, resetar',
    cancelButtonText: 'Cancelar'
  })
  if (!result.isConfirmed) return
  try {
    await api.post(`/saas/companies/${c.id}/reset-trial`)
    await load()
    Swal.fire({ icon: 'success', title: 'Trial resetado', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Falha ao resetar trial' })
  }
}
```

**Step 2: Add trial badge in the table Plano column**

Replace the Plano `<td>` (line 309-312):

```html
<td>
  <span v-if="c.saasSubscription?.plan" class="fw-medium">{{ c.saasSubscription.plan.name }}</span>
  <span v-else class="text-muted">—</span>
  <div v-if="c.companyTrials && c.companyTrials.length > 0" class="mt-1">
    <span class="badge bg-info">
      <i class="bi bi-clock me-1"></i>Trial
      ({{ Math.max(0, Math.ceil((new Date(c.companyTrials[0].expiresAt) - new Date()) / 86400000)) }}d restantes)
    </span>
  </div>
</td>
```

**Step 3: Add Reset Trial button in the actions column**

In the `btn-group` (line 322-344), add a new button after the suspend button and before the delete button:

```html
<button
  class="btn btn-outline-info"
  @click="resetTrial(c)"
  title="Resetar Trial"
>
  <i class="bi bi-arrow-counterclockwise"></i>
</button>
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasCompanies.vue
git commit -m "feat(frontend): add trial badge and reset button to SaasCompanies"
```

---

### Task 8: Frontend — Saas Store — Add Trial Getters

**Files:**
- Modify: `delivery-saas-frontend/src/stores/saas.js`

**Step 1: Add trial-related getters**

In the `getters` section (after `isCardapioSimplesOnly` getter at line ~30), add:

```javascript
    ,
    isOnTrial: (s) => {
      return s.subscription?.activeTrial?.status === 'ACTIVE' || false
    },
    trialDaysRemaining: (s) => {
      const trial = s.subscription?.activeTrial
      if (!trial || trial.status !== 'ACTIVE') return 0
      const diff = new Date(trial.expiresAt) - new Date()
      return Math.max(0, Math.ceil(diff / 86400000))
    }
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/stores/saas.js
git commit -m "feat(store): add isOnTrial and trialDaysRemaining getters"
```

---

### Task 9: Backend — POST /plans should accept isTrial and trialDurationDays

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js:74-93`

**Step 1: Update POST /plans to accept trial fields**

In the destructuring of POST /plans (line 75):

```javascript
const { name, price = 0, menuLimit = null, storeLimit = null, unlimitedMenus = false, unlimitedStores = false, aiCreditsMonthlyLimit = 100, unlimitedAiCredits = false, moduleIds = [], isTrial = false, trialDurationDays = null } = req.body || {}
```

In the `prisma.saasPlan.create` data (line 78), add:

```javascript
isTrial: Boolean(isTrial), ...(trialDurationDays != null && { trialDurationDays: Number(trialDurationDays) })
```

**Step 2: Update DELETE /plans to also prevent deleting trial system plans**

The existing check `if (plan.isSystem)` at line 133 already covers this since the Trial plan has `isSystem: true`. No change needed.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(api): accept isTrial and trialDurationDays in POST /plans"
```

---

### Task 10: Integration Test — Verify Full Trial Lifecycle

**Files:**
- No new files — manual testing via API

**Step 1: Start the dev environment**

Run: `docker compose up -d`

**Step 2: Run the seed**

Run: `docker compose exec backend node scripts/seed_saas.mjs`
Expected: Trial plan created

**Step 3: Test trial eligibility**

As ADMIN user, call:
```
GET /saas/trial/eligibility
```
Expected: `{ eligible: false, reason: "Plano trial não disponível" }` (trial plan starts inactive)

**Step 4: Activate trial plan via SUPER_ADMIN**

As SUPER_ADMIN:
```
PUT /saas/plans/<trial-plan-id>  { isActive: true, trialDurationDays: 7, moduleIds: [...] }
```

**Step 5: Test trial activation**

As ADMIN:
```
POST /saas/trial/activate
```
Expected: 201 with CompanyTrial record

**Step 6: Verify subscription changed**

```
GET /saas/subscription/me
```
Expected: plan is now Trial, activeTrial present

**Step 7: Test expire-trials job**

As SUPER_ADMIN:
```
POST /saas/jobs/expire-trials
```
(For testing, temporarily set expiresAt to past)

**Step 8: Test reset-trial**

As SUPER_ADMIN:
```
POST /saas/companies/<id>/reset-trial
```
Expected: Trial deleted, company can re-activate

**Step 9: Commit any fixes**

```bash
git add -A
git commit -m "fix: trial lifecycle integration fixes"
```
