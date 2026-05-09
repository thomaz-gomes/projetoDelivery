import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import { generateProductCode, generateOptionCode } from '../utils/integrationCode.js'

const router = express.Router()
router.use(authMiddleware)

// POST /menu/integration/generate-missing
// Backfill: gera integrationCode em Products e Options que estão NULL.
// Cobre os registros antigos (criados antes da Prisma extension auto-gerar
// códigos em todo create). Para registros novos não é necessário — a extension
// garante isso na origem.
router.post('/generate-missing', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  try {
    const products = await prisma.product.findMany({
      where: { companyId, integrationCode: null },
      select: { id: true },
    })
    let productsFixed = 0
    for (const p of products) {
      try {
        const code = await generateProductCode(companyId)
        await prisma.product.update({ where: { id: p.id }, data: { integrationCode: code } })
        productsFixed++
      } catch (e) {
        console.warn('[generate-missing] product failed', p.id, e?.message)
      }
    }

    const options = await prisma.option.findMany({
      where: { integrationCode: null, group: { companyId } },
      select: { id: true, groupId: true },
    })
    let optionsFixed = 0
    for (const o of options) {
      try {
        const code = await generateOptionCode(o.groupId)
        await prisma.option.update({ where: { id: o.id }, data: { integrationCode: code } })
        optionsFixed++
      } catch (e) {
        console.warn('[generate-missing] option failed', o.id, e?.message)
      }
    }

    res.json({
      productsScanned: products.length,
      productsFixed,
      optionsScanned: options.length,
      optionsFixed,
    })
  } catch (e) {
    console.error('POST /menu/integration/generate-missing error', e)
    res.status(500).json({ message: 'Erro ao gerar códigos faltantes', error: e?.message })
  }
})

// GET /menu/integration/items?menuId=&search=
router.get('/items', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { menuId, search } = req.query

  const where = { companyId }
  if (menuId) where.menuId = menuId
  if (search) where.name = { contains: search, mode: 'insensitive' }

  try {
    const products = await prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        integrationCode: true,
        isActive: true,
        menu: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } }
      },
      orderBy: [{ menu: { name: 'asc' } }, { name: 'asc' }]
    })
    res.json(products)
  } catch (e) {
    console.error('Error listing integration items', e)
    res.status(500).json({ message: 'Erro ao listar itens' })
  }
})

// GET /menu/integration/optionals?menuId=&search=
router.get('/optionals', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { menuId, search } = req.query

  const where = { group: { companyId } }
  if (search) where.name = { contains: search, mode: 'insensitive' }

  try {
    let options = await prisma.option.findMany({
      where,
      select: {
        id: true,
        name: true,
        integrationCode: true,
        isAvailable: true,
        group: { select: { id: true, name: true } },
        linkedProductId: true
      },
      orderBy: [{ group: { name: 'asc' } }, { name: 'asc' }]
    })

    // Get all option IDs to find their associated products via ProductOptionGroup
    const groupIds = [...new Set(options.map(o => o.group.id))]

    const productOptionGroups = await prisma.productOptionGroup.findMany({
      where: {
        groupId: { in: groupIds },
        product: menuId ? { menuId } : { companyId }
      },
      select: {
        groupId: true,
        product: {
          select: { id: true, name: true, integrationCode: true }
        }
      }
    })

    // Build map of groupId -> products
    const groupProducts = {}
    for (const pog of productOptionGroups) {
      if (!groupProducts[pog.groupId]) groupProducts[pog.groupId] = []
      groupProducts[pog.groupId].push(pog.product)
    }

    // If menuId filter, only show options whose group is linked to a product in that menu
    if (menuId) {
      options = options.filter(o => groupProducts[o.group.id]?.length > 0)
    }

    const result = options.map(o => ({
      ...o,
      associatedProducts: (groupProducts[o.group.id] || []).map(p => ({
        id: p.id,
        name: p.name,
        integrationCode: p.integrationCode,
        specificCode: p.integrationCode && o.integrationCode
          ? `${p.integrationCode}-${o.integrationCode}`
          : null
      }))
    }))

    res.json(result)
  } catch (e) {
    console.error('Error listing integration optionals', e)
    res.status(500).json({ message: 'Erro ao listar opcionais' })
  }
})

export default router
