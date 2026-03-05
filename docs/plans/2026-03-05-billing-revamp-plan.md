# Billing Revamp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the multi-plan billing system with a single basic plan + purchasable add-on modules, credit packs, and a gateway-agnostic payment layer.

**Architecture:** Evolve the existing Prisma schema by adding new models (SaasModulePrice, SaasModuleSubscription, AiCreditPack, AiCreditPurchase, SaasInvoiceItem, SaasPayment) while keeping SaasPlan simplified for a single plan. Backend routes added for module subscriptions, credit packs, store API, and payment webhooks. Frontend gets three new views (AddOnStore, AddOnDetail, CreditPackStore) and modifications to Sidebar, nav config, and existing stores.

**Tech Stack:** Express.js, Prisma ORM, PostgreSQL, Vue 3, Pinia, Vite

**Design doc:** `docs/plans/2026-03-05-billing-revamp-design.md`

---

## Task 1: Add New Prisma Models

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma:843-963` (add new models after existing SaaS models)

**Step 1: Add SaasModulePrice model**

After `SaasModule` model (line 852), add a relation to it. Then add the new model after `SaasPlanModule` (line 898):

```prisma
model SaasModulePrice {
  id        String     @id @default(uuid())
  moduleId  String
  module    SaasModule @relation(fields: [moduleId], references: [id])
  period    String     // MONTHLY, ANNUAL
  price     Decimal
  createdAt DateTime   @default(now())

  @@unique([moduleId, period])
}
```

Add `prices SaasModulePrice[]` relation to `SaasModule` (line 851, alongside `plans`).

**Step 2: Add SaasModuleSubscription model**

```prisma
model SaasModuleSubscription {
  id         String     @id @default(uuid())
  companyId  String
  company    Company    @relation(fields: [companyId], references: [id])
  moduleId   String
  module     SaasModule @relation(fields: [moduleId], references: [id])
  status     String     @default("ACTIVE") // ACTIVE, CANCELED, SUSPENDED
  period     String     // MONTHLY, ANNUAL
  startedAt  DateTime   @default(now())
  nextDueAt  DateTime
  canceledAt DateTime?
  createdAt  DateTime   @default(now())

  @@unique([companyId, moduleId])
}
```

Add `subscriptions SaasModuleSubscription[]` relation to `SaasModule`.
Add `moduleSubscriptions SaasModuleSubscription[]` relation to `Company` model (around line 74).

**Step 3: Add AiCreditPack and AiCreditPurchase models**

```prisma
model AiCreditPack {
  id        String             @id @default(uuid())
  name      String
  credits   Int
  price     Decimal
  isActive  Boolean            @default(true)
  sortOrder Int                @default(0)
  createdAt DateTime           @default(now())

  purchases AiCreditPurchase[]
}

model AiCreditPurchase {
  id         String       @id @default(uuid())
  companyId  String
  company    Company      @relation(fields: [companyId], references: [id])
  packId     String
  pack       AiCreditPack @relation(fields: [packId], references: [id])
  credits    Int
  amount     Decimal
  paymentRef String?
  createdAt  DateTime     @default(now())
}
```

Add `aiCreditPurchases AiCreditPurchase[]` relation to `Company` model.

**Step 4: Add SaasInvoiceItem model**

```prisma
model SaasInvoiceItem {
  id          String      @id @default(uuid())
  invoiceId   String
  invoice     SaasInvoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  type        String      // PLAN, MODULE, CREDIT_PACK
  referenceId String
  description String
  amount      Decimal
}
```

Add `items SaasInvoiceItem[]` relation to `SaasInvoice` (around line 931).

**Step 5: Add SaasPayment model**

```prisma
model SaasPayment {
  id         String       @id @default(uuid())
  companyId  String
  company    Company      @relation(fields: [companyId], references: [id])
  invoiceId  String?
  invoice    SaasInvoice? @relation(fields: [invoiceId], references: [id])
  amount     Decimal
  status     String       @default("PENDING") // PENDING, PROCESSING, PAID, FAILED, REFUNDED
  gateway    String       @default("manual")
  gatewayRef String?
  method     String?      // PIX, BOLETO, CREDIT_CARD
  paidAt     DateTime?
  metadata   Json?
  createdAt  DateTime     @default(now())
}
```

Add `payments SaasPayment[]` relation to `Company` model.
Add `payments SaasPayment[]` relation to `SaasInvoice` model.

**Step 6: Push schema to database**

Run: `cd delivery-saas-backend && npx prisma db push`

Expected: Schema changes applied successfully, no data loss (only new tables/columns).

**Step 7: Regenerate Prisma client**

Run: `cd delivery-saas-backend && npx prisma generate`

Expected: Prisma client generated successfully.

**Step 8: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "schema: add billing revamp models (ModulePrice, ModuleSubscription, CreditPack, Payment, InvoiceItem)"
```

---

## Task 2: Backend — Module Pricing API

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js:23-54` (modules CRUD section)

**Step 1: Modify GET /saas/modules to include prices**

In `saas.js` line 24, change the `findMany` to include the new `prices` relation:

```javascript
// Line 24: Replace existing query
const rows = await prisma.saasModule.findMany({
  orderBy: { name: 'asc' },
  include: { prices: true }
})
```

**Step 2: Modify PUT /saas/modules/:id to accept prices**

In `saas.js` lines 39-48, expand the handler to also manage `SaasModulePrice` records:

```javascript
saasRouter.put('/modules/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { name, description, isActive, prices } = req.body || {}
  try {
    const updated = await prisma.saasModule.update({
      where: { id },
      data: { name, description, isActive }
    })
    // Replace prices if provided
    if (Array.isArray(prices)) {
      await prisma.saasModulePrice.deleteMany({ where: { moduleId: id } })
      if (prices.length) {
        const priceData = prices.map(p => ({
          moduleId: id,
          period: String(p.period || '').toUpperCase(),
          price: String(p.price || 0)
        }))
        await prisma.saasModulePrice.createMany({ data: priceData })
      }
    }
    const result = await prisma.saasModule.findUnique({
      where: { id },
      include: { prices: true }
    })
    res.json(result)
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao atualizar módulo', error: e?.message || String(e) })
  }
})
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(saas): add module pricing to GET/PUT /saas/modules"
```

---

## Task 3: Backend — Module Subscriptions API

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js` (add new routes after modules/me section, around line 217)
- Create: `delivery-saas-backend/src/services/proRation.js`

**Step 1: Create pro-ration utility**

