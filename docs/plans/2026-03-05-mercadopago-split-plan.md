# Mercado Pago Split Payment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Mercado Pago Checkout Pro with marketplace split payment for white-label SaaS billing (subscriptions, modules, AI credit packs).

**Architecture:** Each SaaS manager (SUPER_ADMIN's company) has their own MP credentials stored encrypted in DB. The platform owner's credentials and fixed fee come from env vars. When a restaurant (ADMIN) buys something, backend creates a MP Preference using the manager's token with `marketplace_fee` for the platform. MP handles the split atomically.

**Tech Stack:** mercadopago SDK (Node.js), Express.js, Prisma ORM, Vue 3, Pinia, AES-256-GCM encryption

---

### Task 1: Install mercadopago SDK and add env vars

**Files:**
- Modify: `delivery-saas-backend/package.json`
- Modify: `delivery-saas-backend/.env` (or docker-compose)

**Step 1: Install the SDK**

Run from `delivery-saas-backend/`:
```bash
npm install mercadopago
```

**Step 2: Add env vars to docker-compose.dev.yml**

Add these env vars to the backend service in `docker-compose.yml`:
```yaml
MP_PLATFORM_ACCESS_TOKEN: ${MP_PLATFORM_ACCESS_TOKEN:-}
MP_PLATFORM_FEE: ${MP_PLATFORM_FEE:-200}
PAYMENT_ENCRYPT_KEY: ${PAYMENT_ENCRYPT_KEY:-}
```

`MP_PLATFORM_FEE` is in centavos (200 = R$2.00). `PAYMENT_ENCRYPT_KEY` is a 32-byte hex string for AES-256-GCM.

**Step 3: Commit**

```bash
git add package.json package-lock.json docker-compose.yml
git commit -m "chore: install mercadopago SDK and add payment env vars"
```

---

### Task 2: Add MercadoPagoConfig model and managedById to schema

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add managedById to Company model**

After line 112 (`saasPayments SaasPayment[]`) in schema.prisma, add:
```prisma
  // White-label: which SaaS manager company manages this restaurant
  managedById          String?
  managedBy            Company?  @relation("CompanyManager", fields: [managedById], references: [id])
  managedCompanies     Company[] @relation("CompanyManager")
  // Mercado Pago config for this company (if it's a SaaS manager)
  mercadoPagoConfig    MercadoPagoConfig?
```

**Step 2: Add MercadoPagoConfig model**

At the end of schema.prisma (before the closing), add:
```prisma
model MercadoPagoConfig {
  id           String   @id @default(uuid())
  companyId    String   @unique
  company      Company  @relation(fields: [companyId], references: [id])
  accessToken  String   // encrypted with AES-256-GCM
  publicKey    String?
  refreshToken String?  // encrypted
  mpUserId     String?  // Mercado Pago user ID
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

**Step 3: Push schema to dev DB**

```bash
cd delivery-saas-backend && npx prisma db push
```

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add MercadoPagoConfig model and managedById to Company"
```

---

### Task 3: Create encryption utility for storing MP tokens

**Files:**
- Create: `delivery-saas-backend/src/services/encryption.js`

**Step 1: Create the encryption service**

```javascript
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey() {
  const hex = process.env.PAYMENT_ENCRYPT_KEY || ''
  if (!hex || hex.length < 64) {
    throw new Error('PAYMENT_ENCRYPT_KEY must be a 64-char hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

export function encrypt(plaintext) {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  // Format: iv:tag:ciphertext
  return `${iv.toString('hex')}:${tag}:${encrypted}`
}

export function decrypt(stored) {
  const key = getKey()
  const [ivHex, tagHex, ciphertext] = stored.split(':')
  if (!ivHex || !tagHex || !ciphertext) {
    throw new Error('Invalid encrypted format')
  }
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
```

**Step 2: Commit**

```bash
git add src/services/encryption.js
git commit -m "feat: add AES-256-GCM encryption service for payment tokens"
```

---

### Task 4: Create Mercado Pago service (preference creation + payment query)

**Files:**
- Create: `delivery-saas-backend/src/services/mercadopago.js`

**Step 1: Create the MP service**

```javascript
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'

/**
 * Create a Checkout Pro preference with marketplace split.
 *
 * @param {string} sellerAccessToken - The SaaS manager's MP access token (decrypted)
 * @param {object} opts
 * @param {string} opts.externalReference - Our paymentId for traceability
 * @param {Array<{title:string, quantity:number, unit_price:number}>} opts.items
 * @param {string} opts.notificationUrl - Webhook URL
 * @param {object} opts.backUrls - { success, failure, pending }
 * @param {number} opts.marketplaceFee - Platform fee in BRL (decimal, e.g. 2.00)
 * @returns {Promise<{id:string, init_point:string}>} preference id and checkout URL
 */
export async function createPreference(sellerAccessToken, opts) {
  const client = new MercadoPagoConfig({ accessToken: sellerAccessToken })
  const preference = new Preference(client)

  const body = {
    items: opts.items,
    marketplace_fee: opts.marketplaceFee,
    external_reference: opts.externalReference,
    notification_url: opts.notificationUrl,
    back_urls: opts.backUrls,
    auto_return: 'approved',
    statement_descriptor: 'CoreDelivery'
  }

  const result = await preference.create({ body })
  return { id: result.id, init_point: result.init_point }
}

/**
 * Get payment details from MP API using the seller's token.
 *
 * @param {string} sellerAccessToken
 * @param {string} mpPaymentId - The payment ID from MP notification
 * @returns {Promise<object>} payment data from MP
 */
export async function getPayment(sellerAccessToken, mpPaymentId) {
  const client = new MercadoPagoConfig({ accessToken: sellerAccessToken })
  const payment = new Payment(client)
  return payment.get({ id: mpPaymentId })
}
```

**Step 2: Commit**

```bash
git add src/services/mercadopago.js
git commit -m "feat: add Mercado Pago service for preference creation and payment query"
```

---

### Task 5: Create the payment preference endpoint

**Files:**
- Modify: `delivery-saas-backend/src/routes/payment.js`

**Step 1: Rewrite payment.js with create-preference endpoint**

Add imports at the top of `delivery-saas-backend/src/routes/payment.js`:
```javascript
import { createPreference, getPayment } from '../services/mercadopago.js'
import { decrypt } from '../services/encryption.js'
import { calculateProRation } from '../services/proRation.js'
```

Add the `requireRole` middleware import. The file needs access to auth middleware. Check how saas.js imports it:
```javascript
import jwt from 'jsonwebtoken'
```

Add a helper function to resolve the SaaS manager's MP config for a given company:
```javascript
async function getMpConfig(companyId) {
  // Find the company and its manager
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { managedById: true }
  })
  const managerId = company?.managedById || companyId
  const config = await prisma.mercadoPagoConfig.findUnique({
    where: { companyId: managerId }
  })
  if (!config || !config.isActive) return null
  return { ...config, accessToken: decrypt(config.accessToken) }
}

const MP_PLATFORM_FEE = Number(process.env.MP_PLATFORM_FEE || '200') / 100 // centavos to BRL
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
```

Add the create-preference endpoint (after existing webhook, before export):
```javascript
/**
 * POST /payment/create-preference
 * Creates a Mercado Pago Checkout Pro preference.
 * Body: { invoiceId } to pay an existing invoice
 *    OR { type: "MODULE"|"CREDIT_PACK", referenceId, period? } to create invoice + preference
 * Auth: ADMIN (JWT)
 */
paymentRouter.post('/create-preference', async (req, res) => {
  try {
    const user = req.user
    if (!user || !user.companyId) return res.status(401).json({ message: 'Não autorizado' })
    const companyId = user.companyId

    const mpConfig = await getMpConfig(companyId)
    if (!mpConfig) return res.status(400).json({ message: 'Gateway de pagamento não configurado' })

    let invoice, payment, items, description

    if (req.body.invoiceId) {
      // Pay existing invoice
      invoice = await prisma.saasInvoice.findUnique({
        where: { id: req.body.invoiceId },
        include: { items: true, subscription: true }
      })
      if (!invoice) return res.status(404).json({ message: 'Fatura não encontrada' })
      if (invoice.status === 'PAID') return res.status(400).json({ message: 'Fatura já paga' })

      // Check company owns this invoice
      if (invoice.subscription?.companyId !== companyId) {
        return res.status(403).json({ message: 'Fatura não pertence à sua empresa' })
      }

      description = `Fatura #${invoice.year}/${String(invoice.month).padStart(2, '0')}`
      items = [{
        title: description,
        quantity: 1,
        unit_price: Number(invoice.amount),
        currency_id: 'BRL'
      }]

      // Find or create pending payment for this invoice
      payment = await prisma.saasPayment.findFirst({
        where: { invoiceId: invoice.id, status: 'PENDING' }
      })
      if (!payment) {
        payment = await prisma.saasPayment.create({
          data: {
            companyId,
            invoiceId: invoice.id,
            amount: String(invoice.amount),
            gateway: 'mercadopago',
            status: 'PENDING'
          }
        })
      }
    } else if (req.body.type === 'MODULE') {
      const { referenceId: moduleId, period = 'MONTHLY' } = req.body
      if (!moduleId) return res.status(400).json({ message: 'referenceId é obrigatório' })

      const mod = await prisma.saasModule.findUnique({
        where: { id: moduleId },
        include: { prices: true }
      })
      if (!mod) return res.status(404).json({ message: 'Módulo não encontrado' })

      const priceRecord = mod.prices.find(p => p.period === period.toUpperCase())
      if (!priceRecord) return res.status(400).json({ message: 'Preço não encontrado para este período' })

      const { proRatedPrice, nextDueAt } = calculateProRation(Number(priceRecord.price), period.toUpperCase())

      // Check existing subscription
      const existing = await prisma.saasModuleSubscription.findUnique({
        where: { companyId_moduleId: { companyId, moduleId } }
      })
      if (existing && existing.status === 'ACTIVE') {
        return res.status(400).json({ message: 'Módulo já está ativo' })
      }

      // Create module subscription (PENDING), invoice, and payment in transaction
      const result = await prisma.$transaction(async (tx) => {
        const sub = await prisma.saasSubscription.findUnique({ where: { companyId } })
        if (!sub) throw new Error('Assinatura não encontrada')

        const mSub = existing
          ? await tx.saasModuleSubscription.update({
              where: { id: existing.id },
              data: { status: 'PENDING', period: period.toUpperCase(), nextDueAt, canceledAt: null }
            })
          : await tx.saasModuleSubscription.create({
              data: { companyId, moduleId, period: period.toUpperCase(), nextDueAt, status: 'PENDING' }
            })

        const inv = await tx.saasInvoice.create({
          data: {
            subscriptionId: sub.id,
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            amount: String(proRatedPrice),
            dueDate: new Date(),
            status: 'PENDING',
            items: {
              create: {
                type: 'MODULE',
                referenceId: moduleId,
                description: `Assinatura módulo ${mod.name} (${period.toUpperCase()})`,
                amount: String(proRatedPrice)
              }
            }
          }
        })

        const pay = await tx.saasPayment.create({
          data: {
            companyId,
            invoiceId: inv.id,
            amount: String(proRatedPrice),
            gateway: 'mercadopago',
            status: 'PENDING'
          }
        })

        return { mSub, inv, pay, proRatedPrice }
      })

      invoice = result.inv
      payment = result.pay
      description = `Módulo ${mod.name}`
      items = [{
        title: description,
        quantity: 1,
        unit_price: result.proRatedPrice,
        currency_id: 'BRL'
      }]
    } else if (req.body.type === 'CREDIT_PACK') {
      const { referenceId: packId } = req.body
      if (!packId) return res.status(400).json({ message: 'referenceId é obrigatório' })

      const pack = await prisma.aiCreditPack.findUnique({ where: { id: packId } })
      if (!pack || !pack.isActive) return res.status(404).json({ message: 'Pacote não encontrado' })

      const result = await prisma.$transaction(async (tx) => {
        const sub = await prisma.saasSubscription.findUnique({ where: { companyId } })
        if (!sub) throw new Error('Assinatura não encontrada')

        const purchase = await tx.aiCreditPurchase.create({
          data: { companyId, packId, credits: pack.credits, amount: String(pack.price) }
        })

        const inv = await tx.saasInvoice.create({
          data: {
            subscriptionId: sub.id,
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            amount: String(pack.price),
            dueDate: new Date(),
            status: 'PENDING',
            items: {
              create: {
                type: 'CREDIT_PACK',
                referenceId: pack.id,
                description: `Pacote de créditos: ${pack.name}`,
                amount: String(pack.price)
              }
            }
          }
        })

        const pay = await tx.saasPayment.create({
          data: {
            companyId,
            invoiceId: inv.id,
            amount: String(pack.price),
            gateway: 'mercadopago',
            status: 'PENDING'
          }
        })

        return { inv, pay }
      })

      invoice = result.inv
      payment = result.pay
      description = `Créditos de IA: ${pack.name}`
      items = [{
        title: description,
        quantity: 1,
        unit_price: Number(pack.price),
        currency_id: 'BRL'
      }]
    } else {
      return res.status(400).json({ message: 'invoiceId ou type (MODULE/CREDIT_PACK) é obrigatório' })
    }

    // Create MP preference
    const pref = await createPreference(mpConfig.accessToken, {
      externalReference: payment.id,
      items,
      marketplaceFee: MP_PLATFORM_FEE,
      notificationUrl: `${BACKEND_URL}/payment/webhook/mercadopago`,
      backUrls: {
        success: `${FRONTEND_URL}/payment/result?status=success`,
        failure: `${FRONTEND_URL}/payment/result?status=failure`,
        pending: `${FRONTEND_URL}/payment/result?status=pending`
      }
    })

    // Save preference ID to payment metadata
    await prisma.saasPayment.update({
      where: { id: payment.id },
      data: { metadata: { preferenceId: pref.id } }
    })

    res.json({
      checkoutUrl: pref.init_point,
      preferenceId: pref.id,
      paymentId: payment.id
    })
  } catch (e) {
    console.error('[create-preference]', e)
    res.status(500).json({ message: 'Erro ao criar preferência de pagamento', error: e?.message })
  }
})
```

**Step 2: Add payment status endpoint**

```javascript
/**
 * GET /payment/status/:paymentId
 * Check payment status (polling for frontend).
 */
