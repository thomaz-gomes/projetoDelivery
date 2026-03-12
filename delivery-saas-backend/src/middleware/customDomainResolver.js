import { prisma } from '../prisma.js'

// In-memory cache: domain -> { companyId, menuId, ts } or { notFound: true, ts }
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
      return next() // fail open — don't block requests on error
    }
  }
}

// Allow clearing cache when domain is updated/deleted
export function clearDomainCache(domain) {
  if (domain) cache.delete(domain.toLowerCase())
}
