import express from 'express'
import { authMiddleware, requireRole } from '../auth.js'
import { prisma } from '../prisma.js'
import {
  validateAnnouncementInput,
  sanitizeAnnouncementInput,
} from '../services/menuAnnouncementService.js'

const router = express.Router()

async function loadMenuForCompany(menuId, companyId) {
  // companyId may be null for SUPER_ADMIN; in that case skip the company scope
  const where = companyId ? { id: menuId, store: { companyId } } : { id: menuId }
  const menu = await prisma.menu.findFirst({
    where,
    select: { id: true },
  })
  return menu
}

router.get('/:menuId', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { menuId } = req.params
    const companyId = req.user.companyId
    const menu = await loadMenuForCompany(menuId, companyId)
    if (!menu) return res.status(404).json({ error: 'menu not found' })
    const row = await prisma.menuAnnouncement.findUnique({ where: { menuId } })
    res.json(row || null)
  } catch (e) {
    console.error('GET /menu-announcements/:menuId failed', e)
    res.status(500).json({ message: 'Erro ao carregar anúncios', error: e?.message || String(e) })
  }
})

router.put('/:menuId', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { menuId } = req.params
    const companyId = req.user.companyId
    const menu = await loadMenuForCompany(menuId, companyId)
    if (!menu) return res.status(404).json({ error: 'menu not found' })

    const sanitized = sanitizeAnnouncementInput(req.body || {})
    const v = validateAnnouncementInput(sanitized)
    if (!v.ok) return res.status(400).json({ error: v.error })

    const allowed = [
      'popupEnabled', 'popupTitle', 'popupMessage', 'popupButtonText',
      'popupCtaUrl', 'popupCtaLabel', 'popupImageUrl',
      'bannerEnabled', 'bannerText', 'bannerBgColor',
    ]
    const data = {}
    for (const k of allowed) if (k in sanitized) data[k] = sanitized[k]

    const row = await prisma.menuAnnouncement.upsert({
      where: { menuId },
      create: { menuId, ...data },
      update: data,
    })
    res.json(row)
  } catch (e) {
    console.error('PUT /menu-announcements/:menuId failed', e)
    res.status(500).json({ message: 'Erro ao salvar anúncios', error: e?.message || String(e) })
  }
})

export default router
