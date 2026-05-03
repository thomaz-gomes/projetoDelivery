import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import { AI_SERVICE_COSTS, clearServiceCostCache } from '../services/aiCreditManager.js'
import { calculateProRation } from '../services/proRation.js'
import { encrypt, decrypt } from '../services/encryption.js'
import { invalidateSetting } from '../services/systemSettings.js'
import { sendTestEmail } from '../services/email.js'

export const saasRouter = express.Router()
saasRouter.use(authMiddleware)

// Helper: garante que CARDAPIO_SIMPLES está incluído se CARDAPIO_COMPLETO estiver no array de módulos
async function ensureCardapioSimplesIncluded(moduleIds) {
  const ids = [...moduleIds].map(String)
  const mods = await prisma.saasModule.findMany({ where: { id: { in: ids } }, select: { id: true, key: true } })
  const hasCompleto = mods.some(m => m.key === 'CARDAPIO_COMPLETO')
  if (!hasCompleto) return ids
  const alreadyHasSimples = mods.some(m => m.key === 'CARDAPIO_SIMPLES')
  if (alreadyHasSimples) return ids
  const simplesModule = await prisma.saasModule.findFirst({ where: { key: 'CARDAPIO_SIMPLES' } })
  if (simplesModule) ids.push(simplesModule.id)
  return ids
}

// -------- Modules CRUD (SUPER_ADMIN) --------
saasRouter.get('/modules', requireRole('SUPER_ADMIN'), async (_req, res) => {
  const rows = await prisma.saasModule.findMany({ orderBy: { name: 'asc' }, include: { prices: true } })
  res.json(rows)
})

saasRouter.post('/modules', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { key, name, description, isActive = true } = req.body || {}
  if (!key || !name) return res.status(400).json({ message: 'key e name são obrigatórios' })
  try {
    const created = await prisma.saasModule.create({ data: { key, name, description: description || null, isActive: Boolean(isActive) } })
    res.status(201).json(created)
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao criar módulo', error: e?.message || String(e) })
  }
})

saasRouter.put('/modules/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { name, description, isActive, prices } = req.body || {}
  try {
    const data = { name, description, isActive }
    const updated = await prisma.saasModule.update({ where: { id }, data })
    if (Array.isArray(prices)) {
      await prisma.saasModulePrice.deleteMany({ where: { moduleId: id } })
      if (prices.length) {
        const priceData = prices.map(p => ({ moduleId: id, period: String(p.period || '').toUpperCase(), price: String(p.price || 0) }))
        await prisma.saasModulePrice.createMany({ data: priceData })
      }
    }
    const withPrices = await prisma.saasModule.findUnique({ where: { id }, include: { prices: true } })
    res.json(withPrices)
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao atualizar módulo', error: e?.message || String(e) })
  }
})

saasRouter.delete('/modules/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  await prisma.saasModule.delete({ where: { id } })
  res.json({ ok: true })
})

// -------- Plans CRUD (SUPER_ADMIN) --------
saasRouter.get('/plans', requireRole('SUPER_ADMIN'), async (_req, res) => {
  const rows = await prisma.saasPlan.findMany({ include: { modules: { include: { module: true } }, prices: true }, orderBy: { createdAt: 'desc' } })
  res.json(rows)
})

saasRouter.post('/plans', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { name, price = 0, menuLimit = null, storeLimit = null, unlimitedMenus = false, unlimitedStores = false, aiCreditsMonthlyLimit = 100, unlimitedAiCredits = false, moduleIds = [], isTrial, trialDurationDays } = req.body || {}
  if (!name) return res.status(400).json({ message: 'name é obrigatório' })
  try {
    const plan = await prisma.saasPlan.create({ data: { name, price: Number(price || 0), menuLimit, storeLimit, unlimitedMenus: Boolean(unlimitedMenus), unlimitedStores: Boolean(unlimitedStores), aiCreditsMonthlyLimit: Number(aiCreditsMonthlyLimit || 100), unlimitedAiCredits: Boolean(unlimitedAiCredits), isTrial: Boolean(isTrial), ...(trialDurationDays != null && { trialDurationDays: Number(trialDurationDays) }) } })
    if (Array.isArray(moduleIds) && moduleIds.length) {
      const effectiveModuleIds = await ensureCardapioSimplesIncluded(moduleIds)
      const data = effectiveModuleIds.map(mid => ({ planId: plan.id, moduleId: String(mid) }))
      await prisma.saasPlanModule.createMany({ data })
    }
    // prices: optional array of { period, price }
    if (Array.isArray(req.body.prices) && req.body.prices.length) {
      const priceData = req.body.prices.map(p => ({ planId: plan.id, period: String(p.period || '').toUpperCase(), price: String(p.price || 0) }))
      await prisma.saasPlanPrice.createMany({ data: priceData })
    }
    const withMods = await prisma.saasPlan.findUnique({ where: { id: plan.id }, include: { modules: { include: { module: true } }, prices: true } })
    res.status(201).json(withMods)
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao criar plano', error: e?.message || String(e) })
  }
})

saasRouter.put('/plans/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { name, price, menuLimit, storeLimit, unlimitedMenus, unlimitedStores, aiCreditsMonthlyLimit, unlimitedAiCredits, moduleIds, isDefault, trialDurationDays } = req.body || {}
  try {
    // Se marcando como padrão, desmarcar o anterior
    if (isDefault === true) {
      await prisma.saasPlan.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } })
    }
    const updated = await prisma.saasPlan.update({ where: { id }, data: { name, price, menuLimit, storeLimit, unlimitedMenus, unlimitedStores, ...(aiCreditsMonthlyLimit !== undefined && { aiCreditsMonthlyLimit: Number(aiCreditsMonthlyLimit) }), ...(unlimitedAiCredits !== undefined && { unlimitedAiCredits: Boolean(unlimitedAiCredits) }), ...(isDefault !== undefined && { isDefault: Boolean(isDefault) }), ...(trialDurationDays !== undefined && { trialDurationDays: Number(trialDurationDays) }) } })
    if (Array.isArray(moduleIds)) {
      // replace module assignments
      await prisma.saasPlanModule.deleteMany({ where: { planId: id } })
      if (moduleIds.length) {
        const effectiveModuleIds = await ensureCardapioSimplesIncluded(moduleIds)
        const data = effectiveModuleIds.map(mid => ({ planId: id, moduleId: String(mid) }))
        await prisma.saasPlanModule.createMany({ data })
      }
    }
    // replace prices if provided
    if (Array.isArray(req.body.prices)) {
      await prisma.saasPlanPrice.deleteMany({ where: { planId: id } })
      if (req.body.prices.length) {
        const priceData = req.body.prices.map(p => ({ planId: id, period: String(p.period || '').toUpperCase(), price: String(p.price || 0) }))
        await prisma.saasPlanPrice.createMany({ data: priceData })
      }
    }
    const withMods = await prisma.saasPlan.findUnique({ where: { id }, include: { modules: { include: { module: true } }, prices: true } })
    res.json(withMods)
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao atualizar plano', error: e?.message || String(e) })
  }
})