```javascript
// delivery-saas-backend/src/services/proRation.js

/**
 * Calculate pro-rated price for a subscription starting mid-cycle.
 * @param {number} fullPrice - Full period price
 * @param {string} period - MONTHLY or ANNUAL
 * @param {Date} startDate - When the subscription starts
 * @returns {{ proRatedPrice: number, nextDueAt: Date }}
 */
export function calculateProRation(fullPrice, period, startDate = new Date()) {
  const start = new Date(startDate)
  const periodMonths = period === 'ANNUAL' ? 12 : 1
  const nextDueAt = new Date(start)
  nextDueAt.setMonth(nextDueAt.getMonth() + periodMonths)

  // For the first cycle, pro-rate based on remaining days
  const totalDays = Math.ceil((nextDueAt - start) / (1000 * 60 * 60 * 24))
  const endOfCurrentCycle = new Date(start)
  endOfCurrentCycle.setMonth(endOfCurrentCycle.getMonth() + periodMonths)
  const remainingDays = Math.ceil((endOfCurrentCycle - start) / (1000 * 60 * 60 * 24))

  const proRatedPrice = Number(((fullPrice / totalDays) * remainingDays).toFixed(2))

  return { proRatedPrice, nextDueAt }
}
```

**Step 2: Add module subscription routes to saas.js**

Add these routes after the `GET /saas/modules/me` endpoint (after line 217):

```javascript
import { calculateProRation } from '../services/proRation.js'

// -------- Module Subscriptions (Admin self-service) --------

// List company's active module subscriptions
saasRouter.get('/module-subscriptions/me', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  try {
    const subs = await prisma.saasModuleSubscription.findMany({
      where: { companyId, status: 'ACTIVE' },
      include: { module: { include: { prices: true } } }
    })
    res.json(subs)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar assinaturas de módulos', error: e?.message })
  }
})

// Subscribe to a module
saasRouter.post('/module-subscriptions', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { moduleId, period = 'MONTHLY' } = req.body || {}
  if (!moduleId) return res.status(400).json({ message: 'moduleId é obrigatório' })

  try {
    // Check if already subscribed
    const existing = await prisma.saasModuleSubscription.findUnique({
      where: { companyId_moduleId: { companyId, moduleId } }
    })
    if (existing && existing.status === 'ACTIVE') {
      return res.status(409).json({ message: 'Já assinado este módulo' })
    }

    // Get module price
    const modulePrice = await prisma.saasModulePrice.findUnique({
      where: { moduleId_period: { moduleId, period: period.toUpperCase() } }
    })
    if (!modulePrice) {
      return res.status(400).json({ message: 'Preço não disponível para este período' })
    }

    const now = new Date()
    const { proRatedPrice, nextDueAt } = calculateProRation(
      Number(modulePrice.price), period.toUpperCase(), now
    )

    // Create or reactivate subscription
    const moduleSub = existing
      ? await prisma.saasModuleSubscription.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', period: period.toUpperCase(), startedAt: now, nextDueAt, canceledAt: null }
        })
      : await prisma.saasModuleSubscription.create({
          data: { companyId, moduleId, period: period.toUpperCase(), nextDueAt }
        })

    // Create pro-rated invoice
    const companySub = await prisma.saasSubscription.findUnique({ where: { companyId } })
    if (companySub) {
      const mod = await prisma.saasModule.findUnique({ where: { id: moduleId } })
      const invoice = await prisma.saasInvoice.create({
        data: {
          subscriptionId: companySub.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          amount: String(proRatedPrice),
          dueDate: now,
          items: {
            create: [{
              type: 'MODULE',
              referenceId: moduleId,
              description: `Add-on: ${mod?.name || moduleId} (pro-rata)`,
              amount: String(proRatedPrice)
            }]
          }
        }
      })

      // Create pending payment record
      await prisma.saasPayment.create({
        data: {
          companyId,
          invoiceId: invoice.id,
          amount: String(proRatedPrice),
          gateway: 'manual'
        }
      })
    }

    res.status(201).json(moduleSub)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao assinar módulo', error: e?.message || String(e) })
  }
})

// Cancel module subscription (effective at end of period)
saasRouter.delete('/module-subscriptions/:moduleId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { moduleId } = req.params
  try {
    const sub = await prisma.saasModuleSubscription.findUnique({
      where: { companyId_moduleId: { companyId, moduleId } }
    })
    if (!sub) return res.status(404).json({ message: 'Assinatura não encontrada' })

    const updated = await prisma.saasModuleSubscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELED', canceledAt: new Date() }
    })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao cancelar módulo', error: e?.message || String(e) })
  }
})
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/services/proRation.js delivery-saas-backend/src/routes/saas.js
git commit -m "feat(saas): add module subscription routes with pro-ration"
```

---

## Task 4: Backend — Store API & Module Visibility Update

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js:201-217` (GET /modules/me)
- Add store route to same file

**Step 1: Add GET /saas/store/modules route**

Add after the module subscription routes:

```javascript
// -------- Module Store (for Admin) --------
saasRouter.get('/store/modules', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  try {
    const modules = await prisma.saasModule.findMany({
      where: { isActive: true },
      include: { prices: true },
      orderBy: { name: 'asc' }
    })
    // Get company's active subscriptions
    const activeSubs = await prisma.saasModuleSubscription.findMany({
      where: { companyId, status: 'ACTIVE' }
    })
    const activeModuleIds = new Set(activeSubs.map(s => s.moduleId))

    const result = modules.map(m => ({
      id: m.id,
      key: m.key,
      name: m.name,
      description: m.description,
      prices: m.prices,
      isSubscribed: activeModuleIds.has(m.id),
      subscription: activeSubs.find(s => s.moduleId === m.id) || null
    }))
    res.json(result)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar módulos da loja', error: e?.message })
  }
})
```

**Step 2: Update GET /saas/modules/me to read from SaasModuleSubscription**

Replace lines 202-217 of `saas.js`:

```javascript
// Get enabled modules for current user's company (ADMIN)
saasRouter.get('/modules/me', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  try {
    // Read from module subscriptions (new model)
    const subs = await prisma.saasModuleSubscription.findMany({
      where: { companyId, status: 'ACTIVE' },
      include: { module: true }
    })
    const enabled = subs
      .filter(s => s.module && s.module.isActive !== false)
      .map(s => s.module.key)
    res.json({ companyId, enabled })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao obter módulos', error: e?.message || String(e) })
  }
})
```

**Step 3: Update backend module gating to use SaasModuleSubscription**

Modify `delivery-saas-backend/src/modules.js` lines 10-24 (`fetchEnabledModuleKeys`):

```javascript
async function fetchEnabledModuleKeys(companyId) {
  // Read from SaasModuleSubscription instead of plan modules
  const subs = await prisma.saasModuleSubscription.findMany({
    where: { companyId, status: 'ACTIVE' },
    include: { module: true }
  })
  const keys = new Set(
    subs
      .filter(s => s.module && s.module.isActive !== false)
      .map(s => String(s.module.key).toLowerCase())
  )
  return keys
}
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js delivery-saas-backend/src/modules.js
git commit -m "feat(saas): add store API, update modules/me to read from subscriptions"
```

---

## Task 5: Backend — AI Credit Packs API

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js` (add credit pack routes)

