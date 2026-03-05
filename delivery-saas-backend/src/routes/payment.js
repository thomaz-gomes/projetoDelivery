import express from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { prisma } from '../prisma.js'
import { createPreference, getPayment } from '../services/mercadopago.js'
import { decrypt } from '../services/encryption.js'
import { calculateProRation } from '../services/proRation.js'

export const paymentRouter = express.Router()

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || ''
const MP_PLATFORM_FEE = Number(process.env.MP_PLATFORM_FEE || '200') / 100
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

// ---------------------------------------------------------------------------
// Auth middleware (inline)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helper: resolve Mercado Pago config for a company (follows managedById)
// ---------------------------------------------------------------------------
async function getMpConfig(companyId) {
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

// ---------------------------------------------------------------------------
// Helper: build MP preference and save reference
// ---------------------------------------------------------------------------
async function buildMpPreference(mpConfig, payment, description) {
  const pref = await createPreference(mpConfig.accessToken, {
    externalReference: payment.id,
    items: [{
      title: description,
      quantity: 1,
      unit_price: Number(payment.amount),
      currency_id: 'BRL'
    }],
    notificationUrl: `${BACKEND_URL}/payment/webhook/mercadopago`,
    backUrls: {
      success: `${FRONTEND_URL}/payment/result?status=success&external_reference=${payment.id}`,
      failure: `${FRONTEND_URL}/payment/result?status=failure&external_reference=${payment.id}`,
      pending: `${FRONTEND_URL}/payment/result?status=pending&external_reference=${payment.id}`
    },
    marketplaceFee: MP_PLATFORM_FEE
  })

  // Save preference id in payment metadata
  await prisma.saasPayment.update({
    where: { id: payment.id },
    data: {
      metadata: {
        ...(typeof payment.metadata === 'object' && payment.metadata !== null ? payment.metadata : {}),
        preferenceId: pref.id
      }
    }
  })

  return pref
}

// ---------------------------------------------------------------------------
// Helper: ensure SaasSubscription exists for a company (needed for invoices)
// ---------------------------------------------------------------------------
async function ensureSubscription(companyId) {
  let sub = await prisma.saasSubscription.findUnique({ where: { companyId } })
  if (!sub) {
    // Find a default plan (first active plan)
    const defaultPlan = await prisma.saasPlan.findFirst({ where: { isActive: true }, orderBy: { price: 'asc' } })
    if (!defaultPlan) throw new Error('Nenhum plano SaaS configurado')
    sub = await prisma.saasSubscription.create({
      data: { companyId, planId: defaultPlan.id, status: 'ACTIVE' }
    })
  }
  return sub
}

// ---------------------------------------------------------------------------
// POST /payment/create-preference
// ---------------------------------------------------------------------------
paymentRouter.post('/create-preference', requireAuth, async (req, res) => {
  try {
    const companyId = req.user.companyId
    if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa associada' })

    const { invoiceId, type, referenceId, period } = req.body || {}

    // --- Pay existing invoice ---
    if (invoiceId) {
      const invoice = await prisma.saasInvoice.findUnique({
        where: { id: invoiceId },
        include: { subscription: true, items: true }
      })
      if (!invoice) return res.status(404).json({ message: 'Fatura não encontrada' })
      if (invoice.subscription.companyId !== companyId) {
        return res.status(403).json({ message: 'Fatura não pertence a esta empresa' })
      }
      if (invoice.status === 'PAID') {
        return res.status(400).json({ message: 'Fatura já paga' })
      }

      // Find or create PENDING payment
      let payment = await prisma.saasPayment.findFirst({
        where: { invoiceId: invoice.id, companyId, status: 'PENDING' }
      })
      if (!payment) {
        payment = await prisma.saasPayment.create({
          data: {
            companyId,
            invoiceId: invoice.id,
            amount: invoice.amount,
            status: 'PENDING',
            gateway: 'mercadopago'
          }
        })
      }

      const mpConfig = await getMpConfig(companyId)
      if (!mpConfig) {
        return res.json({ paymentId: payment.id, manual: true })
      }

      const description = `Fatura #${invoice.year}/${String(invoice.month).padStart(2, '0')}`
      const pref = await buildMpPreference(mpConfig, payment, description)

      return res.json({
        checkoutUrl: pref.init_point,
        preferenceId: pref.id,
        paymentId: payment.id
      })
    }

    // --- MODULE subscription ---
    if (type === 'MODULE') {
      if (!referenceId || !period) {
        return res.status(400).json({ message: 'referenceId (moduleId) e period são obrigatórios' })
      }

      const mod = await prisma.saasModule.findUnique({ where: { id: referenceId } })
      if (!mod || !mod.isActive) return res.status(404).json({ message: 'Módulo não encontrado' })

      // Check if already active
      const existingSub = await prisma.saasModuleSubscription.findUnique({
        where: { companyId_moduleId: { companyId, moduleId: referenceId } }
      })
      if (existingSub?.status === 'ACTIVE') {
        return res.status(400).json({ message: 'Módulo já está ativo' })
      }

      const modulePrice = await prisma.saasModulePrice.findUnique({
        where: { moduleId_period: { moduleId: referenceId, period } }
      })
      if (!modulePrice) return res.status(404).json({ message: 'Preço não encontrado para este período' })

      const now = new Date()
      const { proRatedPrice, nextDueAt } = calculateProRation(Number(modulePrice.price), period, now)

      const sub = await ensureSubscription(companyId)

      // Transaction: upsert module subscription + create invoice + payment
      const result = await prisma.$transaction(async (tx) => {
        // Create or reactivate module subscription
        const moduleSub = await tx.saasModuleSubscription.upsert({
          where: { companyId_moduleId: { companyId, moduleId: referenceId } },
          create: {
            companyId,
            moduleId: referenceId,
            status: 'PENDING',
            period,
            startedAt: now,
            nextDueAt
          },
          update: {
            status: 'PENDING',
            period,
            startedAt: now,
            nextDueAt,
            canceledAt: null
          }
        })

        const invoice = await tx.saasInvoice.create({
          data: {
            subscriptionId: sub.id,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            amount: String(proRatedPrice),
            status: 'PENDING',
            dueDate: nextDueAt,
            items: {
              create: {
                type: 'MODULE',
                referenceId,
                description: `${mod.name} (${period})`,
                amount: String(proRatedPrice)
              }
            }
          }
        })

        const payment = await tx.saasPayment.create({
          data: {
            companyId,
            invoiceId: invoice.id,
            amount: String(proRatedPrice),
            status: 'PENDING',
            gateway: 'mercadopago'
          }
        })

        return { moduleSub, invoice, payment }
      })

      const mpConfig = await getMpConfig(companyId)
      if (!mpConfig) {
        return res.json({ paymentId: result.payment.id, manual: true })
      }

      const description = `Módulo ${mod.name} - ${period}`
      const pref = await buildMpPreference(mpConfig, result.payment, description)

      return res.json({
        checkoutUrl: pref.init_point,
        preferenceId: pref.id,
        paymentId: result.payment.id
      })
    }

    // --- CREDIT_PACK purchase ---
    if (type === 'CREDIT_PACK') {
      if (!referenceId) {
        return res.status(400).json({ message: 'referenceId (packId) é obrigatório' })
      }

      const pack = await prisma.aiCreditPack.findUnique({ where: { id: referenceId } })
      if (!pack || !pack.isActive) return res.status(404).json({ message: 'Pacote de créditos não encontrado' })

      const sub = await ensureSubscription(companyId)
      const now = new Date()

      const result = await prisma.$transaction(async (tx) => {
        const purchase = await tx.aiCreditPurchase.create({
          data: {
            companyId,
            packId: pack.id,
            credits: pack.credits,
            amount: pack.price
          }
        })

        const invoice = await tx.saasInvoice.create({
          data: {
            subscriptionId: sub.id,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            amount: pack.price,
            status: 'PENDING',
            dueDate: now,
            items: {
              create: {
                type: 'CREDIT_PACK',
                referenceId: pack.id,
                description: `${pack.name} (${pack.credits} créditos)`,
                amount: pack.price
              }
            }
          }
        })

        const payment = await tx.saasPayment.create({
          data: {
            companyId,
            invoiceId: invoice.id,
            amount: pack.price,
            status: 'PENDING',
            gateway: 'mercadopago',
            metadata: { purchaseId: purchase.id }
          }
        })

        return { purchase, invoice, payment }
      })

      const mpConfig = await getMpConfig(companyId)
      if (!mpConfig) {
        return res.json({ paymentId: result.payment.id, manual: true })
      }

      const description = `Créditos IA - ${pack.name}`
      const pref = await buildMpPreference(mpConfig, result.payment, description)

      return res.json({
        checkoutUrl: pref.init_point,
        preferenceId: pref.id,
        paymentId: result.payment.id
      })
    }

    return res.status(400).json({ message: 'Informe invoiceId ou type (MODULE / CREDIT_PACK)' })
  } catch (e) {
    console.error('[create-preference]', e)
    res.status(500).json({ message: 'Erro ao criar preferência de pagamento', error: e?.message })
  }
})

// ---------------------------------------------------------------------------
// GET /payment/status/:paymentId
// ---------------------------------------------------------------------------
paymentRouter.get('/status/:paymentId', requireAuth, async (req, res) => {
  try {
    const payment = await prisma.saasPayment.findUnique({
      where: { id: req.params.paymentId }
    })
    if (!payment) return res.status(404).json({ message: 'Pagamento não encontrado' })
    if (payment.companyId !== req.user.companyId) {
      return res.status(403).json({ message: 'Pagamento não pertence a esta empresa' })
    }

    return res.json({
      status: payment.status,
      gateway: payment.gateway,
      paidAt: payment.paidAt,
      invoiceId: payment.invoiceId
    })
  } catch (e) {
    console.error('[payment status]', e)
    res.status(500).json({ message: 'Erro ao consultar pagamento', error: e?.message })
  }
})

// ---------------------------------------------------------------------------
// POST /payment/webhook — manual / gateway-agnostic (backwards compat)
// ---------------------------------------------------------------------------
paymentRouter.post('/webhook', async (req, res) => {
  // Verify webhook secret
  if (WEBHOOK_SECRET) {
    const provided = req.headers['x-webhook-secret'] || ''
    if (provided !== WEBHOOK_SECRET) {
      return res.status(401).json({ message: 'Invalid webhook secret' })
    }
  }

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

    // Idempotency: skip if already paid
    if (payment.status === 'PAID') {
      return res.json({ ok: true, message: 'Already processed' })
    }

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
      await processPaymentSuccess(payment)
    }

    res.json({ ok: true })
  } catch (e) {
    console.error('[payment webhook]', e)
    res.status(500).json({ message: 'Erro no webhook de pagamento', error: e?.message })
  }
})