saasRouter.delete('/plans/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  const plan = await prisma.saasPlan.findUnique({ where: { id } })
  if (!plan) return res.status(404).json({ message: 'Plano não encontrado' })
  if (plan.isSystem) return res.status(403).json({ message: 'Este plano é padrão do sistema e não pode ser excluído.' })
  await prisma.saasPlanModule.deleteMany({ where: { planId: id } })
  await prisma.saasPlan.delete({ where: { id } })
  res.json({ ok: true })
})

// -------- Company Subscriptions --------
// Create or update a subscription for a company (SUPER_ADMIN)
saasRouter.post('/subscriptions', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { companyId, planId, nextDueAt } = req.body || {}
  if (!companyId || !planId) return res.status(400).json({ message: 'companyId e planId são obrigatórios' })
  try {
    const existing = await prisma.saasSubscription.findUnique({ where: { companyId } })
    // helper to map period -> months
    const monthsFromPeriod = (p) => {
      const pp = String(p || '').toUpperCase()
      if (pp === 'MONTHLY') return 1
      if (pp === 'BIMONTHLY' || pp === 'BI_MONTHLY' || pp === 'BIMESTRAL') return 2
      if (pp === 'QUARTERLY' || pp === 'TRIMESTRAL') return 3
      if (pp === 'ANNUAL' || pp === 'YEARLY') return 12
      return 1
    }

    if (existing) {
      const updated = await prisma.saasSubscription.update({ where: { id: existing.id }, data: { planId, nextDueAt: nextDueAt ? new Date(nextDueAt) : existing.nextDueAt, status: 'ACTIVE' } })
      return res.json(updated)
    }

    // Resolve plan pricing before creating subscription
    const plan = await prisma.saasPlan.findUnique({ where: { id: String(planId) }, include: { prices: true } })
    let chosen = null
    if (plan && Array.isArray(plan.prices) && plan.prices.length) {
      chosen = plan.prices.find(p => String(p.period || '').toUpperCase() === 'MONTHLY') || plan.prices[0]
    }

    // create subscription
    const created = await prisma.saasSubscription.create({ data: { companyId, planId, nextDueAt: nextDueAt ? new Date(nextDueAt) : null, period: chosen ? chosen.period : (req.body.period || null) } })

    // create initial invoice based on plan pricing (if available)
    try {
      const now = new Date()
      const invoiceDate = nextDueAt ? new Date(nextDueAt) : now
      const year = invoiceDate.getFullYear()
      const month = invoiceDate.getMonth() + 1
      const amount = chosen ? String(chosen.price) : String(plan ? plan.price : 0)
      await prisma.saasInvoice.create({ data: { subscriptionId: created.id, year, month, amount, dueDate: invoiceDate } })
      // set nextDueAt on subscription
      const period = chosen ? chosen.period : (plan ? (req.body.period || 'MONTHLY') : 'MONTHLY')
      const next = new Date(invoiceDate)
      next.setMonth(next.getMonth() + monthsFromPeriod(period))
      await prisma.saasSubscription.update({ where: { id: created.id }, data: { nextDueAt: next, period } })
    } catch (ie) {
      // swallow invoice errors but log
      console.error('Invoice creation error', ie)
    }

    // After subscription creation, grant initial AI credits
    try {
      const planForCredits = await prisma.saasPlan.findUnique({ where: { id: String(planId) } })
      if (planForCredits && planForCredits.aiCreditsMonthlyLimit > 0) {
        await prisma.company.update({
          where: { id: companyId },
          data: {
            aiCreditsBalance: planForCredits.aiCreditsMonthlyLimit,
            aiCreditsLastReset: new Date()
          }
        })
      }
    } catch (ce) {
      console.error('Initial credit grant error', ce)
    }

    res.status(201).json(created)
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao salvar assinatura', error: e?.message || String(e) })
  }
})

// Get subscription for current user's company (ADMIN)
saasRouter.get('/subscription/me', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const [sub, activeTrial] = await Promise.all([
    prisma.saasSubscription.findUnique({ where: { companyId }, include: { plan: { include: { modules: { include: { module: true } } } } } }),
    prisma.companyTrial.findFirst({ where: { companyId, status: 'ACTIVE' } })
  ])
  res.json({ ...sub, activeTrial: activeTrial || null })
})

// Admin/Super: Get subscription for a given company (SUPER_ADMIN)
saasRouter.get('/subscription/:companyId', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { companyId } = req.params
  try {
    const sub = await prisma.saasSubscription.findUnique({ where: { companyId }, include: { plan: { include: { modules: { include: { module: true } } } } } })
    res.json(sub)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao obter assinatura da empresa', error: e?.message || String(e) })
  }
})

// Get enabled modules for current user's company (ADMIN)
// Merges modules from plan + add-on subscriptions
saasRouter.get('/modules/me', requireRole('ADMIN', 'ATTENDANT'), async (req, res) => {
  const companyId = req.user.companyId
  try {
    // 1. Modules from add-on subscriptions
    const addonSubs = await prisma.saasModuleSubscription.findMany({
      where: { companyId, status: 'ACTIVE' },
      include: { module: true }
    })
    const addonKeys = addonSubs
      .filter(s => s.module && s.module.isActive !== false)
      .map(s => s.module.key)

    // 2. Modules included in the company's plan
    const subscription = await prisma.saasSubscription.findUnique({
      where: { companyId },
      include: { plan: { include: { modules: { include: { module: true } } } } }
    })
    const planKeys = (subscription?.plan?.modules || [])
      .filter(pm => pm.module && pm.module.isActive !== false)
      .map(pm => pm.module.key)

    const enabled = [...new Set([...planKeys, ...addonKeys])]
    res.json({ companyId, enabled })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao obter módulos', error: e?.message || String(e) })
  }
})

// -------- Module Subscriptions (ADMIN) --------

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
    res.status(500).json({ message: 'Erro ao listar assinaturas de módulos', error: e?.message || String(e) })
  }
})

