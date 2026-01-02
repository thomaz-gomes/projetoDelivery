import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import fs from 'fs'
import path from 'path'

const router = express.Router()
router.use(authMiddleware)

// GET /menu/options - list option groups with options
router.get('/', async (req, res) => {
  const companyId = req.user.companyId
  try {
    const rows = await prisma.optionGroup.findMany({ where: { companyId }, orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' }, include: { linkedProduct: { select: { id: true, name: true, isActive: true } } } } } })
    res.json(rows)
  } catch (e) {
    console.error('Error loading option groups', e)
    res.status(500).json({ message: 'Erro ao carregar grupos de opções' })
  }
})

// GET /menu/options/:id - fetch single option group (with options)
router.get('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  try {
    const group = await prisma.optionGroup.findFirst({ where: { id, companyId }, include: { options: { orderBy: { position: 'asc' } } } })
    if (!group) return res.status(404).json({ message: 'Grupo não encontrado' })
    return res.json(group)
  } catch (e) {
    console.error('Error loading option group', e)
    return res.status(500).json({ message: 'Erro ao carregar grupo de opções' })
  }
})

// POST /menu/options - create group
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { name, min = 0, max = null, position = 0, isActive = true } = req.body || {}
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' })
  try {
    const created = await prisma.optionGroup.create({ data: { companyId, name, min: Number(min || 0), max: max !== null ? Number(max) : null, position: Number(position || 0), isActive: Boolean(isActive) } })
    res.status(201).json(created)
  } catch (e) {
    console.error('Error creating option group', e)
    res.status(500).json({ message: 'Erro ao criar grupo' })
  }
})

// PATCH /menu/options/:id
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.optionGroup.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Grupo não encontrado' })
  const { name, min, max, position, isActive } = req.body || {}
  try {
    const updated = await prisma.optionGroup.update({ where: { id }, data: { name: name ?? existing.name, min: min !== undefined ? Number(min) : existing.min, max: max !== undefined ? (max === null ? null : Number(max)) : existing.max, position: position !== undefined ? Number(position) : existing.position, isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive } })
    res.json(updated)
  } catch (e) {
    console.error('Error updating option group', e)
    res.status(500).json({ message: 'Erro ao atualizar grupo' })
  }
})

// DELETE /menu/options/:id
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.optionGroup.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Grupo não encontrado' })
  try {
    // load related options so we can clean up any stored image files safely
    const relatedOptions = await prisma.option.findMany({ where: { groupId: id } })
    // attempt best-effort file cleanup for option images stored under our uploads folder
    for (const opt of relatedOptions) {
      try {
        if (opt && opt.image && typeof opt.image === 'string' && opt.image.includes('/public/uploads/options/')) {
          const filename = path.basename(opt.image)
          const filePath = path.join(process.cwd(), 'public', 'uploads', 'options', filename)
          try {
            if (fs.existsSync(filePath)) {
              await fs.promises.unlink(filePath)
            }
          } catch (unlinkErr) {
            // non-fatal: log and continue
            console.warn('Failed to remove option image file during group delete:', filePath, unlinkErr)
          }
        }
      } catch (inner) {
        console.warn('Error while attempting to cleanup option image for group delete', inner)
      }
    }

    // perform DB deletes in a transaction for atomicity
    // also remove any Product<->OptionGroup associations to avoid FK violations
    await prisma.$transaction([
      prisma.productOptionGroup.deleteMany({ where: { groupId: id } }),
      prisma.option.deleteMany({ where: { groupId: id } }),
      prisma.optionGroup.delete({ where: { id } })
    ])
    res.json({ message: 'Removido' })
  } catch (e) {
    console.error('Error deleting option group', e)
    // return a clearer message to the frontend to aid debugging while avoiding stack leakage
    const msg = (e && (e.message || (e.response && e.response.data && e.response.data.message))) || 'Erro ao remover grupo'
    res.status(500).json({ message: String(msg) })
  }
})

