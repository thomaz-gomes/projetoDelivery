import { Router } from 'express'
import { prisma } from '../../prisma.js'
import { authMiddleware, requireRole } from '../../auth.js'

const router = Router()
router.use(authMiddleware)

// GET /suppliers — list all suppliers for company
router.get('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const rows = await prisma.supplier.findMany({
    where: { companyId },
    orderBy: { name: 'asc' },
  })
  res.json(rows)
})

// POST /suppliers — create supplier
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { name, cnpj, phone, email, notes } = req.body || {}
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' })

  if (cnpj) {
    const cleanCnpj = cnpj.replace(/\D/g, '')
    const existing = await prisma.supplier.findUnique({
      where: { companyId_cnpj: { companyId, cnpj: cleanCnpj } },
    })
    if (existing) return res.status(400).json({ message: 'Fornecedor com este CNPJ já existe' })
  }

  const created = await prisma.supplier.create({
    data: {
      companyId,
      name,
      cnpj: cnpj ? cnpj.replace(/\D/g, '') : null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
    },
  })
  res.status(201).json(created)
})

// PATCH /suppliers/:id — update supplier
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.supplier.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Fornecedor não encontrado' })

  const { name, cnpj, phone, email, notes, isActive } = req.body || {}

  if (cnpj !== undefined && cnpj) {
    const cleanCnpj = cnpj.replace(/\D/g, '')
    const dup = await prisma.supplier.findUnique({
      where: { companyId_cnpj: { companyId, cnpj: cleanCnpj } },
    })
    if (dup && dup.id !== id) return res.status(400).json({ message: 'Outro fornecedor já usa este CNPJ' })
  }

  const updated = await prisma.supplier.update({
    where: { id },
    data: {
      name: name ?? existing.name,
      cnpj: cnpj !== undefined ? (cnpj ? cnpj.replace(/\D/g, '') : null) : existing.cnpj,
      phone: phone !== undefined ? (phone || null) : existing.phone,
      email: email !== undefined ? (email || null) : existing.email,
      notes: notes !== undefined ? (notes || null) : existing.notes,
      isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive,
    },
  })
  res.json(updated)
})

// DELETE /suppliers/:id — soft delete (deactivate)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.supplier.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Fornecedor não encontrado' })

  await prisma.supplier.update({ where: { id }, data: { isActive: false } })
  res.json({ message: 'Fornecedor desativado' })
})

export default router