paymentRouter.get('/status/:paymentId', async (req, res) => {
  try {
    const user = req.user
    if (!user || !user.companyId) return res.status(401).json({ message: 'Não autorizado' })

    const payment = await prisma.saasPayment.findUnique({
      where: { id: req.params.paymentId }
    })
    if (!payment) return res.status(404).json({ message: 'Pagamento não encontrado' })
    if (payment.companyId !== user.companyId) return res.status(403).json({ message: 'Acesso negado' })

    res.json({
      status: payment.status,
      gateway: payment.gateway,
      paidAt: payment.paidAt,
      invoiceId: payment.invoiceId
    })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao consultar status', error: e?.message })
  }
})
```

**Step 3: Commit**

```bash
git add src/routes/payment.js
git commit -m "feat: add create-preference and payment status endpoints"
```

---

### Task 6: Add Mercado Pago webhook handler

**Files:**
- Modify: `delivery-saas-backend/src/routes/payment.js`

**Step 1: Add MP-specific webhook endpoint**

Add after the existing `/webhook` endpoint. The MP IPN sends a POST with `{ type, data: { id } }` where `id` is the MP payment ID:

```javascript
/**
 * POST /payment/webhook/mercadopago
 * Handles Mercado Pago IPN notifications.
 * MP sends: { type: "payment", data: { id: "123456" } }
 */