// Subscribe to a module
saasRouter.post('/module-subscriptions', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { moduleId, period } = req.body || {}
  if (!moduleId || !period) return res.status(400).json({ message: 'moduleId e period são obrigatórios' })
  try {
    // Check if already subscribed
    const existing = await prisma.saasModuleSubscription.findUnique({
      where: { companyId_moduleId: { companyId, moduleId } }
    })
    if (existing && existing.status === 'ACTIVE') {
      return res.status(409).json({ message: 'Módulo já assinado' })
    }

    // Get module price for the period
    const upperPeriod = String(period).toUpperCase()
    const modulePrice = await prisma.saasModulePrice.findUnique({
      where: { moduleId_period: { moduleId, period: upperPeriod } }
    })
    if (!modulePrice) {
      return res.status(400).json({ message: 'Preço não encontrado para o período informado' })
    }

    const { proRatedPrice, nextDueAt } = calculateProRation(Number(modulePrice.price), upperPeriod)

    // Get or create a subscription for the company (needed for invoice)
    let sub = await prisma.saasSubscription.findUnique({ where: { companyId } })

    // Wrap subscription + invoice + payment in a transaction
    const moduleSub = await prisma.$transaction(async (tx) => {
      // Create or reactivate module subscription
      let mSub
      if (existing) {
        mSub = await tx.saasModuleSubscription.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', period: upperPeriod, nextDueAt, canceledAt: null, startedAt: new Date() }
        })
      } else {
        mSub = await tx.saasModuleSubscription.create({
          data: { companyId, moduleId, period: upperPeriod, nextDueAt }
        })
      }

      // Create pro-rated invoice with line item
      if (sub) {
        const now = new Date()
        const invoice = await tx.saasInvoice.create({
          data: {
            subscriptionId: sub.id,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            amount: String(proRatedPrice),
            dueDate: now,
            status: 'PAID',
            paidAt: now,
            items: {
              create: {
                type: 'MODULE',
                referenceId: moduleId,
                description: `Assinatura módulo (${upperPeriod})`,
                amount: String(proRatedPrice)
              }
            }
          }
        })

        // Create payment record
        await tx.saasPayment.create({
          data: {
            companyId,
            invoiceId: invoice.id,
            amount: String(proRatedPrice),
            gateway: 'manual',
            status: 'PAID',
            paidAt: now
          }
        })
      }

      return mSub
    })

    res.status(201).json(moduleSub)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao assinar módulo', error: e?.message || String(e) })
  }
})

// List module subscriptions for a company (SUPER_ADMIN)
saasRouter.get('/module-subscriptions/admin/:companyId', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { companyId } = req.params
  try {
    const subs = await prisma.saasModuleSubscription.findMany({
      where: { companyId },
      include: { module: true },
      orderBy: { startedAt: 'desc' }
    })
    res.json(subs)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar assinaturas', error: e?.message })
  }
})

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

// Cancel module subscription
saasRouter.delete('/module-subscriptions/:moduleId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { moduleId } = req.params
  try {
    const existing = await prisma.saasModuleSubscription.findUnique({
      where: { companyId_moduleId: { companyId, moduleId } }
    })
    if (!existing) return res.status(404).json({ message: 'Assinatura não encontrada' })

    const updated = await prisma.saasModuleSubscription.update({
      where: { id: existing.id },
      data: { status: 'CANCELED', canceledAt: new Date() }
    })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao cancelar assinatura de módulo', error: e?.message || String(e) })
  }
})

// -------- Store Module Visibility (ADMIN) --------

// Get all modules with subscription status for the company
saasRouter.get('/store/modules', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  try {
    const [allModules, companySubs, subscription] = await Promise.all([
      prisma.saasModule.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, include: { prices: true } }),
      prisma.saasModuleSubscription.findMany({ where: { companyId, status: 'ACTIVE' } }),
      prisma.saasSubscription.findUnique({
        where: { companyId },
        include: { plan: { include: { modules: true } } }
      })
    ])
    const subMap = new Map(companySubs.map(s => [s.moduleId, s]))
    const planModuleIds = new Set((subscription?.plan?.modules || []).map(pm => pm.moduleId))
    const result = allModules.map(mod => ({
      ...mod,
      isSubscribed: subMap.has(mod.id) || planModuleIds.has(mod.id),
      includedInPlan: planModuleIds.has(mod.id),
      subscription: subMap.get(mod.id) || null
    }))
    res.json(result)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar módulos da loja', error: e?.message || String(e) })
  }
})

// -------- Invoices (Mensalidades) --------
// List invoices for a company (ADMIN). SUPER_ADMIN may pass ?companyId= to view another company
saasRouter.get('/invoices', async (req, res) => {
  try {
    const qCompanyId = req.query.companyId || null
    let authorized = false
    if (qCompanyId) {
      await requireRole('SUPER_ADMIN')(req, res, () => { authorized = true })
    } else {
      await requireRole('ADMIN')(req, res, () => { authorized = true })
    }
    if (!authorized) return
    const companyId = qCompanyId || req.user.companyId
    // pagination and filters
    const page = Math.max(1, parseInt(req.query.page || '1', 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '10', 10)))
    const yearFilter = req.query.year ? Number(req.query.year) : null
    const monthFilter = req.query.month ? Number(req.query.month) : null
    const statusFilter = req.query.status ? String(req.query.status) : null

    const sub = await prisma.saasSubscription.findUnique({ where: { companyId } })
    if (!sub) return res.json({ rows: [], total: 0, page, pageSize })
    const where = { subscriptionId: sub.id }
    if (yearFilter) where.year = yearFilter
    if (monthFilter) where.month = monthFilter
    if (statusFilter) where.status = statusFilter

    const total = await prisma.saasInvoice.count({ where })
    const rows = await prisma.saasInvoice.findMany({ where, orderBy: [{ year: 'desc' }, { month: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: { items: true } })
    res.json({ rows, total, page, pageSize })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar faturas', error: e?.message || String(e) })
  }
})

// Update invoice (SUPER_ADMIN)
saasRouter.put('/invoices/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { year, month, amount, dueDate, status } = req.body || {}
  try {
    const data = {}
    if (year !== undefined) data.year = Number(year)
    if (month !== undefined) data.month = Number(month)
    if (amount !== undefined) data.amount = String(amount)
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null
    if (status !== undefined) data.status = status
    const updated = await prisma.saasInvoice.update({ where: { id }, data })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar fatura', error: e?.message || String(e) })
  }
})

// Delete invoice (SUPER_ADMIN)
saasRouter.delete('/invoices/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  try {
    await prisma.saasInvoice.delete({ where: { id } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao remover fatura', error: e?.message || String(e) })
  }
})

