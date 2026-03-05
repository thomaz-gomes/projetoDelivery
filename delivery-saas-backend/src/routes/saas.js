import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import { AI_SERVICE_COSTS, clearServiceCostCache } from '../services/aiCreditManager.js'
import { calculateProRation } from '../services/proRation.js'

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
    const updated = await prisma.saasModule.update({ where: { id }, data: { name, description, isActive } })
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
  const { name, price = 0, menuLimit = null, storeLimit = null, unlimitedMenus = false, unlimitedStores = false, aiCreditsMonthlyLimit = 100, unlimitedAiCredits = false, moduleIds = [] } = req.body || {}
  if (!name) return res.status(400).json({ message: 'name é obrigatório' })
  try {
    const plan = await prisma.saasPlan.create({ data: { name, price: Number(price || 0), menuLimit, storeLimit, unlimitedMenus: Boolean(unlimitedMenus), unlimitedStores: Boolean(unlimitedStores), aiCreditsMonthlyLimit: Number(aiCreditsMonthlyLimit || 100), unlimitedAiCredits: Boolean(unlimitedAiCredits) } })
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
  const { name, price, menuLimit, storeLimit, unlimitedMenus, unlimitedStores, aiCreditsMonthlyLimit, unlimitedAiCredits, moduleIds, isDefault } = req.body || {}
  try {
    // Se marcando como padrão, desmarcar o anterior
    if (isDefault === true) {
      await prisma.saasPlan.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } })
    }
    const updated = await prisma.saasPlan.update({ where: { id }, data: { name, price, menuLimit, storeLimit, unlimitedMenus, unlimitedStores, ...(aiCreditsMonthlyLimit !== undefined && { aiCreditsMonthlyLimit: Number(aiCreditsMonthlyLimit) }), ...(unlimitedAiCredits !== undefined && { unlimitedAiCredits: Boolean(unlimitedAiCredits) }), ...(isDefault !== undefined && { isDefault: Boolean(isDefault) }) } })
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
  const sub = await prisma.saasSubscription.findUnique({ where: { companyId }, include: { plan: { include: { modules: { include: { module: true } } } } } })
  res.json(sub)
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
saasRouter.get('/modules/me', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  try {
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

    // Create or reactivate module subscription
    let moduleSub
    if (existing) {
      moduleSub = await prisma.saasModuleSubscription.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', period: upperPeriod, nextDueAt, canceledAt: null, startedAt: new Date() }
      })
    } else {
      moduleSub = await prisma.saasModuleSubscription.create({
        data: { companyId, moduleId, period: upperPeriod, nextDueAt }
      })
    }

    // Create pro-rated invoice with line item
    if (sub) {
      const now = new Date()
      const invoice = await prisma.saasInvoice.create({
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
              referenceId: moduleSub.id,
              description: `Assinatura módulo (${upperPeriod})`,
              amount: String(proRatedPrice)
            }
          }
        }
      })

      // Create payment record
      await prisma.saasPayment.create({
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

    res.status(201).json(moduleSub)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao assinar módulo', error: e?.message || String(e) })
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
    const [allModules, companySubs] = await Promise.all([
      prisma.saasModule.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, include: { prices: true } }),
      prisma.saasModuleSubscription.findMany({ where: { companyId, status: 'ACTIVE' } })
    ])
    const subMap = new Map(companySubs.map(s => [s.moduleId, s]))
    const result = allModules.map(mod => ({
      ...mod,
      isSubscribed: subMap.has(mod.id),
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
          plan: { select: { id: true, name: true, price: true } }
        }
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
    const company = await prisma.company.create({ data: { name } })
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
const SETTINGS_WHITELIST = ['openai_api_key', 'openai_model', 'credit_brl_price', 'google_ai_api_key']
const SENSITIVE_KEYS = new Set(['openai_api_key', 'google_ai_api_key'])

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
    }

    res.json({ message: 'Configurações salvas com sucesso' })
  } catch (e) {
    console.error('[PUT /saas/settings]', e)
    res.status(500).json({ message: 'Erro ao salvar configurações' })
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
              referenceId: purchase.id,
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

export default saasRouter