paymentRouter.post('/webhook/mercadopago', async (req, res) => {
  // Respond 200 immediately (MP retries on non-2xx)
  res.sendStatus(200)

  try {
    const { type, data } = req.body || {}
    if (type !== 'payment' || !data?.id) return

    const mpPaymentId = String(data.id)

    // Find our payment by gatewayRef or by querying all pending payments
    // First try by gatewayRef (set on second notification)
    let payment = await prisma.saasPayment.findFirst({
      where: { gatewayRef: mpPaymentId, gateway: 'mercadopago' },
      include: { invoice: { include: { items: true } } }
    })

    if (!payment) {
      // MP preference has external_reference = our paymentId
      // We need to query MP API to get the external_reference
      // Find any pending mercadopago payment and check
      const pendingPayments = await prisma.saasPayment.findMany({
        where: { gateway: 'mercadopago', status: { in: ['PENDING', 'PROCESSING'] } },
        include: { invoice: { include: { items: true } } }
      })

      for (const p of pendingPayments) {
        try {
          const mpConfig = await getMpConfig(p.companyId)
          if (!mpConfig) continue
          const mpPayment = await getPayment(mpConfig.accessToken, mpPaymentId)
          if (mpPayment.external_reference === p.id) {
            payment = p
            // Save the MP payment ID for future lookups
            await prisma.saasPayment.update({
              where: { id: p.id },
              data: { gatewayRef: mpPaymentId }
            })
            break
          }
        } catch (e) {
          // skip if MP query fails for this payment
        }
      }
    }

    if (!payment) {
      console.warn('[mp-webhook] No matching payment found for MP payment', mpPaymentId)
      return
    }

    // Idempotency
    if (payment.status === 'PAID') return

    // Get fresh status from MP API
    const mpConfig = await getMpConfig(payment.companyId)
    if (!mpConfig) return
    const mpPayment = await getPayment(mpConfig.accessToken, mpPaymentId)

    const statusMap = {
      approved: 'PAID',
      pending: 'PENDING',
      in_process: 'PROCESSING',
      rejected: 'FAILED',
      refunded: 'REFUNDED',
      cancelled: 'FAILED',
      charged_back: 'REFUNDED'
    }

    const newStatus = statusMap[mpPayment.status] || 'PENDING'
    const isPaid = newStatus === 'PAID'

    await prisma.saasPayment.update({
      where: { id: payment.id },
      data: {
        status: newStatus,
        gatewayRef: mpPaymentId,
        method: mpPayment.payment_type_id === 'credit_card' ? 'CREDIT_CARD' : 'PIX',
        paidAt: isPaid ? new Date(mpPayment.date_approved || Date.now()) : payment.paidAt,
        metadata: {
          ...(typeof payment.metadata === 'object' ? payment.metadata : {}),
          mp_payment_id: mpPaymentId,
          mp_status: mpPayment.status,
          mp_status_detail: mpPayment.status_detail,
          payment_type: mpPayment.payment_type_id
        }
      }
    })

    // On successful payment, activate resources
    if (isPaid && payment.invoice) {
      await prisma.saasInvoice.update({
        where: { id: payment.invoice.id },
        data: { status: 'PAID', paidAt: new Date() }
      })

      for (const item of (payment.invoice.items || [])) {
        if (item.type === 'MODULE') {
          await prisma.saasModuleSubscription.updateMany({
            where: { companyId: payment.companyId, moduleId: item.referenceId },
            data: { status: 'ACTIVE' }
          })
        } else if (item.type === 'CREDIT_PACK') {
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

    console.log(`[mp-webhook] Payment ${payment.id} updated to ${newStatus}`)
  } catch (e) {
    console.error('[mp-webhook] Error processing notification', e)
  }
})
```

**Step 2: Commit**

```bash
git add src/routes/payment.js
git commit -m "feat: add Mercado Pago IPN webhook handler"
```

---

### Task 7: Ensure payment routes use auth middleware

**Files:**
- Modify: `delivery-saas-backend/src/routes/payment.js`
- Modify: `delivery-saas-backend/src/index.js`

**Step 1: Add auth middleware to payment routes**

The `/payment/create-preference` and `/payment/status/:id` endpoints need the JWT auth middleware. In `src/index.js`, the payment router is mounted as:
```javascript
app.use('/payment', paymentRouter)
```

It needs to be accessible both with and without auth (webhook is public, create-preference needs auth). In `payment.js`, add inline auth check at the top of the file:

```javascript
import jwt from 'jsonwebtoken'

// Inline auth middleware for routes that need it
function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '')
    if (!token) return res.status(401).json({ message: 'Token não fornecido' })
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret')
    req.user = decoded
    next()
  } catch (e) {
    return res.status(401).json({ message: 'Token inválido' })
  }
}
```

Then add `requireAuth` middleware to the `create-preference` and `status` routes:
```javascript
paymentRouter.post('/create-preference', requireAuth, async (req, res) => { ... })
paymentRouter.get('/status/:paymentId', requireAuth, async (req, res) => { ... })
```

**Step 2: Commit**

```bash
git add src/routes/payment.js
git commit -m "feat: add auth middleware to payment routes"
```

---

### Task 8: Add SUPER_ADMIN MP config endpoints to saas routes

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js`

