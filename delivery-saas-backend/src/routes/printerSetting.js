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
    let { companyId, storeId, interface: iface, type, width,
          receiptTemplate, copies, printerName,
          fiscalPrinterName, fiscalPrinterType } = req.body || {}
    if (!companyId && storeId) {
      const store = await prisma.store.findUnique({ where: { id: storeId }, select: { companyId: true } })
      if (!store) return res.status(404).json({ ok: false, message: 'store not found' })
      companyId = store.companyId
    }
    if (!companyId) return res.status(400).json({ ok: false, message: 'companyId or storeId required' })

    // Only update fields that were explicitly provided in the request body
    const body = req.body || {}
    const data = {}
    if (body.interface !== undefined) data.interface = iface ? String(iface).replace(/^\s*printer:\s*/i, '').trim() || null : null
    if (body.type !== undefined) data.type = type || null
    if (body.width !== undefined) data.width = width ?? null
    if (receiptTemplate !== undefined) data.receiptTemplate = receiptTemplate === null ? null : String(receiptTemplate)
    if (copies !== undefined) data.copies = Math.max(1, Math.min(10, Number(copies) || 1))
    if (printerName !== undefined) data.printerName = printerName === null ? null : String(printerName)
    if (fiscalPrinterName !== undefined) data.fiscalPrinterName = fiscalPrinterName ? String(fiscalPrinterName) : null
    if (fiscalPrinterType !== undefined) data.fiscalPrinterType = fiscalPrinterType ? String(fiscalPrinterType) : null

    const existing = await prisma.printerSetting.findUnique({ where: { companyId } })
    if (existing) {
      const updated = await prisma.printerSetting.update({ where: { companyId }, data })
      return res.json({ ok: true, updated })
    }

    const created = await prisma.printerSetting.create({ data: Object.assign({ companyId }, data) })
    return res.json({ ok: true, created })
  } catch (e) {
    console.error('POST /settings/printer-setting failed', e)
    return res.status(500).json({ ok: false, error: String(e && e.message) })
  }
})

export default router
