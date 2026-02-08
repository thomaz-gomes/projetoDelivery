import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'

export const saasRouter = express.Router()
saasRouter.use(authMiddleware)

// -------- Modules CRUD (SUPER_ADMIN) --------
saasRouter.get('/modules', requireRole('SUPER_ADMIN'), async (_req, res) => {
  const rows = await prisma.saasModule.findMany({ orderBy: { name: 'asc' } })
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
  const { name, description, isActive } = req.body || {}
  try {
    const updated = await prisma.saasModule.update({ where: { id }, data: { name, description, isActive } })
    res.json(updated)
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
  const { name, price = 0, menuLimit = null, storeLimit = null, unlimitedMenus = false, unlimitedStores = false, moduleIds = [] } = req.body || {}
  if (!name) return res.status(400).json({ message: 'name é obrigatório' })
  try {
    const plan = await prisma.saasPlan.create({ data: { name, price: Number(price || 0), menuLimit, storeLimit, unlimitedMenus: Boolean(unlimitedMenus), unlimitedStores: Boolean(unlimitedStores) } })
    if (Array.isArray(moduleIds) && moduleIds.length) {
      const data = moduleIds.map(mid => ({ planId: plan.id, moduleId: String(mid) }))
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
  const { name, price, menuLimit, storeLimit, unlimitedMenus, unlimitedStores, moduleIds } = req.body || {}
  try {
    const updated = await prisma.saasPlan.update({ where: { id }, data: { name, price, menuLimit, storeLimit, unlimitedMenus, unlimitedStores } })
    if (Array.isArray(moduleIds)) {
      // replace module assignments
      await prisma.saasPlanModule.deleteMany({ where: { planId: id } })
      if (moduleIds.length) {
        const data = moduleIds.map(mid => ({ planId: id, moduleId: String(mid) }))
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

    // create subscription
    const created = await prisma.saasSubscription.create({ data: { companyId, planId, nextDueAt: nextDueAt ? new Date(nextDueAt) : null, period: chosen ? chosen.period : (req.body.period || null) } })

    // create initial invoice based on plan pricing (if available)
    try {
      const plan = await prisma.saasPlan.findUnique({ where: { id: String(planId) }, include: { prices: true } })
      let chosen = null
      if (plan && Array.isArray(plan.prices) && plan.prices.length) {
        // prefer MONTHLY if present
        chosen = plan.prices.find(p => String(p.period || '').toUpperCase() === 'MONTHLY') || plan.prices[0]
      }
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
    const sub = await prisma.saasSubscription.findUnique({ where: { companyId }, include: { plan: { include: { modules: { include: { module: true } } } } } })
    const enabled = []
    if (sub && sub.plan && Array.isArray(sub.plan.modules)) {
      for (const pm of sub.plan.modules) {
        const m = pm && pm.module
        if (m && m.isActive !== false) enabled.push(m.key)
      }
    }
    res.json({ companyId, enabled })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao obter módulos', error: e?.message || String(e) })
  }
})

// -------- Invoices (Mensalidades) --------
// List invoices for a company (ADMIN). SUPER_ADMIN may pass ?companyId= to view another company
saasRouter.get('/invoices', async (req, res) => {
  try {
    const qCompanyId = req.query.companyId || null
    if (qCompanyId) {
      await requireRole('SUPER_ADMIN')(req, res, async () => {})
    } else {
      await requireRole('ADMIN')(req, res, async () => {})
    }
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
    const rows = await prisma.saasInvoice.findMany({ where, orderBy: [{ year: 'desc' }, { month: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })
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
        const amount = chosen ? String(chosen.price) : String(s.plan ? s.plan.price : 0)
        const year = invoiceDate.getFullYear()
        const month = invoiceDate.getMonth() + 1
        await prisma.saasInvoice.create({ data: { subscriptionId: s.id, year, month, amount, dueDate: invoiceDate } })
        // compute next
        const period = chosen ? chosen.period : (s.period || 'MONTHLY')
        const next = new Date(invoiceDate)
        next.setMonth(next.getMonth() + monthsFromPeriod(period))
        await prisma.saasSubscription.update({ where: { id: s.id }, data: { nextDueAt: next } })
        results.push({ subscriptionId: s.id, year, month, amount })
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
  const rows = await prisma.company.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, slug: true, createdAt: true } })
  res.json(rows)
})

// Get single company (SUPER_ADMIN)
saasRouter.get('/companies/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  try {
    const c = await prisma.company.findUnique({ where: { id }, select: { id: true, name: true, slug: true, createdAt: true } })
    if (!c) return res.status(404).json({ message: 'Empresa não encontrada' })
    res.json(c)
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

// Update company (SUPER_ADMIN)
saasRouter.put('/companies/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
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

// Soft-delete / deactivate company (SUPER_ADMIN)
saasRouter.delete('/companies/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params
  try {
    // Soft actions: cancel subscriptions, deactivate stores, demote users, prefix name to indicate deletion
    const company = await prisma.company.findUnique({ where: { id } })
    if (!company) return res.status(404).json({ message: 'Empresa não encontrada' })
    const newName = `[DELETED] ${company.name}`
    await prisma.$transaction([
      prisma.saasSubscription.updateMany({ where: { companyId: id }, data: { status: 'CANCELED' } }),
      prisma.store.updateMany({ where: { companyId: id }, data: { isActive: false } }),
      prisma.user.updateMany({ where: { companyId: id, NOT: { role: 'SUPER_ADMIN' } }, data: { role: 'ATTENDANT' } }),
      prisma.company.update({ where: { id }, data: { name: newName } })
    ])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao remover empresa', error: e?.message || String(e) })
  }
})

export default saasRouter
