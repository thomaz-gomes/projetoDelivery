# Custom Domain Module — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow company admins to assign custom domains to menus, with per-domain billing via Mercado Pago, automated DNS verification, and SSL provisioning via Certbot + Nginx.

**Architecture:** New `CustomDomain` Prisma model linked to `Menu` + `Company`. Backend middleware resolves custom domain requests to the correct public menu. Admin UI is a new tab in `MenuEdit.vue`. Billing follows existing `SaasModule` + `SaasModulePrice` + `SaasModuleSubscription` + payment flow.

**Tech Stack:** Prisma (PostgreSQL), Express.js, Vue 3 + Bootstrap 5, Mercado Pago, Certbot, Nginx, node-cron

**Design doc:** `docs/plans/2026-03-12-custom-domain-design.md`

---

## Task 1: Database Schema

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add enums and CustomDomain model to schema.prisma**

After the existing enums (around line 30), add:

```prisma
enum CustomDomainStatus {
  PENDING_PAYMENT
  PENDING_DNS
  VERIFYING
  ACTIVE
  SUSPENDED
}

enum SslStatus {
  NONE
  PROVISIONING
  SSL_ACTIVE
  FAILED
}

enum BillingCycle {
  MONTHLY
  YEARLY
}
```

Add the model (after the Menu model, around line 542):

```prisma
model CustomDomain {
  id          String              @id @default(uuid())
  domain      String              @unique
  menuId      String
  menu        Menu                @relation(fields: [menuId], references: [id])
  companyId   String
  company     Company             @relation(fields: [companyId], references: [id])
  status      CustomDomainStatus  @default(PENDING_PAYMENT)
  sslStatus   SslStatus           @default(NONE)
  verifiedAt  DateTime?
  price       Decimal
  billingCycle BillingCycle       @default(MONTHLY)
  paidUntil   DateTime?
  autoRenew   Boolean             @default(true)
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
}
```

**Step 2: Add relations to existing models**

In the `Menu` model, add:
```prisma
customDomain CustomDomain?
```

In the `Company` model, add:
```prisma
customDomains CustomDomain[]
```

**Step 3: Add `CUSTOM_DOMAIN` to ModuleKey enum**

```prisma
enum ModuleKey {
  CARDAPIO_SIMPLES
  CARDAPIO_COMPLETO
  RIDERS
  AFFILIATES
  STOCK
  CASHBACK
  COUPONS
  WHATSAPP
  FINANCIAL
  FISCAL
  CUSTOM_DOMAIN
}
```

**Step 4: Push schema to dev database**

Run: `docker compose exec backend npx prisma db push`

**Step 5: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add CustomDomain model with billing and SSL status"
```

---

## Task 2: Backend — Custom Domain CRUD Routes

**Files:**
- Create: `delivery-saas-backend/src/routes/customDomain.js`
- Modify: `delivery-saas-backend/src/index.js` (register route)

**Step 1: Create route file**

Create `delivery-saas-backend/src/routes/customDomain.js` with:

```javascript
import express from 'express'
import dns from 'dns'
import { promisify } from 'util'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'

const resolve4 = promisify(dns.resolve4)
const router = express.Router()
router.use(authMiddleware)

// GET /custom-domains — list company's custom domains
router.get('/', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const domains = await prisma.customDomain.findMany({
      where: { companyId },
      include: { menu: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    })
    res.json(domains)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar domínios', error: e?.message })
  }
})

// GET /custom-domains/pricing — get current domain pricing
router.get('/pricing', async (req, res) => {
  try {
    const mod = await prisma.saasModule.findFirst({
      where: { key: 'CUSTOM_DOMAIN', isActive: true },
      include: { prices: true }
    })
    if (!mod) return res.json({ available: false })
    const monthly = mod.prices.find(p => p.period === 'MONTHLY')
    const yearly = mod.prices.find(p => p.period === 'ANNUAL')
    res.json({
      available: true,
      moduleId: mod.id,
      monthly: monthly ? Number(monthly.price) : null,
      yearly: yearly ? Number(yearly.price) : null
    })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar preços', error: e?.message })
  }
})