**Step 1: Add credit pack CRUD routes (Super Admin)**

Add after the store modules route:

```javascript
// -------- AI Credit Packs (SUPER_ADMIN) --------
saasRouter.get('/credit-packs', requireRole('SUPER_ADMIN'), async (_req, res) => {
  const packs = await prisma.aiCreditPack.findMany({ orderBy: { sortOrder: 'asc' } })
  res.json(packs)
})

saasRouter.post('/credit-packs', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { name, credits, price, isActive = true, sortOrder = 0 } = req.body || {}
  if (!name || !credits || price === undefined) {
    return res.status(400).json({ message: 'name, credits e price são obrigatórios' })
  }
  const pack = await prisma.aiCreditPack.create({
    data: { name, credits: Number(credits), price: String(price), isActive: Boolean(isActive), sortOrder: Number(sortOrder) }
  })
  res.status(201).json(pack)
})

saasRouter.put('/credit-packs/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { name, credits, price, isActive, sortOrder } = req.body || {}
  const pack = await prisma.aiCreditPack.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(credits !== undefined && { credits: Number(credits) }),
      ...(price !== undefined && { price: String(price) }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) })
    }
  })
  res.json(pack)
})

saasRouter.delete('/credit-packs/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  await prisma.aiCreditPack.delete({ where: { id: req.params.id } })
  res.json({ ok: true })
})
```

**Step 2: Add credit pack purchase routes (Admin)**

```javascript
// -------- AI Credit Pack Purchase (ADMIN) --------
saasRouter.get('/credit-packs/available', requireRole('ADMIN'), async (_req, res) => {
  const packs = await prisma.aiCreditPack.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' }
  })
  res.json(packs)
})

saasRouter.post('/credit-packs/purchase', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { packId } = req.body || {}
  if (!packId) return res.status(400).json({ message: 'packId é obrigatório' })

  try {
    const pack = await prisma.aiCreditPack.findUnique({ where: { id: packId } })
    if (!pack || !pack.isActive) {
      return res.status(404).json({ message: 'Pacote de créditos não encontrado' })
    }

    // Create purchase record
    const purchase = await prisma.aiCreditPurchase.create({
      data: {
        companyId,
        packId: pack.id,
        credits: pack.credits,
        amount: String(pack.price)
      }
    })

    // Create invoice for the credit pack
    const companySub = await prisma.saasSubscription.findUnique({ where: { companyId } })
    if (companySub) {
      const now = new Date()
      const invoice = await prisma.saasInvoice.create({
        data: {
          subscriptionId: companySub.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          amount: String(pack.price),
          dueDate: now,
          items: {
            create: [{
              type: 'CREDIT_PACK',
              referenceId: pack.id,
              description: `Pacote de créditos: ${pack.name} (${pack.credits} créditos)`,
              amount: String(pack.price)
            }]
          }
        }
      })

      // Create pending payment
      await prisma.saasPayment.create({
        data: {
          companyId,
          invoiceId: invoice.id,
          amount: String(pack.price),
          gateway: 'manual'
        }
      })
    }

    // Add credits to company balance immediately (for manual gateway)
    // For real gateways, this should happen in the webhook handler
    await prisma.company.update({
      where: { id: companyId },
      data: { aiCreditsBalance: { increment: pack.credits } }
    })

    res.status(201).json({ purchase, creditsAdded: pack.credits })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao comprar pacote de créditos', error: e?.message || String(e) })
  }
})
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(saas): add credit pack CRUD and purchase routes"
```

---

## Task 6: Backend — Payment Webhook & Invoice Updates

**Files:**
- Create: `delivery-saas-backend/src/routes/payment.js`
- Modify: `delivery-saas-backend/src/routes/saas.js` (invoice generation update)

**Step 1: Create payment webhook route**

```javascript
// delivery-saas-backend/src/routes/payment.js
import express from 'express'
import { prisma } from '../prisma.js'

export const paymentRouter = express.Router()

/**
 * POST /payment/webhook
 * Gateway-agnostic webhook handler.
 * Body: { paymentId, status, gatewayRef?, paidAt? }
 * In production, each gateway adapter will translate its payload to this format.
 */
paymentRouter.post('/webhook', async (req, res) => {
  const { paymentId, status, gatewayRef, paidAt } = req.body || {}
  if (!paymentId || !status) {
    return res.status(400).json({ message: 'paymentId e status são obrigatórios' })
  }

  try {
    const payment = await prisma.saasPayment.findUnique({
      where: { id: paymentId },
      include: { invoice: { include: { items: true } } }
    })
    if (!payment) return res.status(404).json({ message: 'Pagamento não encontrado' })

    // Update payment status
    await prisma.saasPayment.update({
      where: { id: paymentId },
      data: {
        status: status.toUpperCase(),
        gatewayRef: gatewayRef || payment.gatewayRef,
        paidAt: status.toUpperCase() === 'PAID' ? (paidAt ? new Date(paidAt) : new Date()) : payment.paidAt
      }
    })

    // On successful payment, process invoice items
    if (status.toUpperCase() === 'PAID' && payment.invoice) {
      // Mark invoice as paid
      await prisma.saasInvoice.update({
        where: { id: payment.invoice.id },
        data: { status: 'PAID', paidAt: new Date() }
      })

      // Process each invoice item
      for (const item of (payment.invoice.items || [])) {
        if (item.type === 'MODULE') {
          // Activate module subscription
          await prisma.saasModuleSubscription.updateMany({
            where: { companyId: payment.companyId, moduleId: item.referenceId },
            data: { status: 'ACTIVE' }
          })
        } else if (item.type === 'CREDIT_PACK') {
          // Credits already added for manual gateway; for real gateways, add here
          const pack = await prisma.aiCreditPack.findUnique({ where: { id: item.referenceId } })
          if (pack) {
            await prisma.company.update({
              where: { id: payment.companyId },
              data: { aiCreditsBalance: { increment: pack.credits } }
            })
          }
        }
      }
    }

    res.json({ ok: true })
  } catch (e) {
    console.error('[payment webhook]', e)
    res.status(500).json({ message: 'Erro no webhook de pagamento', error: e?.message })
  }
})
```

