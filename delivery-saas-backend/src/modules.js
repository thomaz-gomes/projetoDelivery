import { prisma } from './prisma.js'

// Read enforcement flag from env; default disabled to avoid breaking flows unexpectedly
export const ENFORCE_MODULES = String(process.env.ENFORCE_MODULES || '').toLowerCase() === '1' || String(process.env.ENFORCE_MODULES || '').toLowerCase() === 'true'

// Simple in-memory cache with TTL to avoid frequent DB hits
const cache = new Map() // companyId -> { keys: Set<string>, ts: number }
const TTL_MS = process.env.MODULES_CACHE_TTL_MS ? Number(process.env.MODULES_CACHE_TTL_MS) : 30000

async function fetchEnabledModuleKeys(companyId){
  const now = Date.now()
  const c = cache.get(companyId)
  if (c && (now - c.ts) < TTL_MS) return c.keys
  const sub = await prisma.saasSubscription.findUnique({ where: { companyId }, include: { plan: { include: { modules: { include: { module: true } } } } } })
  const keys = new Set()
  if (sub && sub.plan && Array.isArray(sub.plan.modules)) {
    for (const pm of sub.plan.modules) {
      const m = pm && pm.module
      if (m && m.isActive !== false && m.key) keys.add(String(m.key).toLowerCase())
    }
  }
  cache.set(companyId, { keys, ts: now })
  return keys
}

export function requireModule(moduleKey){
  // No-op if enforcement disabled
  if (!ENFORCE_MODULES) {
    return (_req, _res, next) => next()
  }
  const need = String(moduleKey || '').toLowerCase()
  return async (req, res, next) => {
    try {
      const user = req.user
      if (!user || !user.companyId) return res.status(401).json({ message: 'Não autenticado' })
      const enabled = await fetchEnabledModuleKeys(user.companyId)
      if (!enabled.has(need)) {
        return res.status(403).json({ message: 'Módulo não habilitado', module: moduleKey })
      }
      return next()
    } catch (e) {
      return res.status(500).json({ message: 'Falha ao validar módulo', error: e?.message || String(e) })
    }
  }
}

export async function getEnabledModules(companyId){
  const keys = await fetchEnabledModuleKeys(companyId)
  return Array.from(keys.values())
}
