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

// GET /media — list media for the company
router.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const items = await prisma.media.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 100
    })
    res.json(items)
  } catch (e) {
    console.error('GET /media failed', e)
    res.status(500).json({ message: 'Erro ao listar mídia' })
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

export default router