**Step 2: Register payment router in the app**

Find where routers are registered (likely `delivery-saas-backend/src/index.js` or `app.js`) and add:

```javascript
import { paymentRouter } from './routes/payment.js'
app.use('/payment', paymentRouter)
```

**Step 3: Update invoice generation job**

In `saas.js` lines 306-349, update the `POST /saas/jobs/generate-invoices` handler to include module subscription line items:

Replace the invoice creation inside the for loop (around line 334):

```javascript
// Build invoice items: plan + active module subscriptions
const modulesSubs = await prisma.saasModuleSubscription.findMany({
  where: { companyId: s.companyId, status: 'ACTIVE' },
  include: { module: { include: { prices: true } } }
})

let totalAmount = Number(amount)
const invoiceItems = [{
  type: 'PLAN',
  referenceId: s.planId,
  description: `Plano: ${s.plan?.name || 'Básico'}`,
  amount: String(amount)
}]

for (const ms of modulesSubs) {
  const modulePrice = ms.module?.prices?.find(
    p => String(p.period).toUpperCase() === String(ms.period).toUpperCase()
  )
  if (modulePrice) {
    totalAmount += Number(modulePrice.price)
    invoiceItems.push({
      type: 'MODULE',
      referenceId: ms.moduleId,
      description: `Add-on: ${ms.module?.name || ms.moduleId}`,
      amount: String(modulePrice.price)
    })
  }
}

await prisma.saasInvoice.create({
  data: {
    subscriptionId: s.id,
    year, month,
    amount: String(totalAmount),
    dueDate: invoiceDate,
    items: { create: invoiceItems }
  }
})
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/payment.js delivery-saas-backend/src/routes/saas.js
git commit -m "feat(saas): add payment webhook, update invoice generation with line items"
```

---

## Task 7: Backend — AI Credits System Changes

**Files:**
- Modify: `delivery-saas-backend/src/services/aiCreditManager.js:83-122,252-275`
- Modify: `delivery-saas-backend/src/routes/saas.js` (subscription creation)

**Step 1: Grant initial AI credits on basic plan subscription**

In `saas.js`, in the `POST /saas/subscriptions` handler (around line 129), after creating the subscription, add initial credit grant:

```javascript
// After subscription creation (around line 157), add:
// Grant initial AI credits
try {
  const plan = await prisma.saasPlan.findUnique({ where: { id: String(planId) } })
  if (plan && plan.aiCreditsMonthlyLimit > 0) {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        aiCreditsBalance: plan.aiCreditsMonthlyLimit,
        aiCreditsLastReset: new Date()
      }
    })
  }
} catch (ce) {
  console.error('Initial credit grant error', ce)
}
```

**Step 2: Remove monthly reset logic from aiCreditManager.js**

In `aiCreditManager.js`, modify `resetAllDueCredits()` (lines 252-275) to be a no-op or remove it:

```javascript
/**
 * Monthly reset is deprecated in the new billing model.
 * Credits are now granted once on subscription + purchased via credit packs.
 * This function is kept as a no-op for backward compatibility.
 */
export async function resetAllDueCredits() {
  console.log('[aiCreditManager] resetAllDueCredits: no-op (new billing model)')
  return { reset: 0 }
}
```

**Step 3: Update getBalance to not reference monthly limits**

In `aiCreditManager.js` `getBalance()` (lines 83-122), simplify to not auto-initialize from monthly limit:

```javascript
export async function getBalance(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      aiCreditsBalance: true,
      aiCreditsLastReset: true,
      saasSubscription: {
        select: {
          plan: {
            select: { aiCreditsMonthlyLimit: true, unlimitedAiCredits: true }
          }
        }
      }
    }
  })
  if (!company) return null

  const plan = company.saasSubscription?.plan
  return {
    balance: company.aiCreditsBalance,
    initialBalance: plan?.aiCreditsMonthlyLimit ?? 0,
    unlimitedAiCredits: plan?.unlimitedAiCredits ?? false,
    lastReset: company.aiCreditsLastReset
  }
}
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/services/aiCreditManager.js delivery-saas-backend/src/routes/saas.js
git commit -m "feat(saas): grant initial credits on subscription, remove monthly reset"
```

---

## Task 8: Frontend — New Add-on Store (Pinia)

**Files:**
- Create: `delivery-saas-frontend/src/stores/addOnStore.js`

**Step 1: Create the store**

```javascript
// delivery-saas-frontend/src/stores/addOnStore.js
import { defineStore } from 'pinia'
import api from '../api'

export const useAddOnStoreStore = defineStore('addOnStore', {
  state: () => ({
    modules: [],
    creditPacks: [],
    loading: false,
    error: null
  }),

  actions: {
    async fetchStoreModules() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/saas/store/modules')
        this.modules = data
      } catch (e) {
        this.error = e?.response?.data?.message || 'Erro ao carregar módulos'
      } finally {
        this.loading = false
      }
    },

    async fetchCreditPacks() {
      try {
        const { data } = await api.get('/saas/credit-packs/available')
        this.creditPacks = data
      } catch (e) {
        this.error = e?.response?.data?.message || 'Erro ao carregar pacotes'
      }
    },

    async subscribeToModule(moduleId, period = 'MONTHLY') {
      const { data } = await api.post('/saas/module-subscriptions', { moduleId, period })
      await this.fetchStoreModules()
      return data
    },

    async cancelModuleSubscription(moduleId) {
      const { data } = await api.delete(`/saas/module-subscriptions/${moduleId}`)
      await this.fetchStoreModules()
      return data
    },

    async purchaseCreditPack(packId) {
      const { data } = await api.post('/saas/credit-packs/purchase', { packId })
      return data
    }
  }
})
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/stores/addOnStore.js
git commit -m "feat(frontend): add Pinia store for add-on marketplace"
```

---

## Task 9: Frontend — Update Existing Stores

**Files:**
- Modify: `delivery-saas-frontend/src/stores/modules.js:18-40` (fetchEnabled)
- Modify: `delivery-saas-frontend/src/stores/saas.js:10-24` (enabledModules getter)
- Modify: `delivery-saas-frontend/src/stores/aiCredits.js` (remove reset references)