// Create invoice for a subscription (SUPER_ADMIN)
saasRouter.post('/invoices', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { companyId, subscriptionId, year, month, amount, dueDate } = req.body || {}
    let sub = null
    if (subscriptionId) sub = await prisma.saasSubscription.findUnique({ where: { id: subscriptionId } })
    else if (companyId) sub = await prisma.saasSubscription.findUnique({ where: { companyId: String(companyId) } })
    if (!sub) return res.status(400).json({ message: 'subscriptionId ou companyId válido é necessário' })
    const created = await prisma.saasInvoice.create({ data: { subscriptionId: sub.id, year: Number(year || new Date().getFullYear()), month: Number(month || (new Date().getMonth()+1)), amount: String(amount || sub.plan?.price || '0'), dueDate: dueDate ? new Date(dueDate) : null } })
    res.status(201).json(created)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao criar fatura', error: e?.message || String(e) })
  }
})

// Admin: mark invoice paid (ADMIN)
saasRouter.post('/invoices/:id/pay', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const inv = await prisma.saasInvoice.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } })
  res.json(inv)
})

// Job: generate invoices for due subscriptions (SUPER_ADMIN)
saasRouter.post('/jobs/generate-invoices', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const now = new Date()
    // find active subscriptions where nextDueAt is due
    const subs = await prisma.saasSubscription.findMany({ where: { status: 'ACTIVE', nextDueAt: { lte: now } }, include: { plan: { include: { prices: true } } } })
    const monthsFromPeriod = (p) => {
      const pp = String(p || '').toUpperCase()
      if (pp === 'MONTHLY') return 1
      if (pp === 'BIMONTHLY' || pp === 'BI_MONTHLY' || pp === 'BIMESTRAL') return 2
      if (pp === 'QUARTERLY' || pp === 'TRIMESTRAL') return 3
      if (pp === 'ANNUAL' || pp === 'YEARLY') return 12
      return 1
    }
    const results = []
    for (const s of subs) {
      try {
        const invoiceDate = s.nextDueAt || new Date()
        // pick price based on subscription.period or prefer MONTHLY
        let chosen = null
        if (s.period && s.plan && Array.isArray(s.plan.prices)) {
          chosen = s.plan.prices.find(p => String(p.period || '').toUpperCase() === String(s.period).toUpperCase())
        }
        if (!chosen && s.plan && Array.isArray(s.plan.prices) && s.plan.prices.length) {
          chosen = s.plan.prices.find(p => String(p.period || '').toUpperCase() === 'MONTHLY') || s.plan.prices[0]
        }
        const planPrice = chosen ? Number(chosen.price) : Number(s.plan ? s.plan.price : 0)
        const year = invoiceDate.getFullYear()
        const month = invoiceDate.getMonth() + 1
        const period = chosen ? chosen.period : (s.period || 'MONTHLY')

        // Build invoice items: 1 line for plan + 1 per active module subscription
        const invoiceItems = []
        invoiceItems.push({
          type: 'PLAN',
          referenceId: s.planId,
          description: `Plano ${s.plan ? s.plan.name : 'N/A'} (${period})`,
          amount: String(planPrice)
        })

        // Add active module subscriptions
        let totalAmount = planPrice
        const moduleSubs = await prisma.saasModuleSubscription.findMany({
          where: { companyId: s.companyId, status: 'ACTIVE' },
          include: { module: { include: { prices: true } } }
        })
        for (const ms of moduleSubs) {
          let modulePrice = 0
          if (ms.module && Array.isArray(ms.module.prices)) {
            const mp = ms.module.prices.find(p => String(p.period || '').toUpperCase() === String(ms.period || period).toUpperCase())
            modulePrice = mp ? Number(mp.price) : 0
          }
          invoiceItems.push({
            type: 'MODULE',
            referenceId: ms.moduleId,
            description: `Módulo ${ms.module ? ms.module.name : ms.moduleId} (${ms.period || period})`,
            amount: String(modulePrice)
          })
          totalAmount += modulePrice
        }

        await prisma.saasInvoice.create({
          data: {
            subscriptionId: s.id,
            year,
            month,
            amount: String(totalAmount),
            dueDate: invoiceDate,
            items: { create: invoiceItems }
          }
        })

        // compute next
        const next = new Date(invoiceDate)
        next.setMonth(next.getMonth() + monthsFromPeriod(period))
        await prisma.saasSubscription.update({ where: { id: s.id }, data: { nextDueAt: next } })
        results.push({ subscriptionId: s.id, year, month, amount: String(totalAmount), items: invoiceItems.length })
      } catch (e) {
        console.error('generate-invoice error for subscription', s.id, e)
      }
    }
    res.json({ generated: results.length, details: results })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao gerar faturas', error: e?.message || String(e) })
  }
})

// ── Billing Dashboard (ADMIN) ─────────────────────────────

