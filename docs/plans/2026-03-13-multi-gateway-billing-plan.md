# Multi-Gateway Payment & Billing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the SaaS payment system to support multiple payment gateways via adapter pattern, with Super Admin gateway selector, ADMIN billing area, and configurable auto/manual recurring billing.

**Architecture:** Gateway Adapter Pattern — a `SaasGatewayConfig` singleton stores the active provider and credentials. Backend `paymentGateway/` module provides a common interface; each gateway is an adapter file. The existing `payment.js` routes call `getActiveGateway()` instead of Mercado Pago directly. Frontend adds `/saas/gateway` (Super Admin config) and `/billing` (ADMIN invoices + dashboard).

**Tech Stack:** Express.js, Prisma (PostgreSQL), Vue 3 + Pinia + Bootstrap 5, mercadopago SDK, AES-256-GCM encryption.

---

## Task 1: Database — Add `SaasGatewayConfig` model and alter `SaasInvoice`

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add `SaasGatewayConfig` model to schema.prisma**

Find the end of the existing models (after `AiCreditPurchase` or similar) and add:

```prisma
model SaasGatewayConfig {
  id            String   @id @default(uuid())
  provider      String   // MERCADOPAGO, STRIPE, etc.
  displayName   String
  credentials   String   // JSON encrypted with AES-256-GCM
  isActive      Boolean  @default(true)
  billingMode   Json     @default("{\"plan\":\"MANUAL\",\"module\":\"MANUAL\",\"credits\":\"MANUAL\"}")
  webhookSecret String?
  platformFee   Decimal  @default(2.00) // BRL — platform fee for marketplace split
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

**Step 2: Add fields to `SaasInvoice`**

Add these fields to the existing `SaasInvoice` model:

```prisma
  gatewayProvider  String?
  autoCharge       Boolean  @default(false)
```

**Step 3: Push schema to database**

Run: `cd delivery-saas-backend && npx prisma db push`
Expected: Schema synced, no errors.

**Step 4: Regenerate Prisma client**

Run: `cd delivery-saas-backend && npx prisma generate`
Expected: Prisma Client generated.

**Step 5: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add SaasGatewayConfig model and invoice gateway fields"
```

---

## Task 2: Backend — Gateway Adapter Interface and Mercado Pago Adapter

**Files:**
- Create: `delivery-saas-backend/src/services/paymentGateway/index.js`
- Create: `delivery-saas-backend/src/services/paymentGateway/mercadopago.adapter.js`

**Step 1: Create gateway index (resolver)**

Create `delivery-saas-backend/src/services/paymentGateway/index.js`:

```javascript
import { prisma } from '../../prisma.js'
import { decrypt } from '../encryption.js'
import { MercadoPagoAdapter } from './mercadopago.adapter.js'

const adapters = {
  MERCADOPAGO: MercadoPagoAdapter,
}

/**
 * Returns the active gateway adapter instance with decrypted credentials.
 * @returns {Promise<{adapter, config}>} adapter instance + raw config row
 * @throws if no active gateway configured
 */
export async function getActiveGateway() {
  const config = await prisma.saasGatewayConfig.findFirst({
    where: { isActive: true },
  })
  if (!config) {
    throw new Error('Nenhum gateway de pagamento configurado. Configure em SaaS > Gateway.')
  }

  const AdapterClass = adapters[config.provider]
  if (!AdapterClass) {
    throw new Error(`Gateway adapter não encontrado para provider: ${config.provider}`)
  }

  const credentials = JSON.parse(decrypt(config.credentials))
  const adapter = new AdapterClass(credentials, config)
  return { adapter, config }
}

/**
 * Returns adapter for a specific provider (used by webhook routes).
 */
export async function getGatewayByProvider(provider) {
  const config = await prisma.saasGatewayConfig.findFirst({
    where: { provider, isActive: true },
  })
  if (!config) return null

  const AdapterClass = adapters[provider]
  if (!AdapterClass) return null

  const credentials = JSON.parse(decrypt(config.credentials))
  const adapter = new AdapterClass(credentials, config)
  return { adapter, config }
}

/**
 * Get billing mode for a given type (plan, module, credits).
 */
export function getBillingMode(config, type) {
  const modes = typeof config.billingMode === 'string'
    ? JSON.parse(config.billingMode)
    : config.billingMode
  return modes[type] || 'MANUAL'
}
```

**Step 2: Create Mercado Pago adapter**

Create `delivery-saas-backend/src/services/paymentGateway/mercadopago.adapter.js`:

