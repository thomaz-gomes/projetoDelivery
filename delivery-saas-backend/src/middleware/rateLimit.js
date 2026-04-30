/**
 * Simple in-memory rate limiter middleware.
 * Suitable for single-instance deployments.
 *
 * @param {{ windowMs?: number, max?: number, message?: string }} opts
 */
export function rateLimit({ windowMs = 60_000, max = 10, message = 'Muitas tentativas. Tente novamente mais tarde.' } = {}) {
  const hits = new Map() // ip -> { count, resetAt }

  // Periodically clean expired entries to avoid memory leak
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, val] of hits) {
      if (now > val.resetAt) hits.delete(key)
    }
  }, windowMs * 2)
  cleanupInterval.unref?.() // don't keep process alive for cleanup

  return (req, res, next) => {
    const key = req.ip || req.connection?.remoteAddress || 'unknown'
    const now = Date.now()
    let entry = hits.get(key)

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      hits.set(key, entry)
    }

    entry.count++

    // Set standard rate limit headers
    res.set('X-RateLimit-Limit', String(max))
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)))

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({ message })
    }

    next()
  }
}
