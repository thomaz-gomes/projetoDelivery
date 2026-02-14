import { Router } from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'

const router = Router()
router.use(authMiddleware)

const MAX_SIZE = 2 * 1024 * 1024

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
    const mimeType = m ? m[1] : 'image/jpeg'
    const base64Data = m ? m[2] : raw
    const buf = Buffer.from(base64Data, 'base64')

    if (buf.length > MAX_SIZE) {
      return res.status(400).json({ message: `Arquivo muito grande (${(buf.length / 1024 / 1024).toFixed(1)} MB). Máximo: 2 MB.` })
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({ message: 'Formato inválido. Use JPG, PNG, GIF ou WebP.' })
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? '.jpg' : `.${mimeType.split('/')[1]}`
    const id = randomUUID()
    const safeName = `${id}${ext}`

    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, safeName)
    await fs.promises.writeFile(filePath, buf)

    const url = `/public/uploads/media/${companyId}/${safeName}`

    const media = await prisma.media.create({
      data: {
        id,
        companyId,
        filename: filename || safeName,
        mimeType,
        size: buf.length,
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
