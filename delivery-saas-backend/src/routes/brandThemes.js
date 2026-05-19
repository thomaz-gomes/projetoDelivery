import { Router } from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'

const router = Router()
router.use(authMiddleware)

const ALLOWED_FIELDS = ['name', 'palette', 'mood', 'props', 'surface', 'lighting', 'isDefault', 'isActive', 'menuId']

function pickAllowed(body) {
  const out = {}
  for (const k of ALLOWED_FIELDS) {
    if (body[k] !== undefined) out[k] = body[k]
  }
  return out
}

function hasAnyVisualField(data) {
  return ['palette', 'mood', 'props', 'surface', 'lighting'].some(k => data[k] && String(data[k]).trim())
}

async function ensureSingleDefault(tx, companyId, themeId) {
  // Apenas 1 tema padrão por companyId entre os company-wide (menuId null).
  await tx.brandVisualTheme.updateMany({
    where: { companyId, menuId: null, isDefault: true, NOT: { id: themeId } },
    data: { isDefault: false },
  })
}

async function validateMenuBelongsToCompany(menuId, companyId) {
  // Menu pertence a uma Store, que pertence a uma Company. Subir 2 níveis.
  const menu = await prisma.menu.findFirst({
    where: { id: menuId, store: { companyId } },
    select: { id: true },
  })
  return !!menu
}

router.get('/', async (req, res) => {
  const companyId = req.user.companyId
  const rows = await prisma.brandVisualTheme.findMany({
    where: { companyId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    include: { menu: { select: { id: true, name: true } } },
  })
  res.json(rows)
})

router.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const data = pickAllowed(req.body || {})
  if (!data.name || !String(data.name).trim()) {
    return res.status(400).json({ message: 'Nome é obrigatório' })
  }
  if (!hasAnyVisualField(data)) {
    return res.status(400).json({ message: 'Preencha pelo menos um campo visual (paleta, mood, props, superfície ou iluminação)' })
  }
  if (data.menuId) {
    const ok = await validateMenuBelongsToCompany(data.menuId, companyId)
    if (!ok) return res.status(400).json({ message: 'Cardápio inválido' })
  } else {
    data.menuId = null
  }
  try {
    const created = await prisma.$transaction(async (tx) => {
      const t = await tx.brandVisualTheme.create({ data: { ...data, companyId } })
      if (data.isDefault === true && !data.menuId) {
        await ensureSingleDefault(tx, companyId, t.id)
      }
      return t
    })
    res.status(201).json(created)
  } catch (e) {
    console.error('[brand-themes] POST error:', e?.message || e)
    res.status(500).json({ message: e?.message || 'Falha ao criar tema' })
  }
})

router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const existing = await prisma.brandVisualTheme.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Tema não encontrado' })
  const data = pickAllowed(req.body || {})
  if (data.menuId) {
    const ok = await validateMenuBelongsToCompany(data.menuId, companyId)
    if (!ok) return res.status(400).json({ message: 'Cardápio inválido' })
  }
  const merged = { ...existing, ...data }
  if (!hasAnyVisualField(merged)) {
    return res.status(400).json({ message: 'Preencha pelo menos um campo visual' })
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.brandVisualTheme.update({ where: { id }, data })
      if (data.isDefault === true && u.menuId === null) {
        await ensureSingleDefault(tx, companyId, id)
      }
      return u
    })
    res.json(updated)
  } catch (e) {
    console.error('[brand-themes] PATCH error:', e?.message || e)
    res.status(500).json({ message: e?.message || 'Falha ao atualizar tema' })
  }
})

router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const existing = await prisma.brandVisualTheme.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Tema não encontrado' })
  await prisma.brandVisualTheme.delete({ where: { id } })
  res.status(204).end()
})

export default router
