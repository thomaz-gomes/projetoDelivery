import jwt from 'jsonwebtoken'
import { prisma } from '../prisma.js'
import { normalizePhone } from '../services/customers.js'
const JWT_SECRET = process.env.JWT_SECRET

export async function resolvePublicCustomerFromReq(req, companyId) {
  // 1) try Authorization Bearer token (may be issued for customer accounts)
  try {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET)
        // if token refers to a customerId (issued by public flows), load it
        if (payload && payload.customerId) {
          const c = await prisma.customer.findFirst({ where: { id: payload.customerId, companyId } })
          if (c) return c
        }
      } catch (_) { /* ignore invalid token */ }
    }
  } catch (e) { /* ignore */ }

  // 2) try cookie 'public_phone' or header 'x-public-phone'
  try {
    let phoneRaw = null
    // header override (useful for proxied requests)
    if (req.headers['x-public-phone']) phoneRaw = req.headers['x-public-phone']
    // cookie parsing (simple)
    if (!phoneRaw && req.headers && req.headers.cookie) {
      const parts = String(req.headers.cookie).split(';').map(s=>s.trim())
      for (const p of parts) {
        if (p.startsWith('public_phone=')) { phoneRaw = decodeURIComponent(p.split('=')[1] || '') ; break }
      }
    }
    if (phoneRaw) {
      const phone = normalizePhone(phoneRaw)
      if (phone) {
        const c = await prisma.customer.findFirst({ where: { companyId, OR: [{ whatsapp: phone }, { phone: phone }] } })
        if (c) return c
      }
    }
  } catch (e) { /* ignore */ }

  // no public customer resolved
  return null
}

export default { resolvePublicCustomerFromReq }