**Step 1: Update modules.js fetchEnabled**

The `fetchEnabled` action already calls `GET /saas/modules/me` which we updated in Task 4 to read from `SaasModuleSubscription`. No changes needed to this store — the backend change is transparent.

**Step 2: Update saas.js enabledModules getter**

In `saas.js`, the `enabledModules` getter currently reads from `subscription.plan.modules`. Update it to also fetch from module subscriptions:

```javascript
// In saas.js getters, update enabledModules:
enabledModules(state) {
  // Primary source: modules store (which now reads from SaasModuleSubscription via /modules/me)
  // This getter is kept for backward compatibility but the modules store is the source of truth
  if (!state.subscription?.plan?.modules) return []
  return state.subscription.plan.modules.map(pm => pm.module?.key).filter(Boolean)
}
```

Actually, since `Sidebar.vue` uses `saas.enabledModules` in `buildVisibleNav`, and the modules store is the one that calls `/modules/me`, we need to update Sidebar to use the modules store instead. Let's handle this in Task 11.

**Step 3: Update aiCredits.js to remove monthly reset references**

In `aiCredits.js`, rename `monthlyLimit` to `initialBalance` and update `nextResetFormatted` to show it's informational only:

```javascript
// In the fetch() function, update the response mapping:
// Change: store.monthlyLimit = data.monthlyLimit
// To: store.initialBalance = data.initialBalance || data.monthlyLimit || 0
```

This is a minor naming change. The widget will need updating too (Task 13).

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/stores/saas.js delivery-saas-frontend/src/stores/aiCredits.js
git commit -m "feat(frontend): update stores for new billing model"
```

---

## Task 10: Frontend — AddOnStore.vue (Central Marketplace)

**Files:**
- Create: `delivery-saas-frontend/src/views/AddOnStore.vue`

**Step 1: Create the marketplace view**

```vue
<template>
  <div class="container-fluid py-4">
    <h3 class="mb-4">Loja de Add-ons</h3>

    <!-- Period toggle -->
    <div class="btn-group mb-4">
      <button
        class="btn btn-sm"
        :class="period === 'MONTHLY' ? 'btn-primary' : 'btn-outline-secondary'"
        @click="period = 'MONTHLY'"
      >Mensal</button>
      <button
        class="btn btn-sm"
        :class="period === 'ANNUAL' ? 'btn-primary' : 'btn-outline-secondary'"
        @click="period = 'ANNUAL'"
      >Anual</button>
    </div>

    <div v-if="store.loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <div v-else class="row g-4">
      <div v-for="mod in store.modules" :key="mod.id" class="col-md-6 col-lg-4">
        <div class="card h-100" :class="{ 'border-success': mod.isSubscribed }">
          <div class="card-body d-flex flex-column">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <h5 class="card-title mb-0">{{ mod.name }}</h5>
              <span v-if="mod.isSubscribed" class="badge bg-success">Ativo</span>
            </div>
            <p class="card-text text-muted flex-grow-1">{{ mod.description || 'Módulo adicional' }}</p>
            <div class="mt-auto">
              <div class="mb-3">
                <span class="fs-4 fw-bold text-primary">
                  R$ {{ getPrice(mod, period) }}
                </span>
                <span class="text-muted">/{{ period === 'MONTHLY' ? 'mês' : 'ano' }}</span>
              </div>
              <router-link
                v-if="!mod.isSubscribed"
                :to="`/store/${mod.key.toLowerCase()}`"
                class="btn btn-primary w-100"
              >Ver detalhes</router-link>
              <router-link
                v-else
                :to="`/store/${mod.key.toLowerCase()}`"
                class="btn btn-outline-secondary w-100"
              >Gerenciar</router-link>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Credit Packs section -->
    <h4 class="mt-5 mb-3">Créditos de IA</h4>
    <router-link to="/store/credits" class="btn btn-outline-primary">
      Comprar créditos de IA
    </router-link>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAddOnStoreStore } from '../stores/addOnStore'

const store = useAddOnStoreStore()
const period = ref('MONTHLY')

function getPrice(mod, period) {
  const p = mod.prices?.find(p => p.period === period)
  return p ? Number(p.price).toFixed(2) : '—'
}

onMounted(() => {
  store.fetchStoreModules()
})
</script>
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/AddOnStore.vue
git commit -m "feat(frontend): add AddOnStore marketplace view"
```

---

## Task 11: Frontend — AddOnDetail.vue (Individual Add-on Page)

**Files:**
- Create: `delivery-saas-frontend/src/views/AddOnDetail.vue`

**Step 1: Create the detail view**

```vue
<template>
  <div class="container py-4" style="max-width: 800px;">
    <router-link to="/store" class="text-decoration-none mb-3 d-inline-block">
      &larr; Voltar para a Loja
    </router-link>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <div v-else-if="mod">
      <h2 class="mb-2">{{ mod.name }}</h2>
      <p class="text-muted mb-4">{{ mod.description || 'Módulo adicional para sua plataforma' }}</p>

      <!-- Status badge -->
      <div v-if="mod.isSubscribed" class="alert alert-success d-flex align-items-center">
        <i class="bi bi-check-circle-fill me-2"></i>
        <span>Este módulo está ativo na sua conta.</span>
      </div>

      <!-- Pricing -->
      <div class="card mb-4">
        <div class="card-body">
          <h5 class="card-title">Escolha seu plano</h5>
          <div class="row g-3 mt-2">
            <div v-for="p in mod.prices" :key="p.period" class="col-md-6">
              <div
                class="border rounded p-3 text-center cursor-pointer"
                :class="{ 'border-primary bg-light': selectedPeriod === p.period }"
                @click="selectedPeriod = p.period"
                role="button"
              >
                <div class="fs-3 fw-bold text-primary">R$ {{ Number(p.price).toFixed(2) }}</div>
                <div class="text-muted">{{ p.period === 'MONTHLY' ? 'por mês' : 'por ano' }}</div>
                <div v-if="p.period === 'ANNUAL'" class="text-success small mt-1">
                  Economize {{ annualSavings }}%
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- CTA -->
      <div v-if="!mod.isSubscribed">
        <button
          class="btn btn-primary btn-lg w-100"
          :disabled="subscribing"
          @click="subscribe"
        >
          <span v-if="subscribing" class="spinner-border spinner-border-sm me-2"></span>
          Assinar por R$ {{ selectedPrice }}/{{ selectedPeriod === 'MONTHLY' ? 'mês' : 'ano' }}
        </button>
      </div>
      <div v-else>
        <button
          class="btn btn-outline-danger w-100"
          :disabled="canceling"
          @click="cancel"
        >
          <span v-if="canceling" class="spinner-border spinner-border-sm me-2"></span>
          Cancelar assinatura
        </button>
        <p class="text-muted small mt-2 text-center">
          O acesso continua ativo até o fim do período atual.
        </p>
      </div>
    </div>

    <div v-else class="text-center py-5 text-muted">
      Módulo não encontrado.
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAddOnStoreStore } from '../stores/addOnStore'
import { useModulesStore } from '../stores/modules'