// ------- Options CRUD (nested under groups) -------
// POST /menu/options/:groupId/options
// Supports linking an Option to an existing Product via `linkedProductId`.
// When `linkedProductId` is provided, availability fields are ignored and
// availability is derived from the linked product instead.
router.post('/:groupId/options', requireRole('ADMIN'), async (req, res) => {
  const { groupId } = req.params
  const companyId = req.user.companyId
  const group = await prisma.optionGroup.findFirst({ where: { id: groupId, companyId } })
  if (!group) return res.status(404).json({ message: 'Grupo não encontrado' })
  const { name, price = 0, image = null, position = 0, availableDays = null, availableFrom = null, availableTo = null, isAvailable = true, linkedProductId = null, technicalSheetId = null } = req.body || {}
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' })
  try {
    const data = { groupId, name, price: Number(price || 0), image: image ?? null, position: Number(position || 0) }
    // validate and attach technicalSheetId when provided
    if (technicalSheetId) {
      const ts = await prisma.technicalSheet.findUnique({ where: { id: technicalSheetId } })
      if (!ts || ts.companyId !== companyId) return res.status(400).json({ message: 'technicalSheetId inválido' })
      data.technicalSheetId = technicalSheetId
    }
    // If this option links to a product, record the relation and DO NOT accept availability fields
    if (linkedProductId) {
      data.linkedProductId = linkedProductId
    } else {
      data.isAvailable = Boolean(isAvailable)
      // include availability fields when provided
      if (availableDays !== undefined) data.availableDays = availableDays === null ? null : availableDays
      if (availableFrom !== undefined) data.availableFrom = availableFrom === null ? null : availableFrom
      if (availableTo !== undefined) data.availableTo = availableTo === null ? null : availableTo
    }

    try {
      const created = await prisma.option.create({ data })
      return res.status(201).json(created)
    } catch (innerErr) {
      // If Prisma complains about unknown args (schema mismatch), retry without availability fields
      const msg = String(innerErr?.message || innerErr)
      if (/Unknown arg|Unknown argument|Unknown field/i.test(msg)) {
        // Retry without availability fields and isAvailable in case schema is older
        const fallbackData = { groupId, name, price: Number(price || 0), image: image ?? null, position: Number(position || 0) }
        if (linkedProductId) fallbackData.linkedProductId = linkedProductId
        const created = await prisma.option.create({ data: fallbackData })
        return res.status(201).json(created)
      }
      throw innerErr
    }
  } catch (e) {
    console.error('Error creating option', e)
    res.status(500).json({ message: e?.message || 'Erro ao criar opção' })
  }
})

// PATCH /menu/options/options/:id
router.patch('/options/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const existing = await prisma.option.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ message: 'Opção não encontrada' })
  const { name, price, image, position, availableDays, availableFrom, availableTo, isAvailable, linkedProductId, technicalSheetId } = req.body || {}
  try {
    const data = {}
    // validate and attach technicalSheetId when provided
    if (technicalSheetId !== undefined) {
      if (technicalSheetId === null) {
        data.technicalSheetId = null
      } else {
        const ts = await prisma.technicalSheet.findUnique({ where: { id: technicalSheetId } })
        if (!ts || ts.companyId !== existing.group.companyId) return res.status(400).json({ message: 'technicalSheetId inválido' })
        data.technicalSheetId = technicalSheetId
      }
    }
    if (name !== undefined) data.name = name
    if (price !== undefined) data.price = Number(price)
    if (image !== undefined) data.image = image
    if (position !== undefined) data.position = Number(position)
    // If linkedProductId is provided, record it and ignore availability fields
    if (linkedProductId !== undefined) {
      data.linkedProductId = linkedProductId || null
    } else {
      if (isAvailable !== undefined) data.isAvailable = Boolean(isAvailable)
      if (availableDays !== undefined) data.availableDays = availableDays
      if (availableFrom !== undefined) data.availableFrom = availableFrom
      if (availableTo !== undefined) data.availableTo = availableTo
    }

    try {
      const updated = await prisma.option.update({ where: { id }, data: { ...data } })
      return res.json(updated)
    } catch (innerErr) {
      const msg = String(innerErr?.message || innerErr)
      if (/Unknown arg|Unknown argument|Unknown field/i.test(msg)) {
        // retry without availability fields and isAvailable in case schema is older
        const { availableDays: _ad, availableFrom: _af, availableTo: _at, isAvailable: _ia, ...fallback } = data
        const updated = await prisma.option.update({ where: { id }, data: fallback })
        return res.json(updated)
      }
      throw innerErr
    }
  } catch (e) {
    console.error('Error updating option', e)
    res.status(500).json({ message: e?.message || 'Erro ao atualizar opção' })
  }
})

