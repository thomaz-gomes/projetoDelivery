import express from 'express'
import multer from 'multer'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { authMiddleware, requireRole } from '../auth.js'
import { prisma } from '../prisma.js'
import {
  validateAnnouncementInput,
  sanitizeAnnouncementInput,
} from '../services/menuAnnouncementService.js'

const router = express.Router()

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'announcements')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) cb(null, true)
    else cb(new Error('unsupported mime'), false)
  },
})

// Wrap multer single() so size/mime errors return a clean 400 instead of
// bubbling to the global error handler.
function uploadSingleSafe(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next()
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'arquivo excede 2MB' })
      }
      if (err.message === 'unsupported mime') {
        return res.status(400).json({ error: 'tipo de arquivo não suportado (use png/jpeg/webp)' })
      }
      return res.status(400).json({ error: err.message || 'upload falhou' })
    })
  }
}

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

router.post(
  '/:menuId/image',
  authMiddleware,
  requireRole('ADMIN'),
  uploadSingleSafe('file'),
  async (req, res) => {
    try {
      const { menuId } = req.params
      const companyId = req.user.companyId
      const menu = await loadMenuForCompany(menuId, companyId)
      if (!menu) return res.status(404).json({ error: 'menu not found' })
      if (!req.file) return res.status(400).json({ error: 'file required' })

      // Always save as .jpg — sharp() pipeline below converts everything to JPEG
      // regardless of input mime, so the extension must match the actual bytes.
      const filename = `${menuId}-${Date.now()}.jpg`
      const filepath = path.join(UPLOAD_DIR, filename)

      const optimized = await sharp(req.file.buffer)
        .resize({ width: 1080, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer()
      await fs.promises.writeFile(filepath, optimized)

      // remove previous image if present
      const existing = await prisma.menuAnnouncement.findUnique({
        where: { menuId },
        select: { popupImageUrl: true },
      })
      if (existing?.popupImageUrl?.startsWith('/public/uploads/announcements/')) {
        const oldPath = path.join(process.cwd(), existing.popupImageUrl.replace(/^\//, ''))
        fs.promises.unlink(oldPath).catch(() => {})
      }

      const url = `/public/uploads/announcements/${filename}`
      await prisma.menuAnnouncement.upsert({
        where: { menuId },
        create: { menuId, popupImageUrl: url },
        update: { popupImageUrl: url },
      })
      res.json({ url })
    } catch (e) {
      console.error('POST /menu-announcements/:menuId/image failed', e)
      res.status(500).json({ message: 'Erro ao enviar imagem', error: e?.message || String(e) })
    }
  }
)

router.delete(
  '/:menuId/image',
  authMiddleware,
  requireRole('ADMIN'),
  async (req, res) => {
    try {
      const { menuId } = req.params
      const companyId = req.user.companyId
      const menu = await loadMenuForCompany(menuId, companyId)
      if (!menu) return res.status(404).json({ error: 'menu not found' })

      const existing = await prisma.menuAnnouncement.findUnique({
        where: { menuId },
        select: { popupImageUrl: true },
      })
      // No announcement row yet → nothing to delete; idempotent success.
      if (!existing) return res.json({ ok: true })

      if (existing.popupImageUrl?.startsWith('/public/uploads/announcements/')) {
        const oldPath = path.join(process.cwd(), existing.popupImageUrl.replace(/^\//, ''))
        fs.promises.unlink(oldPath).catch(() => {})
      }
      await prisma.menuAnnouncement.update({
        where: { menuId },
        data: { popupImageUrl: null },
      })
      res.json({ ok: true })
    } catch (e) {
      console.error('DELETE /menu-announcements/:menuId/image failed', e)
      res.status(500).json({ message: 'Erro ao remover imagem', error: e?.message || String(e) })
    }
  }
)

export default router