saasRouter.get('/billing/dashboard', async (req, res) => {
  try {
    const companyId = req.user.companyId
    if (!companyId) return res.status(400).json({ message: 'Empresa não encontrada' })

    const now = new Date()
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    // Pending invoices count
    const pendingCount = await prisma.saasInvoice.count({
      where: { subscription: { companyId }, status: { in: ['PENDING', 'OVERDUE'] } },
    })

    // Next due date
    const nextInvoice = await prisma.saasInvoice.findFirst({
      where: { subscription: { companyId }, status: { in: ['PENDING', 'OVERDUE'] } },
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
      plan: subscription ? {
        name: subscription.plan.name,
        price: subscription.plan.price,
        status: subscription.status,
        nextDueAt: subscription.nextDueAt,
      } : null,
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

// -------- Company (tenant) management --------
// List companies (SUPER_ADMIN)
saasRouter.get('/companies', requireRole('SUPER_ADMIN'), async (_req, res) => {
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
  res.json(rows)
})

// Get single company (SUPER_ADMIN or ADMIN for own company)
saasRouter.get('/companies/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  // ADMIN can only view their own company
  if (req.user.role === 'ADMIN' && req.user.companyId !== id) {
    return res.status(403).json({ message: 'Acesso negado' })
  }
  try {
    const c = await prisma.company.findUnique({
      where: { id },
      select: {
        id: true, name: true, slug: true, createdAt: true,
        users: {
          where: { role: 'ADMIN' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { name: true, email: true }
        }
      }
    })
    if (!c) return res.status(404).json({ message: 'Empresa não encontrada' })
    const owner = c.users && c.users[0] ? c.users[0] : null
    const { users, ...rest } = c
    res.json({ ...rest, ownerName: owner?.name || '', ownerEmail: owner?.email || '' })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao obter empresa', error: e?.message || String(e) })
  }
})

// Create company with a master ADMIN user and optional plan subscription (SUPER_ADMIN)
saasRouter.post('/companies', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { name, masterName, masterEmail, masterPassword, planId } = req.body || {}
  if (!name || !masterName || !masterEmail || !masterPassword) {
    return res.status(400).json({ message: 'name, masterName, masterEmail e masterPassword são obrigatórios' })
  }
  try {
    const company = await prisma.company.create({ data: { name, managedById: req.user.companyId } })
    // create master user
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.hash(String(masterPassword), 10)
    await prisma.user.create({ data: { name: masterName, email: String(masterEmail).toLowerCase(), password: hash, role: 'ADMIN', companyId: company.id } })
    // optional subscription
    if (planId) {
      try { await prisma.saasSubscription.create({ data: { companyId: company.id, planId: String(planId) } }) } catch (_) {}
    }
    res.status(201).json(company)
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao criar empresa', error: e?.message || String(e) })
  }
})

// Update company (SUPER_ADMIN or ADMIN for own company)
saasRouter.put('/companies/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  // ADMIN can only edit their own company
  if (req.user.role === 'ADMIN' && req.user.companyId !== id) {
    return res.status(403).json({ message: 'Acesso negado' })
  }
  const { name, slug } = req.body || {}
  try {
    const data = {}
    if (name !== undefined) data.name = name
    if (slug !== undefined) data.slug = slug
    const updated = await prisma.company.update({ where: { id }, data })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar empresa', error: e?.message || String(e) })
  }
})

// Change company master/admin password (SUPER_ADMIN)
// body: { password, userId? }
saasRouter.post('/companies/:id/password', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { password, userId } = req.body || {}
  if (!password) return res.status(400).json({ message: 'password é obrigatório' })
  try {
    // find target user
    let user = null
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user || String(user.companyId) !== String(id)) return res.status(404).json({ message: 'Usuário não encontrado para esta empresa' })
    } else {
      user = await prisma.user.findFirst({ where: { companyId: id, role: 'ADMIN' }, orderBy: { createdAt: 'asc' } })
      if (!user) return res.status(404).json({ message: 'Usuário admin não encontrado para esta empresa' })
    }
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.hash(String(password), 10)
    const updated = await prisma.user.update({ where: { id: user.id }, data: { password: hash } })
    res.json({ ok: true, userId: updated.id })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar senha', error: e?.message || String(e) })
  }
})

// Suspend or unsuspend a company (SUPER_ADMIN)
// body: { suspend: true } to suspend, { suspend: false } to reactivate
saasRouter.post('/companies/:id/suspend', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { suspend = true } = req.body || {}
  try {
    if (suspend) {
      // set subscription to SUSPENDED, deactivate stores and demote company users (non-SUPER_ADMIN)
      await prisma.$transaction([
        prisma.saasSubscription.updateMany({ where: { companyId: id }, data: { status: 'SUSPENDED' } }),
        prisma.store.updateMany({ where: { companyId: id }, data: { isActive: false } }),
        prisma.user.updateMany({ where: { companyId: id, NOT: { role: 'SUPER_ADMIN' } }, data: { role: 'ATTENDANT' } })
      ])
      return res.json({ ok: true, suspended: true })
    } else {
      await prisma.$transaction([
        prisma.saasSubscription.updateMany({ where: { companyId: id }, data: { status: 'ACTIVE' } }),
        prisma.store.updateMany({ where: { companyId: id }, data: { isActive: true } })
      ])
      return res.json({ ok: true, suspended: false })
    }
  } catch (e) {
    res.status(500).json({ message: 'Erro ao suspender/reativar empresa', error: e?.message || String(e) })
  }
})

// DELETE company is intentionally disabled — companies must never be deleted
saasRouter.delete('/companies/:id', requireRole('SUPER_ADMIN'), async (_req, res) => {
  return res.status(403).json({ message: 'Empresas não podem ser excluídas. Use a opção de suspender.' })
})

// -------- System Settings (SUPER_ADMIN) --------

// Chaves expostas na API (whitelist). Valores de chaves *_key são mascarados na leitura.
const SETTINGS_WHITELIST = ['openai_api_key', 'openai_model', 'credit_brl_price', 'google_ai_api_key', 'ai_provider_map', 'usd_to_brl', 'custom_domain_server_ip', 'ssl_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from']
const SENSITIVE_KEYS = new Set(['openai_api_key', 'google_ai_api_key', 'smtp_pass'])

function maskValue(key, value) {
  if (!value) return ''
  if (SENSITIVE_KEYS.has(key)) {
    // Mostra apenas os últimos 4 caracteres
    return value.length > 4 ? '•'.repeat(value.length - 4) + value.slice(-4) : '•'.repeat(value.length)
  }
  return value
}

/**
 * GET /saas/settings
 * Retorna as configurações do sistema. Valores sensíveis são mascarados.
 * Body extra: { raw: true } — apenas para uso interno, não exposto ao frontend.
 */
saasRouter.get('/settings', requireRole('SUPER_ADMIN'), async (_req, res) => {
  try {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS_WHITELIST } } })
    const result = SETTINGS_WHITELIST.map(key => {
      const row = rows.find(r => r.key === key)
      return {
        key,
        value: row ? maskValue(key, row.value) : '',
        isSet: !!row?.value,
        updatedAt: row?.updatedAt ?? null,
      }
    })
    res.json(result)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao carregar configurações' })
  }
})

/**
 * PUT /saas/settings
 * Salva uma ou mais configurações. Body: [{ key, value }] ou { key, value }.
 * Enviar value vazio ("") remove a configuração.
 */
saasRouter.put('/settings', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const userId = req.user?.id ?? null
    const items = Array.isArray(req.body) ? req.body : [req.body]

    for (const { key, value } of items) {
      if (!SETTINGS_WHITELIST.includes(key)) continue
      const val = String(value ?? '').trim()
      if (!val) {
        await prisma.systemSetting.deleteMany({ where: { key } })
      } else {
        await prisma.systemSetting.upsert({
          where: { key },
          update: { value: val, updatedBy: userId },
          create: { key, value: val, updatedBy: userId },
        })
      }
      invalidateSetting(key)
    }

    res.json({ message: 'Configurações salvas com sucesso' })
  } catch (e) {
    console.error('[PUT /saas/settings]', e)
    res.status(500).json({ message: 'Erro ao salvar configurações' })
  }
})

/**
 * POST /saas/settings/test-email
 * Envia um email de teste para verificar a configuração SMTP.
 */
