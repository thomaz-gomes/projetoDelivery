import express from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../prisma.js'
import { calculateProRation } from '../services/proRation.js'
import { getActiveGateway, getGatewayByProvider, getBillingMode } from '../services/paymentGateway/index.js'

export const paymentRouter = express.Router()

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || ''
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
// Helper: create checkout via active gateway adapter
// ---------------------------------------------------------------------------
async function createGatewayCheckout(payment, description, platformFeeOverride) {
  const { adapter, config } = await getActiveGateway()

  const result = await adapter.createCheckout({
    amount: Number(payment.amount),
    description,
    externalRef: payment.id,
    backUrls: {
      success: `${FRONTEND_URL}/payment/result?status=success&external_reference=${payment.id}`,
      failure: `${FRONTEND_URL}/payment/result?status=failure&external_reference=${payment.id}`,
      pending: `${FRONTEND_URL}/payment/result?status=pending&external_reference=${payment.id}`,
    },
    notificationUrl: `${BACKEND_URL}/payment/webhook/${config.provider.toLowerCase()}`,
    platformFee: platformFeeOverride != null ? Number(platformFeeOverride) : undefined,
  })

  await prisma.saasPayment.update({
    where: { id: payment.id },
    data: {
      gateway: config.provider.toLowerCase(),
      metadata: {
        ...(typeof payment.metadata === 'object' && payment.metadata !== null ? payment.metadata : {}),
        preferenceId: result.preferenceId,
      },
    },
  })

  return result
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
            gateway: 'pending'
          }
        })
      }

      const description = `Fatura #${invoice.year}/${String(invoice.month).padStart(2, '0')}`
      try {
        const checkout = await createGatewayCheckout(payment, description)
        return res.json({
          checkoutUrl: checkout.checkoutUrl,
          preferenceId: checkout.preferenceId,
          paymentId: payment.id
        })
      } catch (e) {
        console.warn('[create-preference] Gateway not available:', e?.message)
        return res.json({ paymentId: payment.id, manual: true })
      }
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
            gateway: 'pending'
          }
        })

        return { moduleSub, invoice, payment }
      })

      // Check billing mode for modules
      let gatewayConfig = null
      try {
        const gwResult = await getActiveGateway()
        gatewayConfig = gwResult.config
      } catch { /* no gateway configured */ }

      const billingMode = gatewayConfig ? getBillingMode(gatewayConfig, 'module') : 'MANUAL'

      if (billingMode === 'MANUAL') {
        return res.json({
          manual: true,
          paymentId: result.payment.id,
          invoiceId: result.invoice.id,
          message: 'Fatura gerada. Acesse Cobranças para efetuar o pagamento.',
        })
      }

      const description = `Módulo ${mod.name} - ${period}`
      try {
        const checkout = await createGatewayCheckout(result.payment, description, mod.platformFee)
        return res.json({
          checkoutUrl: checkout.checkoutUrl,
          preferenceId: checkout.preferenceId,
          paymentId: result.payment.id
        })
      } catch (e) {
        console.warn('[create-preference] Gateway not available:', e?.message)
        return res.json({ paymentId: result.payment.id, manual: true })
      }
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
            gateway: 'pending',
            metadata: { purchaseId: purchase.id }
          }
        })

        return { purchase, invoice, payment }
      })

      // Check billing mode for credits
      let creditGatewayConfig = null
      try {
        const gwResult = await getActiveGateway()
        creditGatewayConfig = gwResult.config
      } catch { /* no gateway configured */ }

      const creditBillingMode = creditGatewayConfig ? getBillingMode(creditGatewayConfig, 'credits') : 'MANUAL'

      if (creditBillingMode === 'MANUAL') {
        return res.json({
          manual: true,
          paymentId: result.payment.id,
          invoiceId: result.invoice.id,
          message: 'Fatura gerada. Acesse Cobranças para efetuar o pagamento.',
        })
      }

      const description = `Créditos IA - ${pack.name}`
      try {
        const checkout = await createGatewayCheckout(result.payment, description)
        return res.json({
          checkoutUrl: checkout.checkoutUrl,
          preferenceId: checkout.preferenceId,
          paymentId: result.payment.id
        })
      } catch (e) {
        console.warn('[create-preference] Gateway not available:', e?.message)
        return res.json({ paymentId: result.payment.id, manual: true })
      }
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
// POST /payment/webhook/:provider — dynamic gateway webhook handler
// ---------------------------------------------------------------------------
paymentRouter.post('/webhook/:provider', async (req, res) => {
  // Respond 200 immediately so gateway doesn't retry
  res.sendStatus(200)

  try {
    const provider = req.params.provider.toUpperCase()
    const result = await getGatewayByProvider(provider)
    if (!result) {
      console.warn(`[webhook] Unknown provider: ${provider}`)
      return
    }

    const { adapter } = result
    const validation = adapter.validateWebhook(req)
    if (!validation.valid) {
      console.warn(`[webhook] Invalid signature for ${provider}`)
      return
    }
    if (!validation.paymentId) return

    // Get payment details from gateway
    const paymentInfo = await adapter.getPaymentStatus(validation.paymentId)

    // Find our payment record by gatewayRef
    let payment = await prisma.saasPayment.findFirst({
      where: { gatewayRef: String(validation.paymentId) },
      include: { invoice: { include: { items: true } } }
    })

    // Try by external_reference from gateway raw data
    if (!payment) {
      const extRef = paymentInfo.raw?.external_reference
      if (extRef) {
        payment = await prisma.saasPayment.findUnique({
          where: { id: extRef },
          include: { invoice: { include: { items: true } } }
        })
      }
    }

    if (!payment) {
      console.warn(`[webhook] Payment not found for gateway ref ${validation.paymentId}`)
      return
    }

    // Idempotency: skip if already paid
    if (payment.status === 'PAID') return

    const updateData = {
      status: paymentInfo.status,
      method: paymentInfo.method,
      gatewayRef: String(validation.paymentId),
      metadata: {
        ...(typeof payment.metadata === 'object' && payment.metadata !== null ? payment.metadata : {}),
        gatewayStatus: paymentInfo.raw?.status,
        gatewayPaymentId: validation.paymentId,
      },
    }
    if (paymentInfo.status === 'PAID') {
      updateData.paidAt = new Date()
    }

    await prisma.saasPayment.update({
      where: { id: payment.id },
      data: updateData,
    })

    if (paymentInfo.status === 'PAID' && payment.invoice) {
      await processPaymentSuccess(payment)
    }
  } catch (e) {
    console.error('[webhook] Error processing:', e?.message || e)
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

