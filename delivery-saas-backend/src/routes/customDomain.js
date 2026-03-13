import express from 'express'
import dns from 'dns'
import fs from 'fs'
import path from 'path'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import { getSetting } from '../services/systemSettings.js'

// Directory where SSL provisioning requests are placed (bind-mounted with host)
const SSL_PENDING_DIR = '/var/www/certbot/pending'

// Poll for host-side SSL provisioning result (max 5 min)
function pollSslStatus(domainId, domainName) {
  const statusFile = path.join(SSL_PENDING_DIR, `${domainId}.status`)
  let attempts = 0
  const maxAttempts = 60 // 5 min (every 5s)

  const interval = setInterval(async () => {
    attempts++
    try {
      if (fs.existsSync(statusFile)) {
        const result = fs.readFileSync(statusFile, 'utf8').trim()
        clearInterval(interval)
        fs.unlinkSync(statusFile) // cleanup

        if (result === 'done') {
          console.log(`[SSL] Host provisioned SSL for ${domainName}`)
          await prisma.customDomain.update({
            where: { id: domainId },
            data: { status: 'ACTIVE', sslStatus: 'SSL_ACTIVE' }
          })
        } else {
          console.error(`[SSL] Host provisioning FAILED for ${domainName}`)
          await prisma.customDomain.update({
            where: { id: domainId },
            data: { sslStatus: 'FAILED' }
          })
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(interval)
        console.error(`[SSL] Timeout waiting for host to provision ${domainName}`)
        await prisma.customDomain.update({
          where: { id: domainId },
          data: { sslStatus: 'FAILED' }
        })
      }
    } catch (e) {
      console.error(`[SSL] Poll error for ${domainName}:`, e.message)
    }
  }, 5000)
}

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
    if (!mod || !mod.isActive) return res.json({ available: false })

    const monthly = mod.prices.find(p => p.period === 'MONTHLY')
    const yearly = mod.prices.find(p => p.period === 'ANNUAL')

    res.json({
      available: true,
      moduleId: mod.id,
      monthly: monthly ? Number(monthly.price) : null,
      yearly: yearly ? Number(yearly.price) : null,
      serverIp: await getSetting('custom_domain_server_ip', 'CUSTOM_DOMAIN_SERVER_IP') || null,
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

    const serverIp = await getSetting('custom_domain_server_ip', 'CUSTOM_DOMAIN_SERVER_IP')
    if (!serverIp) return res.status(500).json({ message: 'IP do servidor não configurado. Configure em Configurações SaaS.' })

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

    // Write HTTP-only nginx config (via bind mount to host)
    const nginxConf = `/etc/nginx/sites-enabled/${record.domain}.conf`
    const backendPort = process.env.PORT || '3000'
    const httpConfig = `server {
    listen 80;
    server_name ${record.domain};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:${backendPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`
    try {
      fs.writeFileSync(nginxConf, httpConfig)
      console.log(`[SSL] Wrote HTTP nginx config for ${record.domain}`)
    } catch (e) {
      console.error(`[SSL] Failed to write nginx config: ${e.message}`)
    }

    // Create trigger file for host-side cron to process
    try {
      fs.mkdirSync(SSL_PENDING_DIR, { recursive: true })
      fs.writeFileSync(path.join(SSL_PENDING_DIR, `${record.id}.domain`), record.domain)
      console.log(`[SSL] Trigger file created for ${record.domain} — waiting for host cron`)
    } catch (e) {
      console.error(`[SSL] Failed to create trigger file: ${e.message}`)
    }

    // Start polling for host-side result (cron writes .status file)
    pollSslStatus(record.id, record.domain)

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

// ---------- POST /custom-domains/:id/retry-ssl ----------
// Reset domain back to PENDING_DNS so admin can retry DNS verification + SSL provisioning.
// Only allowed if domain is already paid (paidUntil in the future) — avoids double charge.
router.post('/:id/retry-ssl', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const record = await prisma.customDomain.findUnique({ where: { id } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })
    if (record.companyId !== req.user.companyId) return res.status(403).json({ message: 'Forbidden' })

    // Only allow retry for stuck statuses (VERIFYING with failed SSL, or SUSPENDED that's still paid)
    const allowedStatuses = ['VERIFYING', 'SUSPENDED']
    if (!allowedStatuses.includes(record.status)) {
      return res.status(400).json({ message: `Não é possível reiniciar a configuração no status ${record.status}` })
    }

    // Check if already paid — if paidUntil exists and is in the future, skip payment
    const isPaid = record.paidUntil && new Date(record.paidUntil) > new Date()

    const updated = await prisma.customDomain.update({
      where: { id },
      data: {
        status: isPaid ? 'PENDING_DNS' : 'PENDING_PAYMENT',
        sslStatus: 'NONE',
      },
      include: { menu: { select: { id: true, name: true } } },
    })

    console.log(`[CustomDomain] Retry for ${record.domain}: isPaid=${isPaid}, newStatus=${updated.status}`)
    res.json(updated)
  } catch (e) {
    console.error('POST /custom-domains/:id/retry-ssl error:', e?.message || e)
    res.status(500).json({ message: 'Erro ao reiniciar configuração', error: e?.message })
  }
})

export default router