saasRouter.post('/settings/test-email', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email de destino é obrigatório' })
    const result = await sendTestEmail(email)
    if (result.messageId?.startsWith('console-')) {
      return res.status(400).json({ message: 'SMTP não configurado — email foi logado no console' })
    }
    res.json({ message: `Email de teste enviado para ${email}`, messageId: result.messageId })
  } catch (e) {
    console.error('[POST /saas/settings/test-email]', e)
    res.status(500).json({ message: e.message || 'Erro ao enviar email de teste' })
  }
})

// -------- AI Credit Services (custo por operação) --------

// Rótulos amigáveis para exibição no painel
const CREDIT_SERVICE_LABELS = {
  AI_STUDIO_ENHANCE:    'Gerar / aprimorar imagem no AI Studio',
  MENU_IMPORT_LINK:     'Importar cardápio via link com IA',
  MENU_IMPORT_PHOTO:    'Importar cardápio via foto com IA',
  MENU_IMPORT_PLANILHA: 'Importar cardápio via planilha (Excel/CSV)',
  MENU_IMPORT_ITEM:     'Por item importado via IA (cardápio aplicado)',
  GENERATE_DESCRIPTION: 'Gerar descrição de produto com IA',
  OCR_PHOTO:            'Processar foto via OCR',
  NFE_IMPORT_MATCH:     'Matching NFe→Estoque com IA',
  NFE_RECEIPT_PHOTO:    'Importar recibo por foto com IA',
}

/**
 * GET /saas/credit-services
 * Lista todos os serviços de crédito de IA (banco + constantes de fallback).
 */
saasRouter.get('/credit-services', requireRole('SUPER_ADMIN'), async (_req, res) => {
  try {
    const dbServices = await prisma.aiCreditService.findMany({ orderBy: { key: 'asc' } })
    const dbKeys = new Set(dbServices.map(s => s.key))

    // Inclui serviços definidos nas constantes que ainda não estão no banco
    const fallbacks = Object.entries(AI_SERVICE_COSTS)
      .filter(([key]) => !dbKeys.has(key))
      .map(([key, creditsPerUnit]) => ({
        id: null,
        key,
        name: CREDIT_SERVICE_LABELS[key] || key,
        creditsPerUnit,
        description: null,
        isActive: true,
      }))

    const result = [...dbServices, ...fallbacks].map(s => ({
      ...s,
      label: CREDIT_SERVICE_LABELS[s.key] || s.name || s.key,
    }))

    res.json(result)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar serviços de crédito', error: e?.message })
  }
})

/**
 * PUT /saas/credit-services
 * Atualiza/cria custos de serviços em lote.
 * Body: [{ key, creditsPerUnit, name?, description? }]
 */
saasRouter.put('/credit-services', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body]
    for (const { key, creditsPerUnit, name, description } of items) {
      if (!key || creditsPerUnit === undefined) continue
      const credits = Math.max(0, Math.round(Number(creditsPerUnit)))
      await prisma.aiCreditService.upsert({
        where: { key },
        update: { creditsPerUnit: credits, name: name || CREDIT_SERVICE_LABELS[key] || key, description: description ?? null },
        create: { key, creditsPerUnit: credits, name: name || CREDIT_SERVICE_LABELS[key] || key, description: description ?? null, isActive: true },
      })
    }
    clearServiceCostCache()
    res.json({ message: 'Custos de serviços atualizados com sucesso' })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar custos de serviços', error: e?.message })
  }
})

// -------- AI Credit Packs CRUD (SUPER_ADMIN) --------

saasRouter.get('/credit-packs', requireRole('SUPER_ADMIN'), async (_req, res) => {
  try {
    const rows = await prisma.aiCreditPack.findMany({ orderBy: { sortOrder: 'asc' } })
    res.json(rows)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar pacotes de crédito', error: e?.message || String(e) })
  }
})

saasRouter.post('/credit-packs', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { name, credits, price, isActive = true, sortOrder = 0 } = req.body || {}
  if (!name || credits === undefined || price === undefined) {
    return res.status(400).json({ message: 'name, credits e price são obrigatórios' })
  }
  try {
    const pack = await prisma.aiCreditPack.create({
      data: { name, credits: Number(credits), price: String(price), isActive: Boolean(isActive), sortOrder: Number(sortOrder) }
    })
    res.status(201).json(pack)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao criar pacote de crédito', error: e?.message || String(e) })
  }
})

saasRouter.put('/credit-packs/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { name, credits, price, isActive, sortOrder } = req.body || {}
  try {
    const data = {}
    if (name !== undefined) data.name = name
    if (credits !== undefined) data.credits = Number(credits)
    if (price !== undefined) data.price = String(price)
    if (isActive !== undefined) data.isActive = Boolean(isActive)
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder)
    const updated = await prisma.aiCreditPack.update({ where: { id }, data })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar pacote de crédito', error: e?.message || String(e) })
  }
})

saasRouter.delete('/credit-packs/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  try {
    await prisma.aiCreditPack.delete({ where: { id } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao remover pacote de crédito', error: e?.message || String(e) })
  }
})

// -------- AI Credit Pack Purchase (ADMIN) --------

saasRouter.get('/credit-packs/available', requireRole('ADMIN'), async (_req, res) => {
  try {
    const rows = await prisma.aiCreditPack.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
    res.json(rows)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar pacotes disponíveis', error: e?.message || String(e) })
  }
})

saasRouter.post('/credit-packs/purchase', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { packId } = req.body || {}
  if (!packId) return res.status(400).json({ message: 'packId é obrigatório' })
  try {
    const pack = await prisma.aiCreditPack.findUnique({ where: { id: packId } })
    if (!pack || !pack.isActive) return res.status(404).json({ message: 'Pacote não encontrado ou inativo' })

    const now = new Date()

    // Create purchase record
    const purchase = await prisma.aiCreditPurchase.create({
      data: {
        companyId,
        packId: pack.id,
        credits: pack.credits,
        amount: String(pack.price)
      }
    })

    // Create invoice with line item
    const sub = await prisma.saasSubscription.findUnique({ where: { companyId } })
    let invoice = null
    if (sub) {
      invoice = await prisma.saasInvoice.create({
        data: {
          subscriptionId: sub.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          amount: String(pack.price),
          dueDate: now,
          status: 'PAID',
          paidAt: now,
          items: {
            create: {
              type: 'CREDIT_PACK',
              referenceId: pack.id,
              description: `Pacote de créditos: ${pack.name} (${pack.credits} créditos)`,
              amount: String(pack.price)
            }
          }
        }
      })

      // Create payment record
      await prisma.saasPayment.create({
        data: {
          companyId,
          invoiceId: invoice.id,
          amount: String(pack.price),
          gateway: 'manual',
          status: 'PAID',
          paidAt: now
        }
      })
    }

    // Add credits to company balance immediately
    await prisma.company.update({
      where: { id: companyId },
      data: { aiCreditsBalance: { increment: pack.credits } }
    })

    res.status(201).json({ purchase, invoice })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao comprar pacote de créditos', error: e?.message || String(e) })
  }
})