// ---------------------------------------------------------------------------
// POST /payment/webhook/mercadopago — MP IPN handler (public, no auth)
// ---------------------------------------------------------------------------
paymentRouter.post('/webhook/mercadopago', async (req, res) => {
  // Respond 200 immediately so MP doesn't retry
  res.status(200).json({ ok: true })

  try {
    const { type, data } = req.body || {}
    if (type !== 'payment' || !data?.id) return

    // Validate MP webhook signature if secret is configured
    const mpWebhookSecret = process.env.MP_WEBHOOK_SECRET || ''
    if (mpWebhookSecret) {
      const xSignature = req.headers['x-signature'] || ''
      const xRequestId = req.headers['x-request-id'] || ''
      const parts = Object.fromEntries(xSignature.split(',').map(p => p.split('=')))
      const ts = parts.ts
      const v1 = parts.v1
      if (!ts || !v1) {
        console.warn('[mp webhook] Missing signature parts')
        return
      }
      const manifest = `id:${data.id};request-id:${xRequestId};ts:${ts};`
      const expected = crypto.createHmac('sha256', mpWebhookSecret).update(manifest).digest('hex')
      if (expected !== v1) {
        console.warn('[mp webhook] Invalid signature')
        return
      }
    }

    const mpPaymentId = String(data.id)

    // Try to find payment by gatewayRef first
    let payment = await prisma.saasPayment.findFirst({
      where: { gatewayRef: mpPaymentId },
      include: { invoice: { include: { items: true } } }
    })

    // If not found by gatewayRef, try external_reference from query params
    // MP IPN can include ?external_reference= which is our paymentId
    if (!payment) {
      const externalRef = req.query.external_reference || req.body?.data?.external_reference
      if (externalRef) {
        payment = await prisma.saasPayment.findUnique({
          where: { id: externalRef },
          include: { invoice: { include: { items: true } } }
        })
      }
    }

    // Last resort: use the company's own MP config to query the payment
    if (!payment) {
      // Find any pending mercadopago payment and query MP using its company's config
      const pendingPayments = await prisma.saasPayment.findMany({
        where: { gateway: 'mercadopago', status: { in: ['PENDING', 'PROCESSING'] } },
        include: { invoice: { include: { items: true } } },
        take: 50
      })

      for (const p of pendingPayments) {
        try {
          const cfg = await getMpConfig(p.companyId)
          if (!cfg) continue
          const mpData = await getPayment(cfg.accessToken, mpPaymentId)
          if (mpData?.external_reference === p.id) {
            payment = p
            await prisma.saasPayment.update({ where: { id: p.id }, data: { gatewayRef: mpPaymentId } })
            break
          }
        } catch { /* try next */ }
      }

      if (!payment) {
        console.warn('[mp webhook] No matching payment for MP id:', mpPaymentId)
        return
      }
    }

    // Idempotency: skip if already paid
    if (payment.status === 'PAID') return

    // Resolve MP config for this company to query real status
    const mpConfig = await getMpConfig(payment.companyId)
    if (!mpConfig) {
      console.warn('[mp webhook] No MP config for company:', payment.companyId)
      return
    }

    const mpPayment = await getPayment(mpConfig.accessToken, mpPaymentId)
    const ourStatus = mapMpStatus(mpPayment.status)

    // Map MP payment method
    const method = mapMpMethod(mpPayment.payment_type_id || mpPayment.payment_method_id)

    await prisma.saasPayment.update({
      where: { id: payment.id },
      data: {
        status: ourStatus,
        gatewayRef: mpPaymentId,
        method,
        paidAt: ourStatus === 'PAID' ? new Date() : payment.paidAt,
        metadata: {
          ...(typeof payment.metadata === 'object' && payment.metadata !== null ? payment.metadata : {}),
          mpStatus: mpPayment.status,
          mpPaymentId
        }
      }
    })

    // If paid, process invoice items (activate modules, credit packs, etc.)
    if (ourStatus === 'PAID' && payment.invoice) {
      await processPaymentSuccess(payment)
    }
  } catch (e) {
    console.error('[mp webhook] Error processing MP notification:', e)
  }
})