const route = useRoute()
const store = useAddOnStoreStore()
const modulesStore = useModulesStore()
const loading = ref(true)
const subscribing = ref(false)
const canceling = ref(false)
const selectedPeriod = ref('MONTHLY')

const mod = computed(() => {
  const key = route.params.moduleKey?.toUpperCase()
  return store.modules.find(m => m.key === key) || null
})

const selectedPrice = computed(() => {
  const p = mod.value?.prices?.find(p => p.period === selectedPeriod.value)
  return p ? Number(p.price).toFixed(2) : '—'
})

const annualSavings = computed(() => {
  const monthly = mod.value?.prices?.find(p => p.period === 'MONTHLY')
  const annual = mod.value?.prices?.find(p => p.period === 'ANNUAL')
  if (!monthly || !annual) return 0
  const yearlyFromMonthly = Number(monthly.price) * 12
  const savings = ((yearlyFromMonthly - Number(annual.price)) / yearlyFromMonthly * 100).toFixed(0)
  return savings > 0 ? savings : 0
})

async function subscribe() {
  if (!mod.value) return
  subscribing.value = true
  try {
    await store.subscribeToModule(mod.value.id, selectedPeriod.value)
    await modulesStore.fetchEnabled(true)
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao assinar')
  } finally {
    subscribing.value = false
  }
}

async function cancel() {
  if (!mod.value || !confirm('Deseja cancelar esta assinatura?')) return
  canceling.value = true
  try {
    await store.cancelModuleSubscription(mod.value.id)
    await modulesStore.fetchEnabled(true)
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao cancelar')
  } finally {
    canceling.value = false
  }
}

onMounted(async () => {
  if (!store.modules.length) await store.fetchStoreModules()
  loading.value = false
})
</script>
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/AddOnDetail.vue
git commit -m "feat(frontend): add AddOnDetail view with subscribe/cancel"
```

---

## Task 12: Frontend — CreditPackStore.vue

**Files:**
- Create: `delivery-saas-frontend/src/views/CreditPackStore.vue`

**Step 1: Create the credit pack purchase view**

```vue
<template>
  <div class="container py-4" style="max-width: 800px;">
    <router-link to="/store" class="text-decoration-none mb-3 d-inline-block">
      &larr; Voltar para a Loja
    </router-link>

    <h2 class="mb-2">Créditos de IA</h2>
    <p class="text-muted mb-4">Compre pacotes de créditos para usar recursos de inteligência artificial.</p>

    <!-- Current balance -->
    <div class="card mb-4">
      <div class="card-body d-flex align-items-center">
        <div class="me-3">
          <span class="fs-2 fw-bold text-primary">{{ credits.balance ?? '—' }}</span>
        </div>
        <div>
          <div class="fw-semibold">Saldo atual</div>
          <div class="text-muted small">créditos disponíveis</div>
        </div>
      </div>
    </div>

    <!-- Packs -->
    <div v-if="store.loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <div v-else class="row g-3">
      <div v-for="pack in store.creditPacks" :key="pack.id" class="col-md-6">
        <div class="card h-100">
          <div class="card-body text-center">
            <h5>{{ pack.name }}</h5>
            <div class="fs-1 fw-bold text-primary my-3">{{ pack.credits }}</div>
            <div class="text-muted mb-3">créditos</div>
            <div class="fs-5 mb-3">R$ {{ Number(pack.price).toFixed(2) }}</div>
            <button
              class="btn btn-primary w-100"
              :disabled="purchasing === pack.id"
              @click="purchase(pack)"
            >
              <span v-if="purchasing === pack.id" class="spinner-border spinner-border-sm me-2"></span>
              Comprar
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!store.loading && !store.creditPacks.length" class="text-center text-muted py-4">
      Nenhum pacote de créditos disponível no momento.
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAddOnStoreStore } from '../stores/addOnStore'
import { useAiCreditsStore } from '../stores/aiCredits'

const store = useAddOnStoreStore()
const credits = useAiCreditsStore()
const purchasing = ref(null)

async function purchase(pack) {
  if (!confirm(`Comprar ${pack.name} por R$ ${Number(pack.price).toFixed(2)}?`)) return
  purchasing.value = pack.id
  try {
    await store.purchaseCreditPack(pack.id)
    await credits.fetch()
    alert(`${pack.credits} créditos adicionados com sucesso!`)
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao comprar')
  } finally {
    purchasing.value = null
  }
}

onMounted(() => {
  store.fetchCreditPacks()
  credits.fetch()
})
</script>
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/CreditPackStore.vue
git commit -m "feat(frontend): add CreditPackStore view"
```

---

## Task 13: Frontend — Router & Nav Updates

**Files:**
- Modify: `delivery-saas-frontend/src/router.js:107-236` (add new routes)
- Modify: `delivery-saas-frontend/src/config/nav.js` (add store link)
- Modify: `delivery-saas-frontend/src/utils/navVisibility.js` (locked items redirect to store)

**Step 1: Add store routes to router.js**

Add imports at the top (after line 105):

```javascript
import AddOnStore from './views/AddOnStore.vue'
import AddOnDetail from './views/AddOnDetail.vue'
import CreditPackStore from './views/CreditPackStore.vue'
```

Add routes (after line 215, before the SaaS admin routes):

```javascript
,{ path: '/store', component: AddOnStore, meta: { requiresAuth: true, role: 'ADMIN' } }
,{ path: '/store/credits', component: CreditPackStore, meta: { requiresAuth: true, role: 'ADMIN' } }
,{ path: '/store/:moduleKey', component: AddOnDetail, meta: { requiresAuth: true, role: 'ADMIN' } }
```

**Step 2: Add "Loja" to nav.js**

In `nav.js`, add a store entry before the SaaS section (around line 48):

```javascript
{
  name: 'Loja de Add-ons',
  to: '/store',
  icon: 'bi-shop',
},
```

**Step 3: Update navVisibility.js for locked item routing**

In `navVisibility.js`, when an item is locked (around lines 21-23), add the store route to the locked item:

```javascript
// When item.moduleKey is not in enabledSet:
if (item.lockable) {
  return { ...item, locked: true, to: `/store/${item.moduleKey.toLowerCase()}`, children: [] }
}
```

**Step 4: Update Sidebar.vue locked item click behavior**

In `Sidebar.vue` lines 786-793, change the locked item from a static badge to a router-link:

```html
<!-- Replace the locked item template to use router-link -->
<router-link
  v-if="item.locked"
  :to="item.to || '/store'"
  class="nav-link text-muted d-flex align-items-center"
