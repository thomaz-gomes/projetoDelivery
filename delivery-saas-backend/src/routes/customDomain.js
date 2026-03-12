import express from 'express'
import dns from 'dns'
import { exec } from 'child_process'
import path from 'path'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'

const router = express.Router()
router.use(authMiddleware)

// Valid domain regex: allows subdomains, min 2 labels, TLD >= 2 chars
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

// ---------- GET /custom-domains ----------
// List company's custom domains
router.get('/', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const rows = await prisma.customDomain.findMany({
      where: { companyId: req.user.companyId },
      include: { menu: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json(rows)
  } catch (e) {
    console.error('GET /custom-domains error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao listar domínios', error: e?.message })
  }
})

// ---------- GET /custom-domains/pricing ----------
// Get current domain pricing from SaasModule CUSTOM_DOMAIN
router.get('/pricing', async (req, res) => {
  try {
    const mod = await prisma.saasModule.findUnique({
      where: { key: 'CUSTOM_DOMAIN' },
      include: { prices: true },
    })
    if (!mod) return res.status(404).json({ message: 'Módulo CUSTOM_DOMAIN não encontrado' })

    const prices = {}
    for (const p of mod.prices) {
      prices[p.period] = p.price
    }

    res.json({
      moduleId: mod.id,
      prices,
      serverIp: process.env.CUSTOM_DOMAIN_SERVER_IP || null,
    })
  } catch (e) {
    console.error('GET /custom-domains/pricing error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao buscar preços', error: e?.message })
  }
})

// ---------- GET /custom-domains/admin/all ----------
// SUPER_ADMIN: list all domains system-wide with optional status filter
router.get('/admin/all', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const where = {}
    if (req.query.status) where.status = req.query.status

    const rows = await prisma.customDomain.findMany({
      where,
      include: {
        menu: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(rows)
  } catch (e) {
    console.error('GET /custom-domains/admin/all error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao listar domínios', error: e?.message })
  }
})

// ---------- POST /custom-domains ----------
// Register a new custom domain
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const { domain, menuId, billingCycle } = req.body || {}
    if (!domain || !menuId) return res.status(400).json({ message: 'domain e menuId são obrigatórios' })

    // Validate domain format
    if (!DOMAIN_RE.test(domain)) {
      return res.status(400).json({ message: 'Formato de domínio inválido' })
    }

    // Validate billingCycle
    const cycle = (billingCycle || 'MONTHLY').toUpperCase()
    if (!['MONTHLY', 'YEARLY'].includes(cycle)) {
      return res.status(400).json({ message: 'billingCycle deve ser MONTHLY ou YEARLY' })
    }

    // Check uniqueness
    const existing = await prisma.customDomain.findUnique({ where: { domain } })
    if (existing) return res.status(409).json({ message: 'Domínio já registrado' })

    // Verify menu belongs to company
    const menu = await prisma.menu.findUnique({
      where: { id: menuId },
      include: { store: { select: { companyId: true } } },
    })
    if (!menu) return res.status(404).json({ message: 'Menu não encontrado' })
    if (menu.store.companyId !== req.user.companyId) {
      return res.status(403).json({ message: 'Menu não pertence à sua empresa' })
    }

    // Check menu doesn't already have a domain
    const menuDomain = await prisma.customDomain.findFirst({ where: { menuId } })
    if (menuDomain) return res.status(409).json({ message: 'Este menu já possui um domínio personalizado' })

    // Get pricing from SaasModule + SaasModulePrice
    const mod = await prisma.saasModule.findUnique({
      where: { key: 'CUSTOM_DOMAIN' },
      include: { prices: true },
    })
    if (!mod) return res.status(500).json({ message: 'Módulo CUSTOM_DOMAIN não configurado' })

    const pricePeriod = cycle === 'YEARLY' ? 'ANNUAL' : 'MONTHLY'
    const priceRecord = mod.prices.find(p => p.period === pricePeriod)
    if (!priceRecord) return res.status(500).json({ message: `Preço não configurado para período ${pricePeriod}` })

    const created = await prisma.customDomain.create({
      data: {
        domain: domain.toLowerCase(),
        menuId,
        companyId: req.user.companyId,
        status: 'PENDING_PAYMENT',
        price: priceRecord.price,
        billingCycle: cycle,
      },
      include: { menu: { select: { id: true, name: true } } },
    })

    res.status(201).json(created)
  } catch (e) {
    console.error('POST /custom-domains error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao registrar domínio', error: e?.message })
  }
})