// ---------------------------------------------------------------------------
// Shared: process successful payment (activate modules, add credits, etc.)
// ---------------------------------------------------------------------------
async function processPaymentSuccess(payment) {
  if (!payment.invoice) return

  await prisma.$transaction(async (tx) => {
    await tx.saasInvoice.update({
      where: { id: payment.invoice.id },
      data: { status: 'PAID', paidAt: new Date() }
    })

    for (const item of (payment.invoice.items || [])) {
      if (item.type === 'MODULE') {
        await tx.saasModuleSubscription.updateMany({
          where: { companyId: payment.companyId, moduleId: item.referenceId },
          data: { status: 'ACTIVE' }
        })
      } else if (item.type === 'CREDIT_PACK') {
        const pack = await tx.aiCreditPack.findUnique({ where: { id: item.referenceId } })
        if (pack) {
          await tx.company.update({
            where: { id: payment.companyId },
            data: { aiCreditsBalance: { increment: pack.credits } }
          })
        }
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers: map Mercado Pago statuses / methods to our values
// ---------------------------------------------------------------------------
function mapMpStatus(mpStatus) {
  switch (mpStatus) {
    case 'approved': return 'PAID'
    case 'pending': return 'PENDING'
    case 'in_process': return 'PROCESSING'
    case 'rejected':
    case 'cancelled': return 'FAILED'
    case 'refunded':
    case 'charged_back': return 'REFUNDED'
    default: return 'PENDING'
  }
}

function mapMpMethod(mpMethod) {
  if (!mpMethod) return null
  const m = mpMethod.toLowerCase()
  if (m.includes('pix') || m === 'bank_transfer') return 'PIX'
  if (m.includes('credit') || m === 'credit_card') return 'CREDIT_CARD'
  if (m.includes('boleto') || m === 'ticket') return 'BOLETO'
  return null
}