**Step 1: Add MP config endpoints**

At the end of saas.js (before `export default saasRouter`), add endpoints for SUPER_ADMIN to manage their MP credentials:

```javascript
// -------- Mercado Pago Config (SUPER_ADMIN) --------

import { encrypt, decrypt } from '../services/encryption.js'

saasRouter.get('/mercadopago-config', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const config = await prisma.mercadoPagoConfig.findUnique({ where: { companyId } })
    if (!config) return res.json(null)
    res.json({
      id: config.id,
      publicKey: config.publicKey,
      mpUserId: config.mpUserId,
      isActive: config.isActive,
      hasAccessToken: !!config.accessToken,
      hasRefreshToken: !!config.refreshToken,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar configuração MP', error: e?.message })
  }
})

saasRouter.put('/mercadopago-config', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { accessToken, publicKey, refreshToken, isActive } = req.body || {}

    const data = {}
    if (accessToken !== undefined) data.accessToken = encrypt(accessToken)
    if (publicKey !== undefined) data.publicKey = publicKey
    if (refreshToken !== undefined) data.refreshToken = refreshToken ? encrypt(refreshToken) : null
    if (isActive !== undefined) data.isActive = isActive

    const existing = await prisma.mercadoPagoConfig.findUnique({ where: { companyId } })
    let config
    if (existing) {
      config = await prisma.mercadoPagoConfig.update({ where: { companyId }, data })
    } else {
      if (!accessToken) return res.status(400).json({ message: 'accessToken é obrigatório na primeira configuração' })
      config = await prisma.mercadoPagoConfig.create({
        data: { companyId, ...data }
      })
    }

    res.json({
      id: config.id,
      publicKey: config.publicKey,
      mpUserId: config.mpUserId,
      isActive: config.isActive,
      hasAccessToken: !!config.accessToken,
      updatedAt: config.updatedAt
    })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao salvar configuração MP', error: e?.message })
  }
})
```