// GET /menu/options/options/:id -> return single option (scoped to company via group)
router.get('/options/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  try {
    const opt = await prisma.option.findUnique({ where: { id }, include: { group: true, linkedProduct: { select: { id: true, name: true, isActive: true } } } })
    if (!opt || !opt.group || opt.group.companyId !== companyId) return res.status(404).json({ message: 'Opção não encontrada' })
    // strip group relation from response to avoid leaking internal group info
    const { group, ...rest } = opt
    return res.json(rest)
  } catch (e) {
    console.error('Error fetching option', e)
    res.status(500).json({ message: 'Erro ao carregar opção' })
  }
})

// DELETE /menu/options/options/:id
router.delete('/options/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  // ensure the option belongs to this company via its group
  const existing = await prisma.option.findUnique({ where: { id }, include: { group: true } })
  if (!existing || !existing.group || existing.group.companyId !== companyId) return res.status(404).json({ message: 'Opção não encontrada' })
  try {
    // attempt to remove stored image file if it exists under our uploads folder
    try {
      if (existing.image && typeof existing.image === 'string' && existing.image.includes('/public/uploads/options/')) {
        const filename = path.basename(existing.image)
        const filePath = path.join(process.cwd(), 'public', 'uploads', 'options', filename)
        try {
          if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath)
          }
        } catch (unlinkErr) {
          console.warn('Failed to remove option image file during delete:', filePath, unlinkErr)
        }
      }
    } catch (e) {
      console.warn('Error while cleaning option image file:', e)
    }

    await prisma.option.delete({ where: { id } })
    res.json({ message: 'Removida' })
  } catch (e) {
    console.error('Error deleting option', e)
    res.status(500).json({ message: 'Erro ao remover opção' })
  }
})

// Upload option image via base64 payload
router.post('/options/:id/image', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const { imageBase64, filename } = req.body || {}
  if (!imageBase64) return res.status(400).json({ message: 'imageBase64 is required' })
  // ensure the option belongs to this company via its group
  const existing = await prisma.option.findUnique({ where: { id }, include: { group: true } })
  if (!existing || !existing.group || existing.group.companyId !== companyId) return res.status(404).json({ message: 'Opção não encontrada' })

  try {
    const matches = imageBase64.match(/^data:(image\/[^;]+);base64,(.+)$/)
    let ext = 'jpg'
    let data = imageBase64
    if (matches) {
      const mime = matches[1]
      data = matches[2]
      ext = (mime.split('/')[1] || 'jpg').toLowerCase()
      if (ext === 'jpeg') ext = 'jpg'
      if (ext.includes('+')) ext = ext.split('+')[0]
    }
    const buffer = Buffer.from(data, 'base64')
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'options')
    try { await fs.promises.mkdir(uploadsDir, { recursive: true }) } catch (e) { console.error('Failed to create uploads dir', uploadsDir, e); return res.status(500).json({ message: 'Falha ao criar pasta de uploads', error: e?.message || String(e) }) }

    const outName = `${id}.${ext}`
    const outPath = path.join(uploadsDir, outName)
    // remove any previous files for this option id (avoid orphaned files with different extensions)
    try {
      const files = await fs.promises.readdir(uploadsDir)
      for (const f of files) {
        if (f.startsWith(`${id}.`) && f !== outName) {
          try { await fs.promises.unlink(path.join(uploadsDir, f)) } catch (er) { /* ignore unlink errors */ }
        }
      }
    } catch (e) {
      // ignore readdir errors
    }
    try { await fs.promises.writeFile(outPath, buffer) } catch (e) { console.error('Failed to write option image file:', outPath, e); return res.status(500).json({ message: 'Falha ao salvar arquivo de imagem', error: e?.message || String(e) }) }

    const publicUrl = `${req.protocol}://${req.get('host')}/public/uploads/options/${outName}`
    try {
      const updated = await prisma.option.update({ where: { id }, data: { image: publicUrl } })
      return res.json(updated)
    } catch (e) {
      console.error('Failed to update option image field in DB for id', id, e)
      try { await fs.promises.unlink(outPath) } catch (err) { /* ignore */ }
      return res.status(500).json({ message: 'Falha ao atualizar opção com imagem', error: e?.message || String(e) })
    }
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Falha ao salvar imagem', error: e.message })
  }
})

export default router