// ---------- PATCH /custom-domains/:id ----------
// Update domain settings (domain, autoRenew)
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const record = await prisma.customDomain.findUnique({ where: { id } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })
    if (record.companyId !== req.user.companyId) return res.status(403).json({ message: 'Forbidden' })

    const data = {}
    if (req.body.domain !== undefined) {
      if (!DOMAIN_RE.test(req.body.domain)) {
        return res.status(400).json({ message: 'Formato de domínio inválido' })
      }
      // Check uniqueness of new domain
      const dup = await prisma.customDomain.findUnique({ where: { domain: req.body.domain } })
      if (dup && dup.id !== id) return res.status(409).json({ message: 'Domínio já registrado' })
      data.domain = req.body.domain.toLowerCase()
    }
    if (req.body.autoRenew !== undefined) {
      data.autoRenew = Boolean(req.body.autoRenew)
    }

    if (!Object.keys(data).length) return res.status(400).json({ message: 'Nenhum campo para atualizar' })

    const updated = await prisma.customDomain.update({
      where: { id },
      data,
      include: { menu: { select: { id: true, name: true } } },
    })
    res.json(updated)
  } catch (e) {
    console.error('PATCH /custom-domains/:id error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao atualizar domínio', error: e?.message })
  }
})

// ---------- DELETE /custom-domains/:id ----------
// Remove custom domain
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const record = await prisma.customDomain.findUnique({ where: { id } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })
    if (record.companyId !== req.user.companyId) return res.status(403).json({ message: 'Forbidden' })

    await prisma.customDomain.delete({ where: { id } })
    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /custom-domains/:id error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao remover domínio', error: e?.message })
  }
})

// ---------- POST /custom-domains/:id/verify ----------
// Verify DNS pointing
router.post('/:id/verify', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const record = await prisma.customDomain.findUnique({ where: { id } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })
    if (record.companyId !== req.user.companyId) return res.status(403).json({ message: 'Forbidden' })

    const serverIp = process.env.CUSTOM_DOMAIN_SERVER_IP
    if (!serverIp) return res.status(500).json({ message: 'CUSTOM_DOMAIN_SERVER_IP não configurado' })

    // Resolve DNS
    let addresses
    try {
      addresses = await new Promise((resolve, reject) => {
        dns.resolve4(record.domain, (err, addrs) => {
          if (err) return reject(err)
          resolve(addrs)
        })
      })
    } catch (dnsErr) {
      return res.status(400).json({
        verified: false,
        message: `DNS não resolvido para ${record.domain}: ${dnsErr.code || dnsErr.message}`,
      })
    }

    if (!addresses.includes(serverIp)) {
      return res.status(400).json({
        verified: false,
        message: `DNS aponta para ${addresses.join(', ')} — esperado ${serverIp}`,
        addresses,
        expected: serverIp,
      })
    }

    // DNS verified — update status and trigger SSL provisioning placeholder
    const updated = await prisma.customDomain.update({
      where: { id },
      data: {
        status: 'VERIFYING',
        sslStatus: 'PROVISIONING',
        verifiedAt: new Date(),
      },
    })

    // Trigger SSL provisioning asynchronously
    const scriptPath = path.join(process.cwd(), 'scripts', 'provision-ssl.sh')
    const backendPort = process.env.PORT || '3000'

    exec(`bash "${scriptPath}" "${record.domain}" "${backendPort}"`, async (err, stdout, stderr) => {
      try {
        if (err) {
          console.error('SSL provisioning failed for', record.domain, ':', stderr || err.message)
          await prisma.customDomain.update({
            where: { id: record.id },
            data: { sslStatus: 'FAILED' }
          })
          return
        }
        console.log('SSL provisioned for', record.domain, ':', stdout)
        await prisma.customDomain.update({
          where: { id: record.id },
          data: { status: 'ACTIVE', sslStatus: 'SSL_ACTIVE' }
        })
      } catch (e) {
        console.error('SSL post-provision update failed:', e)
      }
    })

    res.json({ verified: true, status: updated.status, sslStatus: updated.sslStatus })
  } catch (e) {
    console.error('POST /custom-domains/:id/verify error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao verificar DNS', error: e?.message })
  }
})

// ---------- POST /custom-domains/:id/activate ----------
// Mark as paid — sets status to PENDING_DNS and calculates paidUntil
router.post('/:id/activate', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const record = await prisma.customDomain.findUnique({ where: { id } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })
    if (record.companyId !== req.user.companyId) return res.status(403).json({ message: 'Forbidden' })

    const now = new Date()
    const paidUntil = new Date(now)
    if (record.billingCycle === 'YEARLY') {
      paidUntil.setFullYear(paidUntil.getFullYear() + 1)
    } else {
      paidUntil.setMonth(paidUntil.getMonth() + 1)
    }

    const updated = await prisma.customDomain.update({
      where: { id },
      data: {
        status: 'PENDING_DNS',
        paidUntil,
      },
      include: { menu: { select: { id: true, name: true } } },
    })
    res.json(updated)
  } catch (e) {
    console.error('POST /custom-domains/:id/activate error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao ativar domínio', error: e?.message })
  }
})

export default router