// POST /custom-domains — register a new custom domain
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { domain, menuId, billingCycle } = req.body

    if (!domain || !menuId) {
      return res.status(400).json({ message: 'domain e menuId são obrigatórios' })
    }

    // Validate domain format
    const domainClean = domain.toLowerCase().trim()
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domainClean)) {
      return res.status(400).json({ message: 'Formato de domínio inválido' })
    }

    // Check uniqueness
    const existing = await prisma.customDomain.findUnique({ where: { domain: domainClean } })
    if (existing) {
      return res.status(409).json({ message: 'Este domínio já está cadastrado' })
    }

    // Verify menu belongs to company
    const menu = await prisma.menu.findFirst({ where: { id: menuId, store: { companyId } } })
    if (!menu) {
      return res.status(404).json({ message: 'Cardápio não encontrado' })
    }

    // Check if menu already has a domain
    const menuDomain = await prisma.customDomain.findFirst({ where: { menuId } })
    if (menuDomain) {
      return res.status(409).json({ message: 'Este cardápio já possui um domínio customizado' })
    }

    // Get pricing
    const mod = await prisma.saasModule.findFirst({
      where: { key: 'CUSTOM_DOMAIN', isActive: true },
      include: { prices: true }
    })
    if (!mod) {
      return res.status(400).json({ message: 'Módulo de domínio próprio não está disponível' })
    }

    const cycle = billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY'
    const pricePeriod = cycle === 'YEARLY' ? 'ANNUAL' : 'MONTHLY'
    const priceRecord = mod.prices.find(p => p.period === pricePeriod)
    if (!priceRecord) {
      return res.status(400).json({ message: `Preço não configurado para o período ${cycle}` })
    }

    const record = await prisma.customDomain.create({
      data: {
        domain: domainClean,
        menuId,
        companyId,
        billingCycle: cycle,
        price: priceRecord.price,
        status: 'PENDING_PAYMENT'
      }
    })

    res.status(201).json(record)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao cadastrar domínio', error: e?.message })
  }
})

// PATCH /custom-domains/:id — update domain settings
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { id } = req.params
    const record = await prisma.customDomain.findFirst({ where: { id, companyId } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })

    const updates = {}
    if (req.body.domain !== undefined) {
      const domainClean = req.body.domain.toLowerCase().trim()
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domainClean)) {
        return res.status(400).json({ message: 'Formato de domínio inválido' })
      }
      const conflict = await prisma.customDomain.findUnique({ where: { domain: domainClean } })
      if (conflict && conflict.id !== id) {
        return res.status(409).json({ message: 'Este domínio já está cadastrado' })
      }
      updates.domain = domainClean
    }
    if (req.body.autoRenew !== undefined) updates.autoRenew = !!req.body.autoRenew

    const updated = await prisma.customDomain.update({ where: { id }, data: updates })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar domínio', error: e?.message })
  }
})

// DELETE /custom-domains/:id — remove custom domain
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const record = await prisma.customDomain.findFirst({ where: { id: req.params.id, companyId } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })

    await prisma.customDomain.delete({ where: { id: req.params.id } })
    // TODO: In production, also revoke SSL cert and remove Nginx config
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao remover domínio', error: e?.message })
  }
})

