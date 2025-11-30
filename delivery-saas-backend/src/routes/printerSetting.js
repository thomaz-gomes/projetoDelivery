import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'

const router = express.Router()
// protect endpoints: only authenticated users can read; only ADMIN can modify
router.use(authMiddleware)

// GET /settings/printer-setting?companyId=... or ?storeId=...
router.get('/', async (req, res) => {
  try {
    let companyId = req.query.companyId || null
    const storeId = req.query.storeId || null
    // If companyId not provided, default to authenticated user's company
    if (!companyId && req.user && req.user.companyId) companyId = req.user.companyId
    if (!companyId && storeId) {
      const store = await prisma.store.findUnique({ where: { id: storeId }, select: { companyId: true } })
      if (!store) return res.status(404).json({ ok: false, message: 'store not found' })
      companyId = store.companyId
    }
    if (!companyId) return res.status(400).json({ ok: false, message: 'companyId or storeId required' })

    const setting = await prisma.printerSetting.findUnique({ where: { companyId: companyId } })
    return res.json({ ok: true, setting: setting || null })
  } catch (e) {
    console.error('GET /settings/printer-setting failed', e)
    return res.status(500).json({ ok: false, error: String(e && e.message) })
  }
})

// POST /settings/printer-setting
// body: { companyId?, storeId?, interface, type?, width? }
// Note: keep POST restricted to ADMIN role
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    let { companyId, storeId, interface: iface, type, width } = req.body || {}
    if (!companyId && storeId) {
      const store = await prisma.store.findUnique({ where: { id: storeId }, select: { companyId: true } })
      if (!store) return res.status(404).json({ ok: false, message: 'store not found' })
      companyId = store.companyId
    }
    if (!companyId) return res.status(400).json({ ok: false, message: 'companyId or storeId required' })

    // sanitize interface: strip prefix 'printer:' if present
    const sanitizedInterface = iface ? String(iface).replace(/^\s*printer:\s*/i, '').trim() : null

    const existing = await prisma.printerSetting.findUnique({ where: { companyId } })
    if (existing) {
      const updated = await prisma.printerSetting.update({ where: { companyId }, data: { interface: sanitizedInterface || null, type: type || existing.type || null, width: width ?? existing.width ?? null } })
      return res.json({ ok: true, updated })
    }

    const created = await prisma.printerSetting.create({ data: { companyId, interface: sanitizedInterface || null, type: type || null, width: width ?? null } })
    return res.json({ ok: true, created })
  } catch (e) {
    console.error('POST /settings/printer-setting failed', e)
    return res.status(500).json({ ok: false, error: String(e && e.message) })
  }
})

export default router