**Step 2: Commit**

```bash
git add src/routes/saas.js
git commit -m "feat: add SUPER_ADMIN Mercado Pago config endpoints"
```

---

### Task 9: Update frontend addOnStore to support checkout redirect

**Files:**
- Modify: `delivery-saas-frontend/src/stores/addOnStore.js`

**Step 1: Update store actions**

Replace the `subscribeToModule` and `purchaseCreditPack` actions to call the new preference endpoint and handle redirect:

```javascript
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
      const { data } = await api.post('/payment/create-preference', {
        type: 'MODULE',
        referenceId: moduleId,
        period
      })
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return data
      }
      // Fallback: manual payment (no MP configured)
      await this.fetchStoreModules()
      return data
    },

    async cancelModuleSubscription(moduleId) {
      const { data } = await api.delete(`/saas/module-subscriptions/${moduleId}`)
      await this.fetchStoreModules()
      return data
    },

    async purchaseCreditPack(packId) {
      const { data } = await api.post('/payment/create-preference', {
        type: 'CREDIT_PACK',
        referenceId: packId
      })
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return data
      }
      return data
    },

    async payInvoice(invoiceId) {
      const { data } = await api.post('/payment/create-preference', {
        invoiceId
      })
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return data
      }
      return data
    },

    async checkPaymentStatus(paymentId) {
      const { data } = await api.get(`/payment/status/${paymentId}`)
      return data
    }
  }
})
```