// -------- Mercado Pago Config (SUPER_ADMIN) --------

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
    if (accessToken !== undefined && accessToken !== '') data.accessToken = encrypt(accessToken)
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

// ── Gateway Config (SUPER_ADMIN) ──────────────────────────

// GET /saas/gateway — get active gateway config
saasRouter.get('/gateway', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'MASTER') return res.sendStatus(403)
  try {
    const config = await prisma.saasGatewayConfig.findFirst({ where: { isActive: true } })
    if (!config) return res.json(null)
    const { credentials, ...safe } = config
    safe.hasCredentials = !!credentials
    res.json(safe)
  } catch (e) {
    console.error('GET /saas/gateway error:', e?.message)
    res.status(500).json({ message: 'Erro ao buscar config do gateway' })
  }
})

// PUT /saas/gateway — create or update gateway config
saasRouter.put('/gateway', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'MASTER') return res.sendStatus(403)
  try {
    const { provider, displayName, credentials, billingMode, webhookSecret, platformFee } = req.body
    if (!provider || !displayName) {
      return res.status(400).json({ message: 'provider e displayName são obrigatórios' })
    }

    let encryptedCreds
    if (credentials && typeof credentials === 'object' && credentials.accessToken) {
      encryptedCreds = encrypt(JSON.stringify(credentials))
    }

    // Deactivate all existing configs
    await prisma.saasGatewayConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    })

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
      data.credentials = encryptedCreds
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
saasRouter.post('/gateway/test', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'MASTER') return res.sendStatus(403)
  try {
    const { getActiveGateway } = await import('../services/paymentGateway/index.js')
    const { adapter } = await getActiveGateway()
    try {
      await adapter.getPaymentStatus('1')
    } catch (e) {
      if (e?.message?.includes('unauthorized') || e?.message?.includes('401') || e?.status === 401) {
        return res.json({ success: false, message: 'Credenciais inválidas (401 Unauthorized)' })
      }
    }
    res.json({ success: true, message: 'Conexão com gateway OK' })
  } catch (e) {
    res.json({ success: false, message: e?.message || 'Erro ao testar gateway' })
  }
})

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

saasRouter.get('/ai-usage/summary', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { months = 6 } = req.query
    const since = new Date()
    since.setMonth(since.getMonth() - Number(months))

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

    const [pricings, settings] = await Promise.all([
      prisma.aiProviderPricing.findMany({ where: { isActive: true } }),
      prisma.systemSetting.findMany({
        where: { key: { in: ['credit_brl_price', 'usd_to_brl'] } },
      }),
    ])

    const creditBrlPrice = parseFloat(settings.find(s => s.key === 'credit_brl_price')?.value || '0')
    const usdToBrl = parseFloat(settings.find(s => s.key === 'usd_to_brl')?.value || '5.80')

    const pricingMap = {}
    for (const p of pricings) {
      pricingMap[`${p.provider}:${p.model}`] = {
        input: parseFloat(p.inputPricePerMillion),
        output: parseFloat(p.outputPricePerMillion),
      }
    }

    const monthly = {}
    const byService = {}
    const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, costBrl: 0, revenueBrl: 0, creditsSpent: 0 }

    for (const row of rows) {
      const key = `${row.provider}:${row.model}`
      const pricing = pricingMap[key] || { input: 0, output: 0 }
      const costUsd = (row.inputTokens / 1_000_000 * pricing.input) + (row.outputTokens / 1_000_000 * pricing.output)
      const costBrl = costUsd * usdToBrl
      const revenueBrl = row.creditsSpent * creditBrlPrice

      const monthKey = `${row.createdAt.getFullYear()}-${String(row.createdAt.getMonth() + 1).padStart(2, '0')}`
      if (!monthly[monthKey]) monthly[monthKey] = { costBrl: 0, revenueBrl: 0, creditsSpent: 0, totalTokens: 0 }
      monthly[monthKey].costBrl += costBrl
      monthly[monthKey].revenueBrl += revenueBrl
      monthly[monthKey].creditsSpent += row.creditsSpent
      monthly[monthKey].totalTokens += row.totalTokens

      if (!byService[row.serviceKey]) byService[row.serviceKey] = { costBrl: 0, revenueBrl: 0, creditsSpent: 0, count: 0 }
      byService[row.serviceKey].costBrl += costBrl
      byService[row.serviceKey].revenueBrl += revenueBrl
      byService[row.serviceKey].creditsSpent += row.creditsSpent
      byService[row.serviceKey].count++

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

// -------- Trial Management --------

// Check trial eligibility (ADMIN)
saasRouter.get('/trial/eligibility', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const trialPlan = await prisma.saasPlan.findFirst({
      where: { isTrial: true, isActive: true },
      include: { modules: { include: { module: true } } }
    })
    if (!trialPlan) {
      return res.json({ eligible: false, reason: 'Plano trial não disponível' })
    }
    const activeTrial = await prisma.companyTrial.findFirst({ where: { companyId, status: 'ACTIVE' } })
    if (activeTrial) {
      return res.json({ eligible: false, reason: 'Empresa já possui um trial ativo' })
    }
    const previousTrial = await prisma.companyTrial.findFirst({ where: { companyId, status: { in: ['EXPIRED', 'CANCELED'] } } })
    if (previousTrial) {
      return res.json({ eligible: false, reason: 'Empresa já utilizou o período de trial' })
    }
    res.json({ eligible: true, trialPlan: { id: trialPlan.id, name: trialPlan.name, trialDurationDays: trialPlan.trialDurationDays, price: trialPlan.price, modules: trialPlan.modules } })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao verificar elegibilidade', error: e?.message || String(e) })
  }
})