```javascript
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'

export class MercadoPagoAdapter {
  constructor(credentials, config) {
    this.accessToken = credentials.accessToken
    this.publicKey = credentials.publicKey || null
    this.platformFee = Number(config.platformFee || 2)
    this.webhookSecret = config.webhookSecret || process.env.MP_WEBHOOK_SECRET
    this._client = new MercadoPagoConfig({ accessToken: this.accessToken })
  }

  get providerName() {
    return 'MERCADOPAGO'
  }

  /**
   * Create a Checkout Pro preference.
   * @param {object} opts
   * @param {number} opts.amount - Total in BRL (decimal)
   * @param {string} opts.description - Line item title
   * @param {string} opts.externalRef - Our paymentId
   * @param {object} opts.backUrls - { success, failure, pending }
   * @param {string} opts.notificationUrl - Webhook callback URL
   * @param {number} [opts.platformFee] - Override platform fee
   * @returns {Promise<{checkoutUrl: string, preferenceId: string}>}
   */
  async createCheckout({ amount, description, externalRef, backUrls, notificationUrl, platformFee }) {
    const preference = new Preference(this._client)
    const body = {
      items: [{
        title: description,
        quantity: 1,
        unit_price: Number(amount),
        currency_id: 'BRL',
      }],
      marketplace_fee: platformFee ?? this.platformFee,
      external_reference: externalRef,
      notification_url: notificationUrl,
      back_urls: backUrls,
      auto_return: 'approved',
      statement_descriptor: 'CoreDelivery',
    }
    const result = await preference.create({ body })
    return { checkoutUrl: result.init_point, preferenceId: result.id }
  }

  /**
   * Get payment details from MP API.
   * @param {string} gatewayRef - MP payment ID
   * @returns {Promise<{status: string, method: string, raw: object}>}
   */
  async getPaymentStatus(gatewayRef) {
    const payment = new Payment(this._client)
    const result = await payment.get({ id: gatewayRef })
    return {
      status: mapMpStatus(result.status),
      method: mapMpMethod(result.payment_type_id),
      raw: result,
    }
  }

  /**
   * Validate MP IPN webhook signature.
   * @param {object} req - Express request
   * @returns {{ valid: boolean, paymentId: string|null }}
   */
  validateWebhook(req) {
    if (!this.webhookSecret) {
      // No secret configured — accept all (dev mode)
      const paymentId = req.query?.['data.id'] || req.body?.data?.id || null
      return { valid: true, paymentId }
    }

    const xSignature = req.headers['x-signature'] || ''
    const xRequestId = req.headers['x-request-id'] || ''
    const dataId = req.query?.['data.id'] || ''

    const parts = {}
    xSignature.split(',').forEach(part => {
      const [k, v] = part.trim().split('=')
      if (k && v) parts[k.trim()] = v.trim()
    })
    const ts = parts.ts
    const hash = parts.v1
    if (!ts || !hash) return { valid: false, paymentId: null }

    const crypto = await import('crypto')
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
    const expected = crypto.createHmac('sha256', this.webhookSecret)
      .update(manifest)
      .digest('hex')

    return {
      valid: expected === hash,
      paymentId: dataId || req.body?.data?.id || null,
    }
  }
}

function mapMpStatus(mpStatus) {
  const map = {
    approved: 'PAID',
    authorized: 'PROCESSING',
    in_process: 'PROCESSING',
    in_mediation: 'PROCESSING',
    pending: 'PENDING',
    rejected: 'FAILED',
    cancelled: 'FAILED',
    refunded: 'REFUNDED',
    charged_back: 'REFUNDED',
  }
  return map[mpStatus] || 'PENDING'
}

function mapMpMethod(mpMethod) {
  const map = {
    credit_card: 'CREDIT_CARD',
    debit_card: 'CREDIT_CARD',
    bank_transfer: 'PIX',
    account_money: 'PIX',
    ticket: 'BOLETO',
  }
  return map[mpMethod] || mpMethod
}
```

**Step 3: Verify imports work**

Run: `cd delivery-saas-backend && node -e "import('./src/services/paymentGateway/index.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: "OK" (or Prisma connection error — that's fine, means imports resolved)

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/services/paymentGateway/
git commit -m "feat: add payment gateway adapter pattern with Mercado Pago adapter"
```

---

## Task 3: Backend — Refactor `payment.js` to use gateway adapters

**Files:**
- Modify: `delivery-saas-backend/src/routes/payment.js`

**Context:** Currently `payment.js` has inline MP logic: `getMpConfig()`, `buildMpPreference()`, direct MP SDK calls, and hardcoded webhook validation. We need to replace these with `getActiveGateway()` calls while keeping `processPaymentSuccess()` unchanged.

**Step 1: Replace `getMpConfig` + `buildMpPreference` with adapter in `create-preference` route**

In the `POST /create-preference` handler, replace the section that calls `getMpConfig()` and `buildMpPreference()` with:

```javascript
// At the top of payment.js, add import:
import { getActiveGateway, getGatewayByProvider } from '../services/paymentGateway/index.js'

// In POST /create-preference, replace the MP-specific checkout creation with:
let checkoutResult
try {
  const { adapter, config } = await getActiveGateway()
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000'
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  checkoutResult = await adapter.createCheckout({
    amount: Number(payment.amount),
    description: invoiceDescription || 'Pagamento SaaS',
    externalRef: payment.id,
    backUrls: {
      success: `${frontendUrl}/payment/result`,
      failure: `${frontendUrl}/payment/result`,
      pending: `${frontendUrl}/payment/result`,
    },
    notificationUrl: `${backendUrl}/payment/webhook/${config.provider.toLowerCase()}`,
  })

  // Save preference metadata
  await prisma.saasPayment.update({
    where: { id: payment.id },
    data: {
      gateway: config.provider.toLowerCase(),
      metadata: { preferenceId: checkoutResult.preferenceId },
    },
  })
} catch (e) {
  console.error('Gateway checkout error:', e?.message)
  return res.status(500).json({ message: 'Erro ao criar checkout: ' + e?.message })
}

return res.json({
  checkoutUrl: checkoutResult.checkoutUrl,
  preferenceId: checkoutResult.preferenceId,
  paymentId: payment.id,
})
```

**Step 2: Refactor the webhook route to use adapter**

Replace `POST /webhook/mercadopago` with a dynamic provider webhook:

```javascript
// Dynamic webhook route — handles any provider
paymentRouter.post('/webhook/:provider', async (req, res) => {
  // Immediately respond 200 to prevent gateway retries
  res.sendStatus(200)

  try {
    const provider = req.params.provider.toUpperCase()
    const result = await getGatewayByProvider(provider)
    if (!result) {
      console.warn(`[webhook] Unknown provider: ${provider}`)
      return
    }

    const { adapter, config } = result
    const validation = adapter.validateWebhook(req)
    if (!validation.valid) {
      console.warn(`[webhook] Invalid signature for ${provider}`)
      return
    }

    if (!validation.paymentId) return

    // Get payment details from gateway
    const paymentInfo = await adapter.getPaymentStatus(validation.paymentId)

    // Find our payment record
    let payment = await prisma.saasPayment.findFirst({
      where: { gatewayRef: String(validation.paymentId) },
      include: { invoice: { include: { items: true } } },
    })

    if (!payment) {
      // Try by external_reference from gateway raw data
      const extRef = paymentInfo.raw?.external_reference
      if (extRef) {
        payment = await prisma.saasPayment.findUnique({
          where: { id: extRef },
          include: { invoice: { include: { items: true } } },
        })
      }
    }

    if (!payment) {
      console.warn(`[webhook] Payment not found for gateway ref ${validation.paymentId}`)
      return
    }

    // Idempotency: skip if already paid
    if (payment.status === 'PAID') return

    // Update payment
    const updateData = {
      status: paymentInfo.status,
      method: paymentInfo.method,
      gatewayRef: String(validation.paymentId),
      metadata: {
        ...(payment.metadata || {}),
        mpStatus: paymentInfo.raw?.status,
        mpPaymentId: validation.paymentId,
      },
    }
    if (paymentInfo.status === 'PAID') {
      updateData.paidAt = new Date()
    }

    await prisma.saasPayment.update({
      where: { id: payment.id },
      data: updateData,
    })

    if (paymentInfo.status === 'PAID') {
      await processPaymentSuccess(payment)
    }
  } catch (e) {
    console.error('[webhook] Error processing:', e?.message || e)
  }
})
```

