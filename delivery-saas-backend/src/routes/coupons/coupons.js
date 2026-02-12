import express from 'express'
import { prisma } from '../../prisma.js'
import { authMiddleware, requireRole } from '../../auth.js'

export const couponsRouter = express.Router()

couponsRouter.use(authMiddleware)

// GET /coupons - list coupons for company
couponsRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId
  // Supported query params: active, affiliateId, code (partial), isPercentage
  const { active, affiliateId, code, isPercentage } = req.query

  try {
    const where = { companyId }

    if (active !== undefined) {
      const activeBool = String(active).toLowerCase() === 'true'
      where.isActive = activeBool
    }

    if (affiliateId) {
      where.affiliateId = affiliateId
    }

    if (code) {
      where.code = { contains: code }
    }

    if (isPercentage !== undefined) {
      const p = String(isPercentage).toLowerCase() === 'true'
      where.isPercentage = p
    }

    // pagination
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0

    const [total, coupons] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.findMany({
        where,
        include: { affiliate: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      })
    ])

    res.json({ data: coupons, total, limit, offset })
  } catch (e) {
    console.error('Error fetching coupons', e)
    res.status(500).json({ message: 'Erro ao buscar cupons' })
  }
})

// GET /coupons/:id
couponsRouter.get('/:id', async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  try {
    const coupon = await prisma.coupon.findFirst({ where: { id, companyId }, include: { affiliate: true } })
    if (!coupon) return res.status(404).json({ message: 'Cupom não encontrado' })
    res.json(coupon)
  } catch (e) {
    console.error('Error fetching coupon', e)
    res.status(500).json({ message: 'Erro ao buscar cupom' })
  }
})

// POST /coupons - create (admin)
couponsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { code, description, isPercentage, value, affiliateId, isActive, expiresAt, maxUses, maxUsesPerCustomer, minSubtotal } = req.body

  if (!code) return res.status(400).json({ message: 'Código é obrigatório' })

  try {
    // if affiliateId provided, verify belongs to company
    if (affiliateId) {
      const af = await prisma.affiliate.findFirst({ where: { id: affiliateId, companyId } })
      if (!af) return res.status(400).json({ message: 'Afiliado inválido' })
    }

    const coupon = await prisma.coupon.create({
      data: {
        companyId,
        code,
        description: description || null,
        isPercentage: isPercentage !== undefined ? isPercentage : true,
        value: value !== undefined ? value : 0,
        affiliateId: affiliateId || null,
        isActive: isActive !== undefined ? isActive : true,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        maxUses: maxUses !== undefined ? (Number.isFinite(Number(maxUses)) ? Number(maxUses) : null) : null,
        maxUsesPerCustomer: maxUsesPerCustomer !== undefined ? (Number.isFinite(Number(maxUsesPerCustomer)) ? Number(maxUsesPerCustomer) : null) : null,
        minSubtotal: minSubtotal !== undefined && minSubtotal !== null ? Number(minSubtotal) : null
      }
    })

    res.status(201).json(coupon)
  } catch (e) {
    console.error('Error creating coupon', e)
    if (e.code === 'P2002') return res.status(400).json({ message: 'Código do cupom já existe' })
    res.status(500).json({ message: 'Erro ao criar cupom' })
  }
})

// PUT /coupons/:id - update (admin)
couponsRouter.put('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const { code, description, isPercentage, value, affiliateId, isActive, expiresAt, maxUses, maxUsesPerCustomer, minSubtotal } = req.body

  try {
    const existing = await prisma.coupon.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Cupom não encontrado' })

    if (affiliateId) {
      const af = await prisma.affiliate.findFirst({ where: { id: affiliateId, companyId } })
      if (!af) return res.status(400).json({ message: 'Afiliado inválido' })
    }

    const updated = await prisma.coupon.update({
      where: { id },
      data: {
        code: code || undefined,
        description: description === '' ? null : description,
        isPercentage: isPercentage !== undefined ? isPercentage : undefined,
        value: value !== undefined ? value : undefined,
        affiliateId: affiliateId === null ? null : affiliateId || undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        expiresAt: expiresAt !== undefined ? (expiresAt ? new Date(expiresAt) : null) : undefined,
        maxUses: maxUses !== undefined ? (Number.isFinite(Number(maxUses)) ? Number(maxUses) : null) : undefined,
        maxUsesPerCustomer: maxUsesPerCustomer !== undefined ? (Number.isFinite(Number(maxUsesPerCustomer)) ? Number(maxUsesPerCustomer) : null) : undefined,
        minSubtotal: minSubtotal !== undefined ? (minSubtotal !== null ? Number(minSubtotal) : null) : undefined
      }
    })

    res.json(updated)
  } catch (e) {
    console.error('Error updating coupon', e)
    if (e.code === 'P2002') return res.status(400).json({ message: 'Código do cupom já existe' })
    res.status(500).json({ message: 'Erro ao atualizar cupom' })
  }
})

// DELETE /coupons/:id - delete (admin)
couponsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  try {
    const existing = await prisma.coupon.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Cupom não encontrado' })
    await prisma.coupon.delete({ where: { id } })
    res.json({ success: true })
  } catch (e) {
    console.error('Error deleting coupon', e)
    res.status(500).json({ message: 'Erro ao excluir cupom' })
  }
})