// POST /custom-domains/:id/verify — verify DNS and provision SSL
router.post('/:id/verify', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const record = await prisma.customDomain.findFirst({ where: { id: req.params.id, companyId } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })

    if (!['PENDING_DNS', 'ACTIVE', 'SUSPENDED'].includes(record.status)) {
      return res.status(400).json({ message: 'Domínio não está em estado verificável' })
    }

    const SERVER_IP = process.env.CUSTOM_DOMAIN_SERVER_IP || ''
    if (!SERVER_IP) {
      return res.status(500).json({ message: 'IP do servidor não configurado (CUSTOM_DOMAIN_SERVER_IP)' })
    }

    try {
      const addresses = await resolve4(record.domain)
      if (!addresses.includes(SERVER_IP)) {
        return res.json({
          verified: false,
          message: `DNS aponta para ${addresses.join(', ')} — esperado: ${SERVER_IP}`,
          expected: SERVER_IP,
          actual: addresses
        })
      }
    } catch (dnsErr) {
      return res.json({
        verified: false,
        message: `Não foi possível resolver o domínio: ${dnsErr.code || dnsErr.message}`
      })
    }

    // DNS verified — update status
    await prisma.customDomain.update({
      where: { id: record.id },
      data: {
        status: 'VERIFYING',
        sslStatus: 'PROVISIONING',
        verifiedAt: new Date()
      }
    })

    // Trigger SSL provisioning asynchronously
    // In production this calls the provision-ssl.sh script
    // For now, just mark as active (SSL provisioning will be implemented in Task 5)
    setTimeout(async () => {
      try {
        // TODO: call provision-ssl.sh here
        await prisma.customDomain.update({
          where: { id: record.id },
          data: { status: 'ACTIVE', sslStatus: 'SSL_ACTIVE' }
        })
      } catch (e) {
        console.error('SSL provisioning failed for', record.domain, e)
        await prisma.customDomain.update({
          where: { id: record.id },
          data: { sslStatus: 'FAILED' }
        }).catch(() => {})
      }
    }, 2000)

    res.json({ verified: true, message: 'DNS verificado. Provisionando SSL...' })
  } catch (e) {
    res.status(500).json({ message: 'Erro na verificação', error: e?.message })
  }
})

// POST /custom-domains/:id/activate — mark as paid and activate (after payment)
router.post('/:id/activate', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const record = await prisma.customDomain.findFirst({ where: { id: req.params.id, companyId } })
    if (!record) return res.status(404).json({ message: 'Domínio não encontrado' })

    const cycle = record.billingCycle
    const now = new Date()
    const paidUntil = new Date(now)
    if (cycle === 'YEARLY') {
      paidUntil.setFullYear(paidUntil.getFullYear() + 1)
    } else {
      paidUntil.setMonth(paidUntil.getMonth() + 1)
    }

    const updated = await prisma.customDomain.update({
      where: { id: record.id },
      data: { status: 'PENDING_DNS', paidUntil }
    })

    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao ativar', error: e?.message })
  }
})

