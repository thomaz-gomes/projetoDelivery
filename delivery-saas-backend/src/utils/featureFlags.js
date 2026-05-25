import { prisma } from '../prisma.js'

const FLAG_CACHE = new Map()
const CACHE_TTL_MS = 60_000

/**
 * Check whether a feature flag is enabled for a company.
 *
 * Flags live in Company.flags (JSON column). Cached for 60s to avoid
 * hammering Postgres on every request. Cache is per-process and not
 * coordinated across replicas — invalidation is best-effort via
 * invalidateFlagCache().
 *
 * Returns false when the flag is unset, null, or any falsy value.
 */
export async function isFlagEnabled(companyId, flag) {
  if (!companyId || !flag) return false
  const cacheKey = `${companyId}:${flag}`
  const cached = FLAG_CACHE.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { flags: true },
  })
  const value = !!(company?.flags && company.flags[flag])
  FLAG_CACHE.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

export function invalidateFlagCache(companyId, flag) {
  if (companyId && flag) FLAG_CACHE.delete(`${companyId}:${flag}`)
}

// Test-only helper: clear the entire cache. Not part of the public API.
export function _clearFlagCacheForTests() {
  FLAG_CACHE.clear()
}
