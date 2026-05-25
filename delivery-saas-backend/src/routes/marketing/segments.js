import express from 'express'
import { prisma } from '../../prisma.js'
import { authMiddleware, requireRole } from '../../auth.js'
import { requireModuleStrict } from '../../modules.js'
import { validateSegmentRule } from '../../services/marketing/segmentValidator.js'
import { previewSegment } from '../../services/marketing/segmentEvaluator.js'

const router = express.Router()
router.use(authMiddleware)
router.use(requireModuleStrict('MARKETING_CAMPAIGNS'))

// List active segments for the company
router.get('/', async (req, res) => {
  const { companyId } = req.user
  try {
    const rows = await prisma.marketingSegment.findMany({
      where: { companyId, active: true },
      orderBy: { createdAt: 'desc' },
    })
    return res.json(rows)
  } catch (e) {
    console.error('Failed to list segments:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao listar segmentos' })
  }
})

// Preview a segment without persisting it (must come before /:id to avoid route shadowing)
router.post('/preview', async (req, res) => {
  const { companyId } = req.user
  const { ruleJson } = req.body || {}
  if (!ruleJson || typeof ruleJson !== 'object' || !ruleJson.rule) {
    return res.status(400).json({ message: 'ruleJson.rule é obrigatório' })
  }
  const v = validateSegmentRule(ruleJson.rule)
  if (!v.ok) {
    return res.status(400).json({ message: `Regra inválida: ${v.error}` })
  }
  try {
    const result = await previewSegment({ companyId, ruleJson })
    return res.json(result)
  } catch (e) {
    console.error('Failed to preview segment:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao avaliar segmento', error: String(e?.message || e) })
  }
})

// Get a single segment by id (scoped to company)
router.get('/:id', async (req, res) => {
  const { companyId } = req.user
  const { id } = req.params
  const seg = await prisma.marketingSegment.findFirst({ where: { id, companyId } })
  if (!seg) return res.status(404).json({ message: 'Segmento não encontrado' })
  return res.json(seg)
})

// Create a new segment
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const { companyId } = req.user
  const { name, description, ruleJson } = req.body || {}
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'Nome é obrigatório' })
  }
  if (!ruleJson || typeof ruleJson !== 'object' || !ruleJson.rule) {
    return res.status(400).json({ message: 'ruleJson.rule é obrigatório' })
  }
  const v = validateSegmentRule(ruleJson.rule)
  if (!v.ok) {
    return res.status(400).json({ message: `Regra inválida: ${v.error}` })
  }
  try {
    const seg = await prisma.marketingSegment.create({
      data: {
        companyId,
        name: name.trim(),
        description: description || null,
        ruleJson,
        active: true,
      },
    })
    return res.status(201).json(seg)
  } catch (e) {
    if (e && e.code === 'P2002') {
      return res.status(409).json({ message: 'Já existe segmento com este nome' })
    }
    console.error('Failed to create segment:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao criar segmento' })
  }
})

// Update an existing segment
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { companyId } = req.user
  const { id } = req.params
  const existing = await prisma.marketingSegment.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Segmento não encontrado' })

  const { name, description, ruleJson, active } = req.body || {}
  const data = {}
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Nome inválido' })
    }
    data.name = name.trim()
  }
  if (description !== undefined) data.description = description || null
  if (active !== undefined) data.active = !!active
  if (ruleJson !== undefined) {
    if (!ruleJson || typeof ruleJson !== 'object' || !ruleJson.rule) {
      return res.status(400).json({ message: 'ruleJson.rule é obrigatório' })
    }
    const v = validateSegmentRule(ruleJson.rule)
    if (!v.ok) {
      return res.status(400).json({ message: `Regra inválida: ${v.error}` })
    }
    data.ruleJson = ruleJson
  }

  try {
    const updated = await prisma.marketingSegment.update({
      where: { id },
      data,
    })
    return res.json(updated)
  } catch (e) {
    if (e && e.code === 'P2002') {
      return res.status(409).json({ message: 'Já existe segmento com este nome' })
    }
    console.error('Failed to update segment:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao atualizar segmento' })
  }
})

// Soft delete a segment (active = false). NEVER hard-delete to preserve campaign history.
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { companyId } = req.user
  const { id } = req.params
  const existing = await prisma.marketingSegment.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Segmento não encontrado' })
  try {
    await prisma.marketingSegment.update({
      where: { id },
      data: { active: false },
    })
    return res.json({ ok: true })
  } catch (e) {
    console.error('Failed to soft-delete segment:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao remover segmento' })
  }
})

export default router