>
  <i :class="item.icon" class="me-2"></i>
  <span>{{ item.name }}</span>
  <span class="badge bg-warning text-dark ms-auto">
    <i class="bi bi-lock-fill"></i> Upgrade
  </span>
</router-link>
```

**Step 5: Add "Comprar créditos" link to AiCreditsWidget.vue**

In `AiCreditsWidget.vue`, add a link after the progress bar (around line 20 in the compact template):

```html
<router-link to="/store/credits" class="text-decoration-none small text-primary">
  Comprar créditos
</router-link>
```

**Step 6: Commit**

```bash
git add delivery-saas-frontend/src/router.js delivery-saas-frontend/src/config/nav.js delivery-saas-frontend/src/utils/navVisibility.js delivery-saas-frontend/src/components/Sidebar.vue delivery-saas-frontend/src/components/AiCreditsWidget.vue
git commit -m "feat(frontend): add store routes, nav, locked item routing, credit link"
```

---

## Task 14: Frontend — Update SaasPlans.vue for Single Plan + Module Pricing

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasPlans.vue`

**Step 1: Read the current file to understand the template**

Read `delivery-saas-frontend/src/views/SaasPlans.vue` fully before making changes.

**Step 2: Simplify for single plan management**

The existing multi-plan CRUD becomes a single-plan editor. Key changes:
- Remove the ability to create/delete plans (only edit the single default plan)
- Add a "Module Pricing" section below the plan editor
- Add a "Credit Packs" section

The plan editor keeps: name, monthly/annual prices, initial AI credits balance.
Removes: module assignment (modules are now individual subscriptions), menu/store limits.

Add module pricing section that shows each module with editable MONTHLY and ANNUAL prices.
Add credit pack CRUD section.

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasPlans.vue
git commit -m "feat(frontend): simplify SaasPlans for single plan + module pricing + credit packs"
```

---

## Task 15: Frontend — Update SaasBilling.vue for Invoice Line Items

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasBilling.vue`

**Step 1: Read the current file**

Read `delivery-saas-frontend/src/views/SaasBilling.vue` fully before making changes.

**Step 2: Add invoice line items display**

When viewing an invoice, show its line items (type, description, amount). The backend now includes `items` in invoice responses — update the invoice list/detail to fetch and display them.

Add a module subscriptions management section for ADMINs showing active module subscriptions with cancel buttons.

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasBilling.vue
git commit -m "feat(frontend): add invoice line items and module subscription management to billing"
```

---

## Task 16: Backend — Super Admin Module Assignment

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js`

**Step 1: Add Super Admin route to assign/remove modules for a company**

```javascript
// Assign module to company (SUPER_ADMIN)
saasRouter.post('/module-subscriptions/assign', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { companyId, moduleId, period = 'MONTHLY' } = req.body || {}
  if (!companyId || !moduleId) {
    return res.status(400).json({ message: 'companyId e moduleId são obrigatórios' })
  }
  try {
    const existing = await prisma.saasModuleSubscription.findUnique({
      where: { companyId_moduleId: { companyId, moduleId } }
    })
    const nextDueAt = new Date()
    nextDueAt.setMonth(nextDueAt.getMonth() + (period === 'ANNUAL' ? 12 : 1))

    const sub = existing
      ? await prisma.saasModuleSubscription.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', period, nextDueAt, canceledAt: null }
        })
      : await prisma.saasModuleSubscription.create({
          data: { companyId, moduleId, period, nextDueAt }
        })
    res.json(sub)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atribuir módulo', error: e?.message })
  }
})

// Remove module from company (SUPER_ADMIN)
saasRouter.delete('/module-subscriptions/assign/:companyId/:moduleId', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { companyId, moduleId } = req.params
  try {
    await prisma.saasModuleSubscription.deleteMany({
      where: { companyId, moduleId }
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao remover módulo', error: e?.message })
  }
})
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(saas): add Super Admin module assignment routes"
```

---

## Task 17: Migration Script

**Files:**
- Create: `delivery-saas-backend/prisma/migrations/billing-revamp-migration.js`

**Step 1: Create the migration script**

```javascript
// delivery-saas-backend/prisma/migrations/billing-revamp-migration.js
// Run with: node prisma/migrations/billing-revamp-migration.js
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function migrate() {
  console.log('Starting billing revamp migration...')

  // 1. Find or create the single basic plan
  let basicPlan = await prisma.saasPlan.findFirst({ where: { isDefault: true } })
  if (!basicPlan) {
    basicPlan = await prisma.saasPlan.findFirst({ orderBy: { createdAt: 'asc' } })
  }
  if (!basicPlan) {
    console.log('No plans found. Creating default basic plan...')
    basicPlan = await prisma.saasPlan.create({
      data: { name: 'Básico', price: 0, isDefault: true, isSystem: true }
    })
  }
  console.log(`Using basic plan: ${basicPlan.name} (${basicPlan.id})`)

  // 2. Migrate existing subscriptions
  const subscriptions = await prisma.saasSubscription.findMany({
    where: { status: 'ACTIVE' },
    include: {
      plan: { include: { modules: { include: { module: true } } } }
    }
  })

  let migratedCount = 0
  for (const sub of subscriptions) {
    const companyId = sub.companyId
    const modules = sub.plan?.modules || []

    // Create SaasModuleSubscription for each plan module
    for (const pm of modules) {
      if (!pm.module || !pm.module.isActive) continue

      const existing = await prisma.saasModuleSubscription.findUnique({
        where: { companyId_moduleId: { companyId, moduleId: pm.moduleId } }
      })
      if (existing) continue

      await prisma.saasModuleSubscription.create({
        data: {
          companyId,
          moduleId: pm.moduleId,
          status: 'ACTIVE',
          period: sub.period || 'MONTHLY',
          startedAt: sub.startedAt || new Date(),
          nextDueAt: sub.nextDueAt || new Date()
        }
      })
    }

    // Update subscription to point to basic plan
    if (sub.planId !== basicPlan.id) {
      await prisma.saasSubscription.update({
        where: { id: sub.id },
        data: { planId: basicPlan.id }
      })
    }

    migratedCount++
  }

  // 3. Mark non-basic plans as inactive (keep for reference)
  await prisma.saasPlan.updateMany({
    where: { NOT: { id: basicPlan.id } },
    data: { isActive: false }
  })

  // 4. Set basic plan as default and system
  await prisma.saasPlan.update({
    where: { id: basicPlan.id },
    data: { isDefault: true, isSystem: true }
  })

  console.log(`Migration complete: ${migratedCount} subscriptions migrated`)
  console.log('Old plans marked inactive. SaasPlanModule data preserved for rollback.')
}

migrate()
  .catch(e => { console.error('Migration failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
```

