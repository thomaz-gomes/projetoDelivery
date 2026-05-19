import { Router } from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { optimizeForWeb } from '../utils/imageOptimizer.js'

const router = Router()
router.use(authMiddleware)

const MAX_SIZE = 2 * 1024 * 1024

// Magic bytes for allowed image formats
const MAGIC_BYTES = {
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png':  [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  'image/gif':  [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
  'image/webp': [Buffer.from('RIFF')], // RIFF header (WebP starts with RIFF????WEBP)
}

function detectImageType(buf) {
  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    for (const sig of signatures) {
      if (buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig)) {
        // Extra check for WebP: bytes 8-11 must be 'WEBP'
        if (mime === 'image/webp' && buf.toString('ascii', 8, 12) !== 'WEBP') continue
        return mime
      }
    }
  }
  return null
}

// GET /media — list media for the company (paginated)
router.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const userId = req.user.id
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 24))
    const skip = (page - 1) * pageSize
    const [items, total] = await Promise.all([
      prisma.media.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          feedbacks: {
            where: { userId },
            select: { id: true, reason: true, note: true, createdAt: true },
          },
        },
      }),
      prisma.media.count({ where: { companyId } }),
    ])
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    res.json({ items, total, page, pageSize, totalPages })
  } catch (e) {
    console.error('GET /media failed', e)
    res.status(500).json({ message: 'Erro ao listar mídia' })
  }
})

// GET /media/:id/download — stream the image with Content-Disposition: attachment
router.get('/:id/download', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const media = await prisma.media.findFirst({ where: { id: req.params.id, companyId } })
    if (!media) return res.status(404).json({ message: 'Mídia não encontrada' })
    const filePath = path.join(process.cwd(), media.url.replace(/^\//, ''))
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Arquivo não encontrado' })
    const baseName = (media.filename || `image-${media.id}`).replace(/[^\w.\-]+/g, '_')
    const ext = path.extname(filePath) || '.webp'
    const downloadName = baseName.endsWith(ext) ? baseName : `${baseName}${ext}`
    res.setHeader('Content-Type', media.mimeType || 'image/webp')
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`)
    fs.createReadStream(filePath).pipe(res)
  } catch (e) {
    console.error('GET /media/:id/download failed', e)
    res.status(500).json({ message: 'Erro ao baixar mídia' })
  }
})

// POST /media — upload a new image (base64)
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { fileBase64, filename } = req.body || {}

    if (!fileBase64) return res.status(400).json({ message: 'fileBase64 é obrigatório' })

    const raw = String(fileBase64)
    const m = raw.match(/^data:(.*?);base64,(.*)$/)
    const base64Data = m ? m[2] : raw
    const buf = Buffer.from(base64Data, 'base64')

    if (buf.length > MAX_SIZE) {
      return res.status(400).json({ message: `Arquivo muito grande (${(buf.length / 1024 / 1024).toFixed(1)} MB). Máximo: 2 MB.` })
    }

    // Validate actual file content via magic bytes (not user-declared MIME type)
    const detectedType = detectImageType(buf)
    if (!detectedType) {
      return res.status(400).json({ message: 'Conteúdo do arquivo não é uma imagem válida. Use JPG, PNG, GIF ou WebP.' })
    }

    const id = randomUUID()

    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })

    const { optimized, thumbnail } = await optimizeForWeb(buf)
    const webpName = `${id}.webp`
    const thumbName = `${id}_thumb.webp`
    await Promise.all([
      fs.promises.writeFile(path.join(dir, webpName), optimized),
      fs.promises.writeFile(path.join(dir, thumbName), thumbnail),
    ])

    const url = `/public/uploads/media/${companyId}/${webpName}`

    const media = await prisma.media.create({
      data: {
        id,
        companyId,
        filename: filename || webpName,
        mimeType: 'image/webp',
        size: optimized.length,
        url
      }
    })

    res.status(201).json(media)
  } catch (e) {
    console.error('POST /media failed', e)
    res.status(500).json({ message: 'Erro ao fazer upload', error: e?.message || String(e) })
  }
})

// DELETE /media/:id
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const media = await prisma.media.findFirst({ where: { id: req.params.id, companyId } })
    if (!media) return res.status(404).json({ message: 'Mídia não encontrada' })

    // remove file from disk
    try {
      const filePath = path.join(process.cwd(), media.url.replace(/^\//, ''))
      if (fs.existsSync(filePath)) await fs.promises.unlink(filePath)
    } catch (e) { /* non-fatal */ }

    await prisma.media.delete({ where: { id: media.id } })
    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /media failed', e)
    res.status(500).json({ message: 'Erro ao remover mídia' })
  }
})

const VALID_REASONS = ['LIKED', 'FOOD_DEFORMED', 'SCENE_REPETITIVE', 'OFF_BRAND', 'WRONG_COLOR', 'OTHER']

router.post('/:id/feedback', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const userId = req.user.id
  const { id } = req.params
  const { reason, note } = req.body || {}

  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ message: 'Razão inválida' })
  }
  if (reason === 'OTHER' && (!note || !String(note).trim())) {
    return res.status(400).json({ message: 'Observação é obrigatória quando o motivo é "Outro"' })
  }

  const media = await prisma.media.findFirst({ where: { id, companyId } })
  if (!media) return res.status(404).json({ message: 'Imagem não encontrada' })

  try {
    const created = await prisma.mediaFeedback.create({
      data: { mediaId: id, userId, reason, note: note ? String(note).slice(0, 500) : null },
    })
    res.status(201).json(created)
  } catch (e) {
    if (e?.code === 'P2002') {
      return res.status(409).json({ message: 'Você já marcou este motivo nesta imagem' })
    }
    console.error('[media/feedback] POST error:', e?.message || e)
    res.status(500).json({ message: e?.message || 'Falha ao salvar feedback' })
  }
})

router.delete('/:id/feedback/:feedbackId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const userId = req.user.id
  const { id, feedbackId } = req.params
  const fb = await prisma.mediaFeedback.findFirst({
    where: { id: feedbackId, mediaId: id, userId, media: { companyId } },
  })
  if (!fb) return res.status(404).json({ message: 'Feedback não encontrado' })
  await prisma.mediaFeedback.delete({ where: { id: feedbackId } })
  res.status(204).end()
})

router.get('/:id/feedbacks', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const media = await prisma.media.findFirst({ where: { id, companyId } })
  if (!media) return res.status(404).json({ message: 'Imagem não encontrada' })
  const rows = await prisma.mediaFeedback.findMany({
    where: { mediaId: id },
    orderBy: { createdAt: 'desc' },
  })
  res.json(rows)
})

export default router