// SUPER_ADMIN: GET /custom-domains/admin/all — list all domains system-wide
router.get('/admin/all', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { status } = req.query
    const where = status ? { status } : {}
    const domains = await prisma.customDomain.findMany({
      where,
      include: {
        menu: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    res.json(domains)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar domínios', error: e?.message })
  }
})

export default router
```

**Step 2: Register route in index.js**

In `delivery-saas-backend/src/index.js`, add import:
```javascript
import customDomainRouter from './routes/customDomain.js'
```

Add route mount (after the `/payment` line):
```javascript
app.use('/custom-domains', customDomainRouter);
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/customDomain.js delivery-saas-backend/src/index.js
git commit -m "feat: add custom domain CRUD routes with DNS verification"
```

---

## Task 3: Backend — Custom Domain Middleware (Host Resolution)

**Files:**
- Create: `delivery-saas-backend/src/middleware/customDomainResolver.js`
- Modify: `delivery-saas-backend/src/index.js` (mount middleware before routes)

**Step 1: Create middleware**

Create `delivery-saas-backend/src/middleware/customDomainResolver.js`:

```javascript
import { prisma } from '../prisma.js'

// In-memory cache: domain -> { companyId, menuId, ts }
const cache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Domains to never resolve as custom (the system's own domains)
const SYSTEM_DOMAINS = (process.env.SYSTEM_DOMAINS || 'localhost').split(',').map(d => d.trim().toLowerCase())

export function customDomainResolver() {
  return async (req, res, next) => {
    try {
      const host = (req.hostname || req.headers.host || '').split(':')[0].toLowerCase()

      // Skip system domains
      if (!host || SYSTEM_DOMAINS.some(sd => host === sd || host.endsWith('.' + sd))) {
        return next()
      }

      // Check cache
      const now = Date.now()
      const cached = cache.get(host)
      if (cached && (now - cached.ts) < CACHE_TTL_MS) {
        if (cached.notFound) return next()
        req.customDomain = cached
        // Rewrite URL to serve public menu
        req.url = `/public/${cached.companyId}/menu?menuId=${cached.menuId}`
        return next()
      }

      // DB lookup
      const record = await prisma.customDomain.findUnique({
        where: { domain: host },
        select: { id: true, companyId: true, menuId: true, status: true, paidUntil: true }
      })

      if (!record) {
        cache.set(host, { notFound: true, ts: now })
        return next()
      }

      // Check status and payment
      if (record.status !== 'ACTIVE') {
        return res.status(503).send('Domínio não está ativo. Contate o administrador.')
      }

      if (record.paidUntil && new Date(record.paidUntil) < new Date()) {
        return res.status(503).send('Assinatura do domínio vencida. Contate o administrador.')
      }

      const entry = { companyId: record.companyId, menuId: record.menuId, ts: now }
      cache.set(host, entry)
      req.customDomain = entry

      // Rewrite URL to serve public menu
      req.url = `/public/${record.companyId}/menu?menuId=${record.menuId}`
      return next()
    } catch (e) {
      console.error('customDomainResolver error:', e?.message)
      return next()
    }
  }
}

// Allow clearing cache when domain is updated/deleted
export function clearDomainCache(domain) {
  if (domain) cache.delete(domain.toLowerCase())
}
```

**Step 2: Mount middleware in index.js BEFORE routes**

In `delivery-saas-backend/src/index.js`, add import:
```javascript
import { customDomainResolver } from './middleware/customDomainResolver.js'
```

Add BEFORE the routes section (after the bodyParser middleware, around line 166):
```javascript
// Custom domain resolver — must be before routes
app.use(customDomainResolver());
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/middleware/customDomainResolver.js delivery-saas-backend/src/index.js
git commit -m "feat: add custom domain host resolution middleware with cache"
```

---

## Task 4: Backend — Cron Job for Expired Domains

**Files:**
- Modify: `delivery-saas-backend/src/cron.js`

**Step 1: Add expiration check cron**

Add to `delivery-saas-backend/src/cron.js`:

```javascript
import { prisma } from './prisma.js'

// Check for expired custom domains daily at 01:00
cron.schedule('0 1 * * *', async () => {
  console.log('[Cron] Verificando domínios customizados vencidos...')
  try {
    const result = await prisma.customDomain.updateMany({
      where: {
        status: 'ACTIVE',
        paidUntil: { lt: new Date() }
      },
      data: { status: 'SUSPENDED' }
    })
    if (result.count > 0) {
      console.log(`[Cron] ${result.count} domínio(s) suspenso(s) por vencimento`)
    }
  } catch (err) {
    console.error('[Cron] Erro ao verificar domínios vencidos:', err)
  }
}, {
  timezone: 'America/Sao_Paulo',
})
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/cron.js
git commit -m "feat: add daily cron to suspend expired custom domains"
```

---

## Task 5: Backend — SSL Provisioning Script

**Files:**
- Create: `delivery-saas-backend/scripts/provision-ssl.sh`
- Modify: `delivery-saas-backend/src/routes/customDomain.js` (call script from verify endpoint)

**Step 1: Create provision script**

Create `delivery-saas-backend/scripts/provision-ssl.sh`:

```bash
#!/bin/bash
# Usage: provision-ssl.sh <domain> <backend_port>
# Generates Let's Encrypt cert and Nginx config for a custom domain.

set -euo pipefail

DOMAIN="$1"
BACKEND_PORT="${2:-3000}"
NGINX_CONF="/etc/nginx/sites-enabled/${DOMAIN}.conf"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@deliverysaas.com.br}"

# 1. Generate SSL certificate
certbot certonly \
  --nginx \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "$CERTBOT_EMAIL" \
  --no-eff-email

# 2. Generate Nginx config
cat > "$NGINX_CONF" <<CONF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF

# 3. Reload Nginx
nginx -t && nginx -s reload

echo "SSL provisioned for ${DOMAIN}"
```

**Step 2: Update verify endpoint to call script**

In the `verify` endpoint of `customDomain.js`, replace the setTimeout/TODO block with:

```javascript
import { exec } from 'child_process'
import path from 'path'

// Inside the verify handler, after DNS is verified:
const scriptPath = path.join(process.cwd(), 'scripts', 'provision-ssl.sh')
const backendPort = process.env.PORT || '3000'

exec(`bash "${scriptPath}" "${record.domain}" "${backendPort}"`, async (err, stdout, stderr) => {
  try {
    if (err) {
      console.error('SSL provisioning failed:', stderr || err.message)
      await prisma.customDomain.update({
        where: { id: record.id },
        data: { sslStatus: 'FAILED' }
      })
      return
    }
    console.log('SSL provisioned:', stdout)
    await prisma.customDomain.update({
      where: { id: record.id },
      data: { status: 'ACTIVE', sslStatus: 'SSL_ACTIVE' }
    })
  } catch (e) {
    console.error('SSL post-provision update failed:', e)
  }
})
```

**Step 3: Make script executable and commit**

```bash
chmod +x delivery-saas-backend/scripts/provision-ssl.sh
git add delivery-saas-backend/scripts/provision-ssl.sh delivery-saas-backend/src/routes/customDomain.js
git commit -m "feat: add SSL provisioning script for custom domains"
```

---

## Task 6: Frontend — Custom Domain Tab in MenuEdit

**Files:**
- Modify: `delivery-saas-frontend/src/views/MenuEdit.vue`

This is the main UI change. MenuEdit.vue currently has no tabs — it's a flat form. We need to:
1. Add a tab system (Bootstrap nav-tabs)
2. Move existing form content into a "Geral" tab
3. Add a "Domínio Próprio" tab

**Step 1: Restructure template with tabs**

Wrap the existing form content in a tab structure. Add an `activeTab` ref. The "Domínio Próprio" tab shows:
- If no custom domain exists and no pricing → "Funcionalidade não disponível"
- If pricing available but no domain → Frozen fields + subscription CTA with cycle selector and price
- If `PENDING_PAYMENT` → "Aguardando confirmação de pagamento"
- If `PENDING_DNS` → Domain input + DNS instructions card + "Verificar DNS" button
- If `VERIFYING` → Spinner + "Gerando certificado SSL..."
- If `ACTIVE` → Green badge, link, expiration, auto-renew toggle, remove button
- If `SUSPENDED` → Red badge, renew button

**Step 2: Add script logic**

Add reactive state:
```javascript
const activeTab = ref('general')
const customDomain = ref(null)
const domainPricing = ref(null)
const domainForm = ref({ domain: '', billingCycle: 'MONTHLY' })
const domainLoading = ref(false)
const domainError = ref('')
```

Add functions:
- `loadDomainData()` — calls `GET /custom-domains` and `GET /custom-domains/pricing`
- `subscribeDomain()` — calls `POST /custom-domains` then `POST /custom-domains/:id/activate` (or triggers payment flow)
- `verifyDns()` — calls `POST /custom-domains/:id/verify`
- `toggleAutoRenew()` — calls `PATCH /custom-domains/:id`
- `removeDomain()` — calls `DELETE /custom-domains/:id` with SweetAlert confirmation

Call `loadDomainData()` from `onMounted` when `isEdit` is true.

**Step 3: Template for Domínio Próprio tab**

The DNS instructions card must include:
1. Step-by-step guide with provider examples (Registro.br, GoDaddy, Hostinger)
2. Registro A: Host `@`, Valor `{SERVER_IP}` (from env `CUSTOM_DOMAIN_SERVER_IP`)
3. CNAME for www
4. Propagation notice (up to 24h)

Server IP is returned from `GET /custom-domains/pricing` endpoint (add `serverIp` field).

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/MenuEdit.vue
git commit -m "feat(frontend): add custom domain tab to MenuEdit with DNS instructions"
```

---

## Task 7: Frontend — Payment Integration for Domain Subscription

**Files:**
- Modify: `delivery-saas-frontend/src/views/MenuEdit.vue` (subscribeDomain function)

**Step 1: Integrate with existing payment flow**

The subscribe flow should:
1. Call `POST /custom-domains` to create the record (status = PENDING_PAYMENT)
2. Call `POST /payment/create-preference` with `type: 'MODULE'`, `referenceId: CUSTOM_DOMAIN module id`, `period: billingCycle`
3. Redirect to Mercado Pago checkout URL
4. On return (success callback), call `POST /custom-domains/:id/activate`

Alternatively, if the payment system already handles module subscriptions generically, reuse the same approach used for other module add-ons.

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/MenuEdit.vue
git commit -m "feat(frontend): integrate domain subscription with Mercado Pago payment"
```

---

## Task 8: SUPER_ADMIN — Module Setup and Domain Management

**Files:**
- Modify: `delivery-saas-frontend/src/views/SaasSettings.vue` or create domain admin view
- Backend: Module + pricing already handled by existing `/saas/modules` CRUD

**Step 1: Seed CUSTOM_DOMAIN module**

The SUPER_ADMIN creates the module via the existing `/saas/modules` UI or via a seed script:

```javascript
// seed-custom-domain-module.js
const module = await prisma.saasModule.create({
  data: {
    key: 'CUSTOM_DOMAIN',
    name: 'Domínio Próprio',
    description: 'Configure um domínio personalizado para seu cardápio',
    isActive: true,
    platformFee: 0
  }
})

await prisma.saasModulePrice.createMany({
  data: [
    { moduleId: module.id, period: 'MONTHLY', price: 9.90 },
    { moduleId: module.id, period: 'ANNUAL', price: 99.00 }
  ]
})
```

**Step 2: Add CUSTOM_DOMAIN_SERVER_IP to env**

In `.env` or docker-compose:
```
CUSTOM_DOMAIN_SERVER_IP=<VPS IP>
SYSTEM_DOMAINS=localhost,app.deliverysaas.com.br,redemultilink.com.br
```

**Step 3: Add server IP to pricing endpoint**

In `customDomain.js` GET `/pricing`, add:
```javascript
serverIp: process.env.CUSTOM_DOMAIN_SERVER_IP || ''
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add CUSTOM_DOMAIN module seed and environment config"
```

---

## Task 9: Testing and Verification

**Step 1: Verify database**

Run: `docker compose exec backend npx prisma db push`
Verify with: `docker compose exec backend npx prisma studio` — check CustomDomain table exists

**Step 2: Test API routes**

Using curl or frontend:
1. Create CUSTOM_DOMAIN module via SaaS admin
2. Set pricing (R$ 9.90/month, R$ 99.00/year)
3. As ADMIN, call `GET /custom-domains/pricing` — verify prices returned
4. Call `POST /custom-domains` with domain + menuId — verify record created
5. Call `POST /custom-domains/:id/activate` — verify status changes to PENDING_DNS
6. Call `POST /custom-domains/:id/verify` — verify DNS check runs

**Step 3: Test middleware**

Temporarily add test domain to `/etc/hosts`:
```
127.0.0.1 test.meucardapio.com.br
```
Access `http://test.meucardapio.com.br:3000` — should resolve to the correct public menu.

**Step 4: Test frontend**

1. Open MenuEdit for an existing menu
2. Verify "Domínio Próprio" tab appears
3. Verify frozen state with CTA
4. Test subscription flow
5. Verify DNS instructions display correctly

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: custom domain module complete"
```