**Step 2: Test on dev database**

Run: `cd delivery-saas-backend && node prisma/migrations/billing-revamp-migration.js`

Expected: Companies migrated, modules assigned as individual subscriptions.

**Step 3: Commit**

```bash
git add delivery-saas-backend/prisma/migrations/billing-revamp-migration.js
git commit -m "feat(saas): add billing revamp migration script"
```

---

## Task 18: Update Router Guards

**Files:**
- Modify: `delivery-saas-frontend/src/router.js:281-301` (SIMPLES_BLOCKED_PREFIXES guard)

**Step 1: Update the CARDAPIO_SIMPLES guard**

The current guard checks `saas.isCardapioSimplesOnly` which reads from plan modules. Update it to also work with the new model. Since `modules.js` store now reads from `SaasModuleSubscription`, we can use it directly:

```javascript
// Replace the SIMPLES_BLOCKED_PREFIXES guard (lines 281-301):
if (token) {
  const isBlocked = SIMPLES_BLOCKED_PREFIXES.some(p => to.path === p || to.path.startsWith(p + '/'))
  if (isBlocked) {
    const auth = useAuthStore()
    const userRole = String(auth.user?.role || '').toUpperCase()
    if (userRole === 'ADMIN') {
      const { useModulesStore } = await import('./stores/modules')
      const modules = useModulesStore()
      if (!modules.enabled.length) {
        try { await modules.fetchEnabled() } catch {}
      }
      // If only has CARDAPIO_SIMPLES but not CARDAPIO_COMPLETO, redirect
      const hasSimples = modules.has('CARDAPIO_SIMPLES')
      const hasCompleto = modules.has('CARDAPIO_COMPLETO')
      if (hasSimples && !hasCompleto) return { path: '/menu/menus' }
    }
  }
}
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/router.js
git commit -m "feat(frontend): update router guard to use modules store"
```

---

## Task 19: Include Invoices Items in API Responses

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js` (invoice endpoints)

**Step 1: Update GET /saas/invoices to include items**

In the invoices listing (around line 247), add `include: { items: true }` to the `findMany`:

```javascript
const rows = await prisma.saasInvoice.findMany({
  where,
  orderBy: [{ year: 'desc' }, { month: 'desc' }],
  skip: (page - 1) * pageSize,
  take: pageSize,
  include: { items: true }
})
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(saas): include invoice items in API responses"
```

---

## Task 20: Final Integration Test & Cleanup

**Step 1: Start the Docker dev environment**

Run: `docker compose up -d`

**Step 2: Verify schema push**

Run: `docker compose exec backend npx prisma db push`

Expected: All models created without errors.

**Step 3: Test the full flow**

1. As SUPER_ADMIN: create module prices (`PUT /saas/modules/:id` with prices)
2. As SUPER_ADMIN: create credit packs (`POST /saas/credit-packs`)
3. As ADMIN: view store (`GET /saas/store/modules`)
4. As ADMIN: subscribe to a module (`POST /saas/module-subscriptions`)
5. As ADMIN: verify module appears in `GET /saas/modules/me`
6. As ADMIN: purchase credit pack (`POST /saas/credit-packs/purchase`)
7. As ADMIN: verify credits increased in `GET /ai-credits/balance`
8. Test sidebar shows newly activated module

**Step 4: Run migration script on dev**

Run: `docker compose exec backend node prisma/migrations/billing-revamp-migration.js`

**Step 5: Verify migration**

Check that existing companies have their modules as individual subscriptions.

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(saas): billing revamp - single plan + add-on modules + credit packs

Replaces multi-plan billing with:
- Single basic plan with configurable pricing
- Modules as individual purchasable add-ons
- Pro-rated mid-cycle billing
- AI credit packs for purchase
- Gateway-agnostic payment layer
- Self-service add-on store for admins
- Auto-migration of existing subscriptions"
```

---

## File Index

### Backend (new files)
- `delivery-saas-backend/src/services/proRation.js` — Pro-ration calculation utility
- `delivery-saas-backend/src/routes/payment.js` — Payment webhook handler
- `delivery-saas-backend/prisma/migrations/billing-revamp-migration.js` — Data migration script

### Backend (modified files)
- `delivery-saas-backend/prisma/schema.prisma` — New models + relations
- `delivery-saas-backend/src/routes/saas.js` — Module pricing, subscriptions, store, credit packs, assignment
- `delivery-saas-backend/src/modules.js` — Read from SaasModuleSubscription
- `delivery-saas-backend/src/services/aiCreditManager.js` — Remove monthly reset, update getBalance

### Frontend (new files)
- `delivery-saas-frontend/src/stores/addOnStore.js` — Pinia store for marketplace
- `delivery-saas-frontend/src/views/AddOnStore.vue` — Central marketplace page
- `delivery-saas-frontend/src/views/AddOnDetail.vue` — Individual add-on page
- `delivery-saas-frontend/src/views/CreditPackStore.vue` — Credit pack purchase page

### Frontend (modified files)
- `delivery-saas-frontend/src/router.js` — Store routes + updated guard
- `delivery-saas-frontend/src/config/nav.js` — Store nav item
- `delivery-saas-frontend/src/utils/navVisibility.js` — Locked item routing
- `delivery-saas-frontend/src/components/Sidebar.vue` — Locked item click → store
- `delivery-saas-frontend/src/components/AiCreditsWidget.vue` — Buy credits link
- `delivery-saas-frontend/src/views/SaasPlans.vue` — Simplified for single plan
- `delivery-saas-frontend/src/views/SaasBilling.vue` — Invoice items + module management
- `delivery-saas-frontend/src/stores/saas.js` — Updated getters
- `delivery-saas-frontend/src/stores/aiCredits.js` — Remove reset references