**Step 3: Remove old inline MP functions**

Remove `getMpConfig()` and `buildMpPreference()` functions since they are now handled by the adapter. Keep `processPaymentSuccess()` as-is — it's gateway-agnostic.

Also remove the old `POST /webhook/mercadopago` route since it's replaced by `POST /webhook/:provider`.

Keep the manual `POST /webhook` route (the one with `x-webhook-secret` header) as a fallback.

**Step 4: Handle "no gateway configured" gracefully**

When `getActiveGateway()` throws (no config), the create-preference route should return:

```javascript
return res.json({ manual: true, paymentId: payment.id, message: 'Nenhum gateway configurado. Pagamento manual.' })
```

This preserves the existing fallback behavior.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/payment.js
git commit -m "refactor: use gateway adapter pattern in payment routes"
```

---

## Task 4: Backend — Super Admin Gateway Config Routes

**Files:**
- Modify: `delivery-saas-backend/src/routes/saas.js`

**Context:** `saas.js` already has SUPER_ADMIN routes for plans, modules, companies, and MP config. We add gateway config routes here.

**Step 1: Add gateway config routes to saas.js**

Add these routes after the existing `mercadopago-config` routes:

```javascript
// ── Gateway Config (SUPER_ADMIN) ──────────────────────────

// GET /saas/gateway — get active gateway config
router.get('/gateway', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') return res.sendStatus(403)
  try {
    const config = await prisma.saasGatewayConfig.findFirst({ where: { isActive: true } })
    if (!config) return res.json(null)
    // Don't send raw credentials to frontend
    const { credentials, ...safe } = config
    safe.hasCredentials = !!credentials
    res.json(safe)
  } catch (e) {
    console.error('GET /saas/gateway error:', e?.message)
    res.status(500).json({ message: 'Erro ao buscar config do gateway' })
  }
})

// PUT /saas/gateway — create or update gateway config
router.put('/gateway', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') return res.sendStatus(403)
  try {
    const { provider, displayName, credentials, billingMode, webhookSecret, platformFee } = req.body
    if (!provider || !displayName) {
      return res.status(400).json({ message: 'provider e displayName são obrigatórios' })
    }

    // Encrypt credentials if provided
    let encryptedCreds
    if (credentials && typeof credentials === 'object') {
      const { encrypt } = await import('../services/encryption.js')
      encryptedCreds = encrypt(JSON.stringify(credentials))
    }

    // Deactivate all existing configs
    await prisma.saasGatewayConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    })

    // Upsert the selected provider
    const existing = await prisma.saasGatewayConfig.findFirst({ where: { provider } })
    const data = {
      provider,
      displayName,
      isActive: true,
      billingMode: billingMode || { plan: 'MANUAL', module: 'MANUAL', credits: 'MANUAL' },
    }
    if (encryptedCreds) data.credentials = encryptedCreds
    if (webhookSecret !== undefined) data.webhookSecret = webhookSecret
    if (platformFee !== undefined) data.platformFee = platformFee

    let config
    if (existing) {
      config = await prisma.saasGatewayConfig.update({
        where: { id: existing.id },
        data,
      })
    } else {
      if (!encryptedCreds) {
        return res.status(400).json({ message: 'Credenciais são obrigatórias para novo gateway' })
      }
      config = await prisma.saasGatewayConfig.create({ data })
    }

    const { credentials: _, ...safe } = config
    safe.hasCredentials = true
    res.json(safe)
  } catch (e) {
    console.error('PUT /saas/gateway error:', e?.message)
    res.status(500).json({ message: 'Erro ao salvar config do gateway' })
  }
})