**Step 2: Commit**

```bash
git add src/stores/addOnStore.js
git commit -m "feat: update addOnStore to use MP checkout redirect"
```

---

### Task 10: Create PaymentResult.vue page

**Files:**
- Create: `delivery-saas-frontend/src/views/PaymentResult.vue`
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Create the payment result view**

```vue
<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAddOnStoreStore } from '../stores/addOnStore'

const route = useRoute()
const router = useRouter()
const store = useAddOnStoreStore()

const status = computed(() => route.query.status || 'unknown')
const paymentId = computed(() => route.query.payment_id || route.query.external_reference || null)
const polling = ref(false)
const paymentStatus = ref(null)

const statusConfig = computed(() => {
  switch (status.value) {
    case 'success':
    case 'approved':
      return { icon: 'bi-check-circle-fill', color: 'text-success', title: 'Pagamento aprovado!', desc: 'Seu pagamento foi processado com sucesso.' }
    case 'pending':
    case 'in_process':
      return { icon: 'bi-clock-fill', color: 'text-warning', title: 'Pagamento pendente', desc: 'Estamos aguardando a confirmação do pagamento.' }
    case 'failure':
    case 'rejected':
      return { icon: 'bi-x-circle-fill', color: 'text-danger', title: 'Pagamento recusado', desc: 'O pagamento não foi aprovado. Tente novamente.' }
    default:
      return { icon: 'bi-question-circle-fill', color: 'text-muted', title: 'Status desconhecido', desc: 'Não foi possível determinar o status do pagamento.' }
  }
})

async function pollStatus() {
  if (!paymentId.value) return
  polling.value = true
  try {
    const data = await store.checkPaymentStatus(paymentId.value)
    paymentStatus.value = data.status
  } catch (e) {
    // ignore
  } finally {
    polling.value = false
  }
}

onMounted(() => {
  if (status.value === 'pending' && paymentId.value) {
    pollStatus()
    const interval = setInterval(async () => {
      await pollStatus()
      if (paymentStatus.value === 'PAID' || paymentStatus.value === 'FAILED') {
        clearInterval(interval)
      }
    }, 5000)
    // Stop after 2 minutes
    setTimeout(() => clearInterval(interval), 120000)
  }
})
</script>

<template>
  <div class="container py-5 text-center" style="max-width: 500px;">
    <i :class="['bi', statusConfig.icon, statusConfig.color]" style="font-size: 4rem;"></i>
    <h2 class="mt-3 mb-2">{{ statusConfig.title }}</h2>
    <p class="text-muted mb-4">{{ statusConfig.desc }}</p>

    <div v-if="polling" class="mb-3">
      <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
      <span class="text-muted">Verificando status...</span>
    </div>

    <div v-if="paymentStatus === 'PAID'" class="alert alert-success">
      Pagamento confirmado!
    </div>

    <div class="d-flex flex-column gap-2">
      <router-link to="/store" class="btn btn-primary">Voltar para a loja</router-link>
      <router-link to="/orders" class="btn btn-outline-secondary">Ir para pedidos</router-link>
    </div>
  </div>
</template>
```