// Activate trial (ADMIN)
saasRouter.post('/trial/activate', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const trialPlan = await prisma.saasPlan.findFirst({ where: { isTrial: true, isActive: true } })
    if (!trialPlan) {
      return res.status(400).json({ message: 'Plano trial não disponível' })
    }
    const activeTrial = await prisma.companyTrial.findFirst({ where: { companyId, status: 'ACTIVE' } })
    if (activeTrial) {
      return res.status(400).json({ message: 'Empresa já possui um trial ativo' })
    }
    const previousTrial = await prisma.companyTrial.findFirst({ where: { companyId, status: { in: ['EXPIRED', 'CANCELED'] } } })
    if (previousTrial) {
      return res.status(400).json({ message: 'Empresa já utilizou o período de trial' })
    }
    const currentSub = await prisma.saasSubscription.findUnique({ where: { companyId } })
    const durationDays = trialPlan.trialDurationDays || 7
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + durationDays)

    const trial = await prisma.companyTrial.create({
      data: {
        companyId,
        trialPlanId: trialPlan.id,
        originalPlanId: currentSub?.planId || null,
        originalPeriod: currentSub?.period || null,
        durationDays,
        priceAfterTrial: trialPlan.price,
        expiresAt
      }
    })

    // Update subscription to point to trial plan
    if (currentSub) {
      await prisma.saasSubscription.update({ where: { id: currentSub.id }, data: { planId: trialPlan.id } })
    }

    res.status(201).json(trial)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao ativar trial', error: e?.message || String(e) })
  }
})

// Reset trial for a company (SUPER_ADMIN)
saasRouter.post('/companies/:id/reset-trial', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const companyId = req.params.id
    const activeTrial = await prisma.companyTrial.findFirst({ where: { companyId, status: 'ACTIVE' } })
    if (activeTrial) {
      // Revert subscription to original plan/period
      if (activeTrial.originalPlanId) {
        await prisma.saasSubscription.updateMany({
          where: { companyId },
          data: { planId: activeTrial.originalPlanId, ...(activeTrial.originalPeriod && { period: activeTrial.originalPeriod }) }
        })
      }
      await prisma.companyTrial.update({ where: { id: activeTrial.id }, data: { status: 'CANCELED' } })
    }
    // Delete ALL trial records for this company
    await prisma.companyTrial.deleteMany({ where: { companyId } })
    res.json({ ok: true, message: 'Trial resetado. Empresa pode ativar novamente.' })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao resetar trial', error: e?.message || String(e) })
  }
})

// Job: expire trials (SUPER_ADMIN)
saasRouter.post('/jobs/expire-trials', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const now = new Date()
    const expiredTrials = await prisma.companyTrial.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } } })
    let expiredCount = 0
    for (const trial of expiredTrials) {
      try {
        // Revert subscription to original plan/period
        if (trial.originalPlanId) {
          await prisma.saasSubscription.updateMany({
            where: { companyId: trial.companyId },
            data: { planId: trial.originalPlanId, ...(trial.originalPeriod && { period: trial.originalPeriod }) }
          })
        }
        await prisma.companyTrial.update({ where: { id: trial.id }, data: { status: 'EXPIRED', expiredAt: now } })
        expiredCount++
      } catch (err) {
        console.error('expire-trial error for trial', trial.id, err)
      }
    }
    res.json({ ok: true, expired: expiredCount, total: expiredTrials.length })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao expirar trials', error: e?.message || String(e) })
  }
})

// ─── MASTER-only: Super Admin user management ────────────────────────────────

// GET /saas/super-admins — list all SUPER_ADMIN users
saasRouter.get('/super-admins', requireRole('MASTER'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    })
    res.json(users)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar super admins' })
  }
})

// POST /saas/super-admins — create a new SUPER_ADMIN user
saasRouter.post('/super-admins', requireRole('MASTER'), async (req, res) => {
  const { name, email, password } = req.body || {}
  if (!name || !email || !password) return res.status(400).json({ message: 'Nome, email e senha são obrigatórios' })
  try {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(409).json({ message: 'Email já cadastrado' })
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.default.hash(String(password), 10)
    const user = await prisma.user.create({ data: { name, email, password: hash, role: 'SUPER_ADMIN', emailVerified: true, companyId: null } })
    res.status(201).json({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt })
  } catch (e) {
    console.error('Error creating SUPER_ADMIN', e)
    res.status(500).json({ message: 'Erro ao criar super admin' })
  }
})

// DELETE /saas/super-admins/:id — remove a SUPER_ADMIN user
saasRouter.delete('/super-admins/:id', requireRole('MASTER'), async (req, res) => {
  const { id } = req.params
  try {
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' })
    if (user.role !== 'SUPER_ADMIN') return res.status(400).json({ message: 'Só é possível remover usuários SUPER_ADMIN' })
    await prisma.user.delete({ where: { id } })
    res.json({ message: 'Super admin removido' })
  } catch (e) {
    console.error('Error deleting SUPER_ADMIN', e)
    res.status(500).json({ message: 'Erro ao remover super admin' })
  }
})

// ─── MASTER-only: AI Credits manipulation per company ─────────────────────────

// PUT /saas/companies/:id/ai-credits — set credits (quantity or unlimited)
saasRouter.put('/companies/:id/ai-credits', requireRole('MASTER'), async (req, res) => {
  const { id } = req.params
  const { balance, unlimited } = req.body || {}
  try {
    const company = await prisma.company.findUnique({ where: { id }, include: { saasSubscription: { include: { plan: true } } } })
    if (!company) return res.status(404).json({ message: 'Empresa não encontrada' })

    // Update the plan's unlimitedAiCredits flag if toggling unlimited
    if (unlimited !== undefined && company.saasSubscription?.plan) {
      await prisma.saasPlan.update({
        where: { id: company.saasSubscription.plan.id },
        data: { unlimitedAiCredits: Boolean(unlimited) }
      })
    }

    // Update balance if provided
    if (balance !== undefined && balance !== null) {
      await prisma.company.update({ where: { id }, data: { aiCreditsBalance: Number(balance) } })
    }

    const updated = await prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true, aiCreditsBalance: true, saasSubscription: { select: { plan: { select: { aiCreditsMonthlyLimit: true, unlimitedAiCredits: true } } } } }
    })
    res.json(updated)
  } catch (e) {
    console.error('Error updating AI credits', e)
    res.status(500).json({ message: 'Erro ao atualizar créditos de IA' })
  }
})

// GET /saas/companies/:id/ai-credits — get AI credit info for a company
saasRouter.get('/companies/:id/ai-credits', requireRole('MASTER'), async (req, res) => {
  const { id } = req.params
  try {
    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true, aiCreditsBalance: true, aiCreditsLastReset: true, saasSubscription: { select: { plan: { select: { name: true, aiCreditsMonthlyLimit: true, unlimitedAiCredits: true } } } } }
    })
    if (!company) return res.status(404).json({ message: 'Empresa não encontrada' })
    res.json(company)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar créditos' })
  }
})

export default saasRouter