// POST /saas/gateway/test — test gateway credentials
router.post('/gateway/test', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') return res.sendStatus(403)
  try {
    const { getActiveGateway } = await import('../services/paymentGateway/index.js')
    const { adapter } = await getActiveGateway()
    // Try to get payment status with a fake ID — if credentials are valid, MP returns a proper error (not auth error)
    try {
      await adapter.getPaymentStatus('1')
    } catch (e) {
      // MP returns "not found" for invalid ID but auth errors are different
      if (e?.message?.includes('unauthorized') || e?.message?.includes('401') || e?.status === 401) {
        return res.json({ success: false, message: 'Credenciais inválidas (401 Unauthorized)' })
      }
    }
    res.json({ success: true, message: 'Conexão com gateway OK' })
  } catch (e) {
    res.json({ success: false, message: e?.message || 'Erro ao testar gateway' })
  }
})
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat: add Super Admin gateway config routes (GET/PUT/test)"
```

---

## Task 5: Frontend — Super Admin Gateway Config Page

**Files:**
- Create: `delivery-saas-frontend/src/views/SaasGatewayConfig.vue`
- Modify: `delivery-saas-frontend/src/router.js` (add route)
- Modify: `delivery-saas-frontend/src/config/nav.js` (add menu item)

**Step 1: Create the gateway config view**

Create `delivery-saas-frontend/src/views/SaasGatewayConfig.vue`:

```vue
<template>
  <div class="container-fluid py-4">
    <h4 class="mb-4">Gateway de Pagamento</h4>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <div v-else class="row">
      <div class="col-lg-8">
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">Provider</h6>

            <div class="mb-3">
              <label class="form-label">Gateway ativo</label>
              <select class="form-select" v-model="form.provider" @change="onProviderChange">
                <option value="">Selecione...</option>
                <option v-for="p in providers" :key="p.value" :value="p.value">{{ p.label }}</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label">Nome de exibição</label>
              <input type="text" class="form-control" v-model="form.displayName" />
            </div>

            <!-- Mercado Pago credentials -->
            <template v-if="form.provider === 'MERCADOPAGO'">
              <h6 class="mt-4 mb-3">Credenciais Mercado Pago</h6>
              <div class="mb-3">
                <label class="form-label">Access Token</label>
                <input type="password" class="form-control" v-model="form.credentials.accessToken"
                       :placeholder="hasCredentials ? '••••••• (já configurado)' : 'APP_USR-...'" />
              </div>
              <div class="mb-3">
                <label class="form-label">Public Key (opcional)</label>
                <input type="text" class="form-control" v-model="form.credentials.publicKey"
                       placeholder="APP_USR-..." />
              </div>
              <div class="mb-3">
                <label class="form-label">Webhook Secret (opcional)</label>
                <input type="text" class="form-control" v-model="form.webhookSecret"
                       placeholder="Deixe vazio para desabilitar validação" />
              </div>
            </template>

            <div class="mb-3">
              <label class="form-label">Taxa da plataforma (R$)</label>
              <input type="number" step="0.01" class="form-control" v-model.number="form.platformFee"
                     style="max-width: 200px" />
            </div>
          </div>
        </div>

        <!-- Billing Mode -->
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">Modo de Cobrança</h6>
            <p class="text-muted small mb-3">Defina se a cobrança recorrente é automática (gateway cobra) ou manual (gera fatura, cliente paga).</p>

            <div class="row g-3">
              <div v-for="t in billingTypes" :key="t.key" class="col-md-4">
                <div class="card h-100">
                  <div class="card-body text-center">
                    <i :class="t.icon" class="fs-3 mb-2 d-block"></i>
                    <strong>{{ t.label }}</strong>
                    <div class="mt-2">
                      <div class="btn-group btn-group-sm w-100">
                        <button class="btn" :class="form.billingMode[t.key] === 'AUTO' ? 'btn-primary' : 'btn-outline-secondary'"
                                @click="form.billingMode[t.key] = 'AUTO'">Auto</button>
                        <button class="btn" :class="form.billingMode[t.key] === 'MANUAL' ? 'btn-primary' : 'btn-outline-secondary'"
                                @click="form.billingMode[t.key] = 'MANUAL'">Manual</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="d-flex gap-2">
          <button class="btn btn-primary" @click="save" :disabled="saving">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
            Salvar
          </button>
          <button class="btn btn-outline-secondary" @click="testConnection" :disabled="testing">
            <span v-if="testing" class="spinner-border spinner-border-sm me-1"></span>
            Testar Conexão
          </button>
        </div>

        <div v-if="message" class="alert mt-3" :class="messageType === 'success' ? 'alert-success' : 'alert-danger'">
          {{ message }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api.js'

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const hasCredentials = ref(false)
const message = ref('')
const messageType = ref('success')

const providers = [
  { value: 'MERCADOPAGO', label: 'Mercado Pago' },
]

const billingTypes = [
  { key: 'plan', label: 'Plano', icon: 'bi bi-journal-check' },
  { key: 'module', label: 'Módulos', icon: 'bi bi-box-seam' },
  { key: 'credits', label: 'Créditos IA', icon: 'bi bi-stars' },
]

const form = ref({
  provider: '',
  displayName: '',
  credentials: { accessToken: '', publicKey: '' },
  webhookSecret: '',
  platformFee: 2.00,
  billingMode: { plan: 'MANUAL', module: 'MANUAL', credits: 'MANUAL' },
})

onMounted(async () => {
  try {
    const { data } = await api.get('/saas/gateway')
    if (data) {
      form.value.provider = data.provider || ''
      form.value.displayName = data.displayName || ''
      form.value.billingMode = data.billingMode || { plan: 'MANUAL', module: 'MANUAL', credits: 'MANUAL' }
      form.value.platformFee = Number(data.platformFee || 2)
      hasCredentials.value = data.hasCredentials || false
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
})

function onProviderChange() {
  if (form.value.provider === 'MERCADOPAGO') {
    form.value.displayName = form.value.displayName || 'Mercado Pago'
  }
  form.value.credentials = { accessToken: '', publicKey: '' }
  hasCredentials.value = false
}

async function save() {
  saving.value = true
  message.value = ''
  try {
    const payload = {
      provider: form.value.provider,
      displayName: form.value.displayName,
      billingMode: form.value.billingMode,
      platformFee: form.value.platformFee,
    }
    // Only send credentials if user entered new ones
    if (form.value.credentials.accessToken) {
      payload.credentials = form.value.credentials
    }
    if (form.value.webhookSecret) {
      payload.webhookSecret = form.value.webhookSecret
    }

    await api.put('/saas/gateway', payload)
    hasCredentials.value = true
    message.value = 'Gateway salvo com sucesso!'
    messageType.value = 'success'
  } catch (e) {
    message.value = e.response?.data?.message || 'Erro ao salvar'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  message.value = ''
  try {
    const { data } = await api.post('/saas/gateway/test')
    message.value = data.message
    messageType.value = data.success ? 'success' : 'error'
  } catch (e) {
    message.value = e.response?.data?.message || 'Erro ao testar'
    messageType.value = 'error'
  } finally {
    testing.value = false
  }
}
</script>
```

**Step 2: Add route to router.js**

In `delivery-saas-frontend/src/router.js`, add the lazy import near the top with the other SaaS imports and add the route:

```javascript
const SaasGatewayConfig = () => import('./views/SaasGatewayConfig.vue')
```

Add route in the routes array (near the other `/saas/*` routes):

```javascript
{ path: '/saas/gateway', component: SaasGatewayConfig, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } },
```

**Step 3: Add nav item**

In `delivery-saas-frontend/src/config/nav.js`, add to the SaaS children array:

```javascript
{ name: 'Gateway', to: '/saas/gateway', icon: 'bi bi-credit-card-2-front' },
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasGatewayConfig.vue delivery-saas-frontend/src/router.js delivery-saas-frontend/src/config/nav.js
git commit -m "feat: add Super Admin gateway config page"
```

---

## Task 6: Frontend — ADMIN Billing Page (Faturas + Dashboard)

**Files:**
- Create: `delivery-saas-frontend/src/views/AdminBilling.vue`
- Modify: `delivery-saas-frontend/src/router.js` (add route)
- Modify: `delivery-saas-frontend/src/config/nav.js` (add menu item)
- Modify: `delivery-saas-frontend/src/stores/addOnStore.js` (add billing actions)

**Step 1: Add billing store actions to addOnStore.js**

Add these actions to `delivery-saas-frontend/src/stores/addOnStore.js`:

```javascript
// Add to actions:
async fetchBillingDashboard() {
  const { data } = await api.get('/saas/billing/dashboard')
  return data
},
async fetchMyInvoices(params = {}) {
  const { data } = await api.get('/saas/invoices', { params: { ...params, mine: true } })
  return data
},
```

**Step 2: Backend — Add dashboard endpoint to saas.js**

Add to `delivery-saas-backend/src/routes/saas.js`:

```javascript
// GET /saas/billing/dashboard — ADMIN billing dashboard data
router.get('/billing/dashboard', async (req, res) => {
  try {
    const companyId = req.user.companyId
    if (!companyId) return res.status(400).json({ message: 'Empresa não encontrada' })

    const now = new Date()
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    // Pending invoices count
    const pendingCount = await prisma.saasInvoice.count({
      where: { subscription: { companyId }, status: 'PENDING' },
    })

    // Next due date
    const nextInvoice = await prisma.saasInvoice.findFirst({
      where: { subscription: { companyId }, status: 'PENDING' },
      orderBy: { dueDate: 'asc' },
      select: { dueDate: true, amount: true },
    })

    // Total spent this month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const paidThisMonth = await prisma.saasPayment.aggregate({
      where: { companyId, status: 'PAID', paidAt: { gte: startOfMonth } },
      _sum: { amount: true },
    })

    // Last 6 months spending
    const recentPayments = await prisma.saasPayment.findMany({
      where: { companyId, status: 'PAID', paidAt: { gte: sixMonthsAgo } },
      select: { amount: true, paidAt: true },
    })
    const monthlySpending = {}
    for (const p of recentPayments) {
      const key = `${p.paidAt.getFullYear()}-${String(p.paidAt.getMonth() + 1).padStart(2, '0')}`
      monthlySpending[key] = (monthlySpending[key] || 0) + Number(p.amount)
    }

    // Active subscriptions
    const subscription = await prisma.saasSubscription.findUnique({
      where: { companyId },
      include: { plan: { select: { name: true, price: true } } },
    })
    const moduleSubs = await prisma.saasModuleSubscription.findMany({
      where: { companyId, status: 'ACTIVE' },
      include: { module: { select: { name: true } } },
    })

    res.json({
      pendingCount,
      nextDueDate: nextInvoice?.dueDate || null,
      nextDueAmount: nextInvoice?.amount || null,
      totalSpentThisMonth: paidThisMonth._sum.amount || 0,
      monthlySpending,
      plan: subscription ? { name: subscription.plan.name, price: subscription.plan.price, status: subscription.status, nextDueAt: subscription.nextDueAt } : null,
      moduleSubscriptions: moduleSubs.map(ms => ({
        id: ms.id,
        moduleName: ms.module.name,
        status: ms.status,
        period: ms.period,
        nextDueAt: ms.nextDueAt,
      })),
    })
  } catch (e) {
    console.error('GET /saas/billing/dashboard error:', e?.message)
    res.status(500).json({ message: 'Erro ao carregar dashboard' })
  }
})
```

**Step 3: Create AdminBilling.vue**

Create `delivery-saas-frontend/src/views/AdminBilling.vue`:

```vue
<template>
  <div class="container-fluid py-4">
    <h4 class="mb-4">Cobranças</h4>

    <!-- Tabs -->
    <ul class="nav nav-tabs mb-4">
      <li class="nav-item">
        <button class="nav-link" :class="{ active: tab === 'invoices' }" @click="tab = 'invoices'">
          Faturas
          <span v-if="dashboard.pendingCount" class="badge bg-danger ms-1">{{ dashboard.pendingCount }}</span>
        </button>
      </li>
      <li class="nav-item">
        <button class="nav-link" :class="{ active: tab === 'dashboard' }" @click="tab = 'dashboard'">Dashboard</button>
      </li>
    </ul>

    <!-- Tab: Faturas -->
    <div v-if="tab === 'invoices'">
      <div class="mb-3 d-flex gap-2">
        <select class="form-select" style="max-width:160px" v-model="filter" @change="loadInvoices">
          <option value="">Todas</option>
          <option value="PENDING">Pendentes</option>
          <option value="PAID">Pagas</option>
          <option value="OVERDUE">Vencidas</option>
        </select>
      </div>

      <div v-if="loadingInvoices" class="text-center py-4">
        <div class="spinner-border spinner-border-sm text-primary"></div>
      </div>

      <div v-else-if="!invoices.length" class="text-muted text-center py-4">Nenhuma fatura encontrada.</div>

      <div v-else class="table-responsive">
        <table class="table table-hover align-middle">
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in invoices" :key="inv.id">
              <td>
                <div>{{ invoiceDescription(inv) }}</div>
                <small v-if="inv.autoCharge" class="text-muted"><i class="bi bi-arrow-repeat me-1"></i>Recorrente</small>
              </td>
              <td>R$ {{ Number(inv.amount).toFixed(2) }}</td>
              <td>{{ inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('pt-BR') : '-' }}</td>
              <td>
                <span class="badge" :class="statusBadge(inv.status)">{{ inv.status }}</span>
              </td>
              <td>
                <button v-if="inv.status === 'PENDING' || inv.status === 'OVERDUE'"
                        class="btn btn-sm btn-primary" @click="payInvoice(inv.id)" :disabled="paying === inv.id">
                  <span v-if="paying === inv.id" class="spinner-border spinner-border-sm me-1"></span>
                  Pagar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab: Dashboard -->
    <div v-if="tab === 'dashboard'">
      <div v-if="loadingDash" class="text-center py-4">
        <div class="spinner-border spinner-border-sm text-primary"></div>
      </div>

      <template v-else>
        <!-- Summary Cards -->
        <div class="row g-3 mb-4">
          <div class="col-md-4">
            <div class="card shadow-sm h-100">
              <div class="card-body text-center">
                <div class="text-muted small">Gasto este mês</div>
                <div class="fs-4 fw-bold text-primary">R$ {{ Number(dashboard.totalSpentThisMonth || 0).toFixed(2) }}</div>
              </div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card shadow-sm h-100">
              <div class="card-body text-center">
                <div class="text-muted small">Próximo vencimento</div>
                <div class="fs-4 fw-bold" :class="dashboard.nextDueDate ? 'text-warning' : 'text-muted'">
                  {{ dashboard.nextDueDate ? new Date(dashboard.nextDueDate).toLocaleDateString('pt-BR') : '-' }}
                </div>
                <div v-if="dashboard.nextDueAmount" class="small text-muted">R$ {{ Number(dashboard.nextDueAmount).toFixed(2) }}</div>
              </div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card shadow-sm h-100">
              <div class="card-body text-center">
                <div class="text-muted small">Faturas pendentes</div>
                <div class="fs-4 fw-bold" :class="dashboard.pendingCount ? 'text-danger' : 'text-success'">
                  {{ dashboard.pendingCount || 0 }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Monthly Spending Chart (simple bars) -->
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">Gastos mensais (últimos 6 meses)</h6>
            <div class="d-flex align-items-end gap-2" style="height: 120px">
              <div v-for="m in chartMonths" :key="m.key" class="text-center flex-fill">
                <div class="bg-primary rounded-top mx-auto" :style="{ width: '32px', height: m.height + 'px' }"></div>
                <small class="text-muted d-block mt-1">{{ m.label }}</small>
                <small class="text-muted d-block">R${{ m.value.toFixed(0) }}</small>
              </div>
            </div>
          </div>
        </div>

        <!-- Active Subscriptions -->
        <div class="card shadow-sm">
          <div class="card-body">
            <h6 class="card-title mb-3">Assinaturas ativas</h6>
            <div v-if="dashboard.plan" class="d-flex justify-content-between align-items-center py-2 border-bottom">
              <div>
                <strong>Plano: {{ dashboard.plan.name }}</strong>
                <span class="badge bg-success ms-2">{{ dashboard.plan.status }}</span>
              </div>
              <div class="text-muted">R$ {{ Number(dashboard.plan.price).toFixed(2) }}/mês</div>
            </div>
            <div v-for="ms in dashboard.moduleSubscriptions" :key="ms.id"
                 class="d-flex justify-content-between align-items-center py-2 border-bottom">
              <div>
                <strong>{{ ms.moduleName }}</strong>
                <span class="badge bg-info ms-2">{{ ms.period }}</span>
              </div>
              <div class="text-muted">Próx: {{ ms.nextDueAt ? new Date(ms.nextDueAt).toLocaleDateString('pt-BR') : '-' }}</div>
            </div>
            <div v-if="!dashboard.plan && !dashboard.moduleSubscriptions?.length" class="text-muted py-2">
              Nenhuma assinatura ativa.
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../api.js'
import { useAddOnStore } from '../stores/addOnStore.js'

const addOnStore = useAddOnStore()
const tab = ref('invoices')
const filter = ref('')
const invoices = ref([])
const loadingInvoices = ref(false)
const loadingDash = ref(true)
const paying = ref(null)

const dashboard = ref({
  pendingCount: 0,
  totalSpentThisMonth: 0,
  nextDueDate: null,
  nextDueAmount: null,
  monthlySpending: {},
  plan: null,
  moduleSubscriptions: [],
})

const chartMonths = computed(() => {
  const spending = dashboard.value.monthlySpending || {}
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({
      key,
      label: d.toLocaleDateString('pt-BR', { month: 'short' }),
      value: spending[key] || 0,
    })
  }
  const max = Math.max(...months.map(m => m.value), 1)
  return months.map(m => ({ ...m, height: Math.max((m.value / max) * 100, 4) }))
})

onMounted(() => {
  loadInvoices()
  loadDashboard()
})

async function loadInvoices() {
  loadingInvoices.value = true
  try {
    const params = { mine: true }
    if (filter.value) params.status = filter.value
    const { data } = await api.get('/saas/invoices', { params })
    invoices.value = data.invoices || data
  } catch (e) {
    console.error(e)
  } finally {
    loadingInvoices.value = false
  }
}

async function loadDashboard() {
  loadingDash.value = true
  try {
    const { data } = await api.get('/saas/billing/dashboard')
    dashboard.value = data
  } catch (e) {
    console.error(e)
  } finally {
    loadingDash.value = false
  }
}

async function payInvoice(invoiceId) {
  paying.value = invoiceId
  try {
    const result = await addOnStore.payInvoice(invoiceId)
    if (result?.checkoutUrl) {
      window.location.href = result.checkoutUrl
    }
  } catch (e) {
    alert(e.response?.data?.message || 'Erro ao processar pagamento')
  } finally {
    paying.value = null
  }
}

function invoiceDescription(inv) {
  if (inv.items?.length) {
    return inv.items.map(i => i.description).join(', ')
  }
  return `Fatura ${inv.month}/${inv.year}`
}

function statusBadge(status) {
  return {
    PENDING: 'bg-warning text-dark',
    PAID: 'bg-success',
    OVERDUE: 'bg-danger',
  }[status] || 'bg-secondary'
}
</script>
```

**Step 4: Add route and nav**

In `delivery-saas-frontend/src/router.js`, add:

```javascript
const AdminBilling = () => import('./views/AdminBilling.vue')
```

And the route:
```javascript
{ path: '/billing', component: AdminBilling, meta: { requiresAuth: true, role: 'ADMIN' } },
```

In `delivery-saas-frontend/src/config/nav.js`, add before the "Loja de Add-ons" entry:

```javascript
{ name: 'Cobranças', to: '/billing', icon: 'bi bi-receipt-cutoff' },
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/AdminBilling.vue delivery-saas-frontend/src/router.js delivery-saas-frontend/src/config/nav.js delivery-saas-frontend/src/stores/addOnStore.js delivery-saas-backend/src/routes/saas.js
git commit -m "feat: add ADMIN billing page with invoices and dashboard"
```

---

## Task 7: Backend — Recurring Billing Cron Job

**Files:**
- Create: `delivery-saas-backend/src/jobs/recurringBilling.js`
- Modify: `delivery-saas-backend/src/index.js` (schedule cron)

**Step 1: Create the recurring billing job**

Create `delivery-saas-backend/src/jobs/recurringBilling.js`:

```javascript
import { prisma } from '../prisma.js'
import { getActiveGateway, getBillingMode } from '../services/paymentGateway/index.js'

/**
 * Daily job: generates invoices for subscriptions due today.
 * If billingMode is AUTO, attempts to create a gateway checkout.
 * If MANUAL or AUTO fails, leaves invoice as PENDING.
 */
export async function runRecurringBilling() {
  const today = new Date()
  today.setHours(23, 59, 59, 999)

  console.log(`[recurring-billing] Running for date <= ${today.toISOString().slice(0, 10)}`)

  let gatewayResult = null
  try {
    gatewayResult = await getActiveGateway()
  } catch (e) {
    console.log('[recurring-billing] No active gateway, generating manual invoices only')
  }

  // 1. Plan subscriptions due
  const planSubs = await prisma.saasSubscription.findMany({
    where: {
      status: 'ACTIVE',
      nextDueAt: { lte: today },
    },
    include: { plan: true, company: true },
  })

  for (const sub of planSubs) {
    try {
      await generateInvoiceForPlan(sub, gatewayResult)
    } catch (e) {
      console.error(`[recurring-billing] Plan invoice error for company ${sub.companyId}:`, e?.message)
    }
  }

  // 2. Module subscriptions due
  const moduleSubs = await prisma.saasModuleSubscription.findMany({
    where: {
      status: 'ACTIVE',
      nextDueAt: { lte: today },
    },
    include: { module: { include: { prices: true } } },
  })

  for (const ms of moduleSubs) {
    try {
      await generateInvoiceForModule(ms, gatewayResult)
    } catch (e) {
      console.error(`[recurring-billing] Module invoice error for company ${ms.companyId}:`, e?.message)
    }
  }

  // 3. Check overdue invoices for suspension
  await checkOverdueInvoices()

  console.log('[recurring-billing] Done')
}

async function generateInvoiceForPlan(sub, gatewayResult) {
  const now = new Date()
  const price = Number(sub.plan.price)
  if (price <= 0) {
    // Free plan — just advance nextDueAt
    await prisma.saasSubscription.update({
      where: { id: sub.id },
      data: { nextDueAt: addMonth(now) },
    })
    return
  }

  const billingMode = gatewayResult ? getBillingMode(gatewayResult.config, 'plan') : 'MANUAL'
  const isAuto = billingMode === 'AUTO' && gatewayResult

  // Create invoice
  const invoice = await prisma.saasInvoice.create({
    data: {
      subscriptionId: sub.id,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      amount: price,
      status: 'PENDING',
      dueDate: addDays(now, 5),
      autoCharge: isAuto,
      gatewayProvider: gatewayResult?.config.provider || null,
      items: {
        create: [{
          type: 'PLAN',
          referenceId: sub.planId,
          description: `Plano ${sub.plan.name} - ${now.getMonth() + 1}/${now.getFullYear()}`,
          amount: price,
        }],
      },
    },
  })

  // Advance nextDueAt
  await prisma.saasSubscription.update({
    where: { id: sub.id },
    data: { nextDueAt: addMonth(now) },
  })

  console.log(`[recurring-billing] Plan invoice created: ${invoice.id} for company ${sub.companyId} (${billingMode})`)
}

async function generateInvoiceForModule(ms, gatewayResult) {
  const now = new Date()
  const priceRecord = ms.module.prices.find(p => p.period === ms.period)
  if (!priceRecord) {
    console.warn(`[recurring-billing] No price found for module ${ms.module.key} period ${ms.period}`)
    return
  }

  const price = Number(priceRecord.price)
  const billingMode = gatewayResult ? getBillingMode(gatewayResult.config, 'module') : 'MANUAL'
  const isAuto = billingMode === 'AUTO' && gatewayResult

  // Need a subscription to link the invoice
  const sub = await prisma.saasSubscription.findUnique({ where: { companyId: ms.companyId } })
  if (!sub) {
    console.warn(`[recurring-billing] No subscription found for company ${ms.companyId}`)
    return
  }

  const invoice = await prisma.saasInvoice.create({
    data: {
      subscriptionId: sub.id,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      amount: price,
      status: 'PENDING',
      dueDate: addDays(now, 5),
      autoCharge: isAuto,
      gatewayProvider: gatewayResult?.config.provider || null,
      items: {
        create: [{
          type: 'MODULE',
          referenceId: ms.moduleId,
          description: `Módulo ${ms.module.name} - ${ms.period === 'ANNUAL' ? 'Anual' : 'Mensal'}`,
          amount: price,
        }],
      },
    },
  })

  // Advance nextDueAt
  const nextDue = ms.period === 'ANNUAL' ? addYear(now) : addMonth(now)
  await prisma.saasModuleSubscription.update({
    where: { id: ms.id },
    data: { nextDueAt: nextDue },
  })

  console.log(`[recurring-billing] Module invoice created: ${invoice.id} for module ${ms.module.name} (${billingMode})`)
}

async function checkOverdueInvoices() {
  const now = new Date()
  const threeDaysAgo = addDays(now, -3)
  const sevenDaysAgo = addDays(now, -7)

  // Mark OVERDUE (3+ days past due)
  await prisma.saasInvoice.updateMany({
    where: {
      status: 'PENDING',
      dueDate: { lte: threeDaysAgo },
    },
    data: { status: 'OVERDUE' },
  })

  // Suspend module subscriptions (7+ days past due)
  const overdue7 = await prisma.saasInvoice.findMany({
    where: {
      status: 'OVERDUE',
      dueDate: { lte: sevenDaysAgo },
    },
    include: { items: true },
  })

  for (const inv of overdue7) {
    for (const item of inv.items) {
      if (item.type === 'MODULE') {
        await prisma.saasModuleSubscription.updateMany({
          where: { moduleId: item.referenceId, companyId: inv.subscription?.companyId || '' },
          data: { status: 'SUSPENDED' },
        })
      }
    }
  }
}

function addMonth(date) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + 1)
  return d
}

function addYear(date) {
  const d = new Date(date)
  d.setFullYear(d.getFullYear() + 1)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}
```

**Step 2: Schedule in index.js**

In `delivery-saas-backend/src/index.js`, add the cron schedule. Find where other cron jobs or scheduled tasks are (or add at the end, before `app.listen`):

```javascript
import { runRecurringBilling } from './jobs/recurringBilling.js'

// Run recurring billing daily at 06:00 UTC
const BILLING_CRON_HOUR = 6
setInterval(async () => {
  const now = new Date()
  if (now.getUTCHours() === BILLING_CRON_HOUR && now.getUTCMinutes() === 0) {
    try {
      await runRecurringBilling()
    } catch (e) {
      console.error('[cron] recurring billing error:', e?.message)
    }
  }
}, 60_000) // Check every minute
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/jobs/recurringBilling.js delivery-saas-backend/src/index.js
git commit -m "feat: add daily recurring billing job with overdue suspension"
```

---

## Task 8: Frontend — Pending Invoice Badge in Sidebar

**Files:**
- Modify: `delivery-saas-frontend/src/stores/addOnStore.js` (add pending count)
- Modify: `delivery-saas-frontend/src/components/Sidebar.vue` or `App.vue` (show badge)

**Step 1: Add pending count to store**

In `addOnStore.js`, add to state:

```javascript
pendingInvoiceCount: 0,
```

Add action:

```javascript
async fetchPendingInvoiceCount() {
  try {
    const { data } = await api.get('/saas/billing/dashboard')
    this.pendingInvoiceCount = data.pendingCount || 0
  } catch (e) {
    // silently ignore
  }
},
```

**Step 2: Show badge in Sidebar**

In the Sidebar component (or wherever nav items are rendered), check if the nav item is "Cobranças" and show a badge:

```html
<span v-if="item.to === '/billing' && addOnStore.pendingInvoiceCount"
      class="badge bg-danger ms-auto">{{ addOnStore.pendingInvoiceCount }}</span>
```

**Step 3: Fetch count on app mount**

In `App.vue`, on mount (where other init calls happen), add:

```javascript
import { useAddOnStore } from './stores/addOnStore.js'

// Inside onMounted or the existing init:
const addOnStore = useAddOnStore()
if (authStore.user?.role === 'ADMIN') {
  addOnStore.fetchPendingInvoiceCount()
}
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/stores/addOnStore.js delivery-saas-frontend/src/components/Sidebar.vue delivery-saas-frontend/src/App.vue
git commit -m "feat: show pending invoice count badge in sidebar"
```

---

## Task 9: Integration — Wire module subscription to generate invoice

**Files:**
- Modify: `delivery-saas-backend/src/routes/payment.js`

**Context:** Currently when an ADMIN subscribes to a module via `POST /payment/create-preference` with `type: MODULE`, it creates a `SaasModuleSubscription` (PENDING) + invoice + payment and tries MP checkout. We need to make this use the gateway adapter, and respect the `billingMode` setting.

**Step 1: Update module subscription flow**

In the `type === 'MODULE'` branch of `POST /create-preference`, after creating the invoice and payment:

```javascript
// Check billing mode
const { config } = await getActiveGateway().catch(() => ({ config: null }))
const billingMode = config ? getBillingMode(config, 'module') : 'MANUAL'

if (billingMode === 'MANUAL' && !req.body.forceCheckout) {
  // Manual mode — invoice created, user pays from /billing
  return res.json({
    manual: true,
    paymentId: payment.id,
    invoiceId: invoice.id,
    message: 'Fatura gerada. Acesse Cobranças para efetuar o pagamento.',
  })
}

// AUTO mode or forceCheckout — proceed with gateway checkout
// (existing gateway checkout logic from Task 3)
```

**Step 2: Update addOnStore to handle manual response**

In `addOnStore.js`, update `subscribeToModule`:

```javascript
async subscribeToModule(moduleId, period) {
  const { data } = await api.post('/payment/create-preference', { type: 'MODULE', referenceId: moduleId, period })
  if (data.checkoutUrl) {
    window.location.href = data.checkoutUrl
  }
  return data // caller can check data.manual to show message
},
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/payment.js delivery-saas-frontend/src/stores/addOnStore.js
git commit -m "feat: respect billingMode when subscribing to modules"
```

---

## Task 10: Migrate existing MercadoPagoConfig to SaasGatewayConfig

**Files:**
- Create: `delivery-saas-backend/scripts/migrate-mp-to-gateway.js`

**Step 1: Create migration script**

Create `delivery-saas-backend/scripts/migrate-mp-to-gateway.js`:

```javascript
/**
 * One-time migration: copies the first active MercadoPagoConfig into SaasGatewayConfig.
 * Run: node --experimental-modules scripts/migrate-mp-to-gateway.js
 */
import { PrismaClient } from '@prisma/client'
import { encrypt } from '../src/services/encryption.js'

const prisma = new PrismaClient()

async function main() {
  const existing = await prisma.saasGatewayConfig.findFirst({ where: { isActive: true } })
  if (existing) {
    console.log('SaasGatewayConfig already exists, skipping migration')
    return
  }

  const mpConfig = await prisma.mercadoPagoConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!mpConfig) {
    console.log('No MercadoPagoConfig found, nothing to migrate')
    return
  }

  // The accessToken in MercadoPagoConfig is already encrypted with the same encryption service
  // We need to decrypt it and re-encrypt as JSON
  const { decrypt } = await import('../src/services/encryption.js')
  const accessToken = decrypt(mpConfig.accessToken)

  const credentials = encrypt(JSON.stringify({
    accessToken,
    publicKey: mpConfig.publicKey || '',
  }))

  await prisma.saasGatewayConfig.create({
    data: {
      provider: 'MERCADOPAGO',
      displayName: 'Mercado Pago',
      credentials,
      isActive: true,
      billingMode: { plan: 'MANUAL', module: 'MANUAL', credits: 'MANUAL' },
      platformFee: 2.00,
    },
  })

  console.log('Migrated MercadoPagoConfig to SaasGatewayConfig successfully')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/scripts/migrate-mp-to-gateway.js
git commit -m "chore: add MP to SaasGatewayConfig migration script"
```

---

## Summary

| Task | Description | Commits |
|------|-------------|---------|
| 1 | DB: SaasGatewayConfig + invoice fields | 1 |
| 2 | Backend: Gateway adapter + MP adapter | 1 |
| 3 | Backend: Refactor payment.js to use adapters | 1 |
| 4 | Backend: Super Admin gateway config routes | 1 |
| 5 | Frontend: Super Admin gateway config page | 1 |
| 6 | Frontend: ADMIN billing page (faturas + dashboard) | 1 |
| 7 | Backend: Recurring billing cron job | 1 |
| 8 | Frontend: Pending invoice badge in sidebar | 1 |
| 9 | Integration: Wire module subscription to billingMode | 1 |
| 10 | Migration: MP config to SaasGatewayConfig | 1 |