**Step 2: Add route in router.js**

After the import of `CreditPackStore` (line 107), add:
```javascript
import PaymentResult from './views/PaymentResult.vue'
```

Find the `/store/credits` route and add after it:
```javascript
{ path: '/payment/result', component: PaymentResult, meta: { requiresAuth: true } },
```

**Step 3: Commit**

```bash
git add src/views/PaymentResult.vue src/router.js
git commit -m "feat: add PaymentResult page for MP checkout return"
```

---

### Task 11: Update AddOnDetail.vue for checkout flow

**Files:**
- Modify: `delivery-saas-frontend/src/views/AddOnDetail.vue`

**Step 1: Update subscribe function**

The `subscribe()` function already calls `store.subscribeToModule()` which now handles the redirect. But we need to handle the loading state and show that the user will be redirected:

In the `subscribe()` function (lines 43-54), update to:
```javascript
async function subscribe() {
  if (!mod.value) return
  subscribing.value = true
  try {
    await store.subscribeToModule(mod.value.id, selectedPeriod.value)
    // If no redirect happened (manual payment), refresh
    await modulesStore.fetchEnabled(true)
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao processar pagamento')
  } finally {
    subscribing.value = false
  }
}
```

Update the button text to indicate payment:
Replace the subscribe button text from:
```
Assinar por {{ formatPrice(selectedPrice) }}/{{ selectedPeriod === 'MONTHLY' ? 'mês' : 'ano' }}
```
To:
```
Pagar {{ formatPrice(selectedPrice) }} e ativar
```

**Step 2: Commit**

```bash
git add src/views/AddOnDetail.vue
git commit -m "feat: update AddOnDetail for MP checkout flow"
```

---

### Task 12: Update CreditPackStore.vue for checkout flow

**Files:**
- Modify: `delivery-saas-frontend/src/views/CreditPackStore.vue`

**Step 1: Update purchase function**

The `purchase()` function (lines 16-28) already calls `store.purchaseCreditPack()` which now handles the redirect. Update it to:

```javascript
async function purchase(pack) {
  if (!confirm(`Confirma a compra de "${pack.name}" por ${formatPrice(pack.price)}? Você será redirecionado para o pagamento.`)) return
  purchasing.value = pack.id
  try {
    await store.purchaseCreditPack(pack.id)
    // If no redirect happened, refresh
    await credits.fetch()
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao processar pagamento')
  } finally {
    purchasing.value = null
  }
}
```

**Step 2: Commit**

```bash
git add src/views/CreditPackStore.vue
git commit -m "feat: update CreditPackStore for MP checkout flow"
```

---

### Task 13: Add MP config UI to SaasPlans.vue (SUPER_ADMIN)

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasPlans.vue`

**Step 1: Add MP config section**

Read the current SaasPlans.vue first to understand structure, then add a new section at the bottom with:

- A card titled "Gateway de Pagamento - Mercado Pago"
- Fields: Access Token (password input), Public Key (text)
- Toggle for isActive
- Status indicator showing if configured (hasAccessToken)
- Save button calling `PUT /saas/mercadopago-config`

Add to the `<script setup>`:
```javascript
const mpConfig = ref(null)
const mpForm = ref({ accessToken: '', publicKey: '', isActive: true })
const mpSaving = ref(false)

async function loadMpConfig() {
  try {
    const { data } = await api.get('/saas/mercadopago-config')
    mpConfig.value = data
    if (data) {
      mpForm.value.publicKey = data.publicKey || ''
      mpForm.value.isActive = data.isActive
    }
  } catch (e) { /* ignore */ }
}

async function saveMpConfig() {
  mpSaving.value = true
  try {
    const payload = {}
    if (mpForm.value.accessToken) payload.accessToken = mpForm.value.accessToken
    payload.publicKey = mpForm.value.publicKey
    payload.isActive = mpForm.value.isActive
    const { data } = await api.put('/saas/mercadopago-config', payload)
    mpConfig.value = data
    mpForm.value.accessToken = '' // clear after save
    alert('Configuração salva com sucesso!')
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao salvar configuração')
  } finally {
    mpSaving.value = false
  }
}
```

Call `loadMpConfig()` in onMounted.

Add to template (at the end, before closing div):
```html
<div class="card mt-4">
  <div class="card-header d-flex justify-content-between align-items-center">
    <h5 class="mb-0">Gateway de Pagamento - Mercado Pago</h5>
    <span v-if="mpConfig?.hasAccessToken" class="badge bg-success">Configurado</span>
    <span v-else class="badge bg-secondary">Não configurado</span>
  </div>
  <div class="card-body">
    <div class="mb-3">
      <label class="form-label">Access Token</label>
      <input type="password" class="form-control" v-model="mpForm.accessToken" placeholder="Deixe vazio para manter o atual" />
      <small class="text-muted">Token de acesso do Mercado Pago (produção)</small>
    </div>
    <div class="mb-3">
      <label class="form-label">Public Key</label>
      <input type="text" class="form-control" v-model="mpForm.publicKey" />
    </div>
    <div class="form-check form-switch mb-3">
      <input class="form-check-input" type="checkbox" v-model="mpForm.isActive" id="mpActive" />
      <label class="form-check-label" for="mpActive">Ativo</label>
    </div>
    <button class="btn btn-primary" :disabled="mpSaving" @click="saveMpConfig">
      <span v-if="mpSaving" class="spinner-border spinner-border-sm me-1"></span>
      Salvar
    </button>
  </div>
</div>
```

**Step 2: Commit**

```bash
git add src/views/SaasPlans.vue
git commit -m "feat: add Mercado Pago config UI for SUPER_ADMIN"
```

---

### Task 14: Add "Pagar" button to SaasBilling.vue for pending invoices

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasBilling.vue`

**Step 1: Add pay button**

Read SaasBilling.vue first to understand structure. Add a "Pagar" button on each invoice row where `status === 'PENDING'`:

In the script, add:
```javascript
import { useAddOnStoreStore } from '../stores/addOnStore'
const addOnStore = useAddOnStoreStore()
const payingInvoice = ref(null)

async function payInvoice(invoice) {
  payingInvoice.value = invoice.id
  try {
    await addOnStore.payInvoice(invoice.id)
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao iniciar pagamento')
  } finally {
    payingInvoice.value = null
  }
}
```

In the template, find the invoice row and add a button:
```html
<button
  v-if="inv.status === 'PENDING'"
  class="btn btn-sm btn-primary"
  :disabled="payingInvoice === inv.id"
  @click="payInvoice(inv)"
>
  <span v-if="payingInvoice === inv.id" class="spinner-border spinner-border-sm me-1"></span>
  Pagar
</button>
```

**Step 2: Commit**

```bash
git add src/views/SaasBilling.vue
git commit -m "feat: add pay button on pending invoices for MP checkout"
```

---

### Task 15: Add managedById assignment to SaasCompanyNew/Edit

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js` (company creation endpoint)

**Step 1: Auto-assign managedById when SUPER_ADMIN creates a company**

Find the company creation endpoint in saas.js. When a SUPER_ADMIN creates a new company, set `managedById` to the SUPER_ADMIN's companyId:

In the existing create company endpoint, add to the `data`:
```javascript
managedById: req.user.companyId
```

This ensures all companies created by a SaaS manager are linked to that manager.

**Step 2: Commit**

```bash
git add src/routes/saas.js
git commit -m "feat: auto-assign managedById on company creation"
```

---

### Task 16: Add fallback for companies without MP config

**Files:**
- Modify: `delivery-saas-backend/src/routes/payment.js`

**Step 1: Add manual payment fallback**

In the `create-preference` endpoint, if `getMpConfig()` returns null (no MP configured), fall back to the old manual payment flow instead of returning an error. This maintains backwards compatibility:

```javascript
if (!mpConfig) {
  // Fallback: create invoice + mark as pending (manual payment)
  // Return without checkoutUrl — frontend handles as before
  // ... (same logic as before but gateway: 'manual' and status: 'PENDING')
  return res.json({ paymentId: payment.id, manual: true })
}
```

**Step 2: Commit**

```bash
git add src/routes/payment.js
git commit -m "feat: add manual payment fallback when MP not configured"
```
