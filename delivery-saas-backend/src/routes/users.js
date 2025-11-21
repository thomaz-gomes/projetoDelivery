import express from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../prisma.js'
import { authMiddleware, createUser } from '../auth.js'
import { requirePermission } from '../utils/permissions.js'

export const usersRouter = express.Router()

usersRouter.use(authMiddleware)

// List users for the authenticated user's company
usersRouter.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId
    if (!companyId) return res.status(400).json({ message: 'companyId ausente no token' })
    const rows = await prisma.user.findMany({ where: { companyId }, select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true, } })
    return res.json(rows)
  } catch (e) {
    console.error('GET /users error', e)
    return res.status(500).json({ message: 'Erro ao listar usuários' })
  }
})

// Create user (ADMIN or SUPER_ADMIN)
usersRouter.post('/', requirePermission('users:create'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { name, email, whatsapp, role, password } = req.body || {}
    if (!name || !email || !role) return res.status(400).json({ message: 'name, email e role são obrigatórios' })
    // password optional: if not provided, create a random temporary password
    const pwd = password || Math.random().toString(36).slice(2,10)
    const created = await createUser({ name: String(name), email: String(email).toLowerCase(), password: String(pwd), role: String(role), companyId })
    // hide password/hash from response
    const out = { id: created.id, name: created.name, email: created.email, role: created.role, createdAt: created.createdAt }
    return res.status(201).json(out)
  } catch (e) {
    console.error('POST /users error', e)
    return res.status(500).json({ message: 'Erro ao criar usuário' })
  }
})

// Get single user
usersRouter.get('/:id', requirePermission('users:read'), async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    const u = await prisma.user.findFirst({ where: { id, companyId }, select: { id: true, name: true, email: true, role: true, whatsapp: true, createdAt: true, updatedAt: true } })
    if (!u) return res.status(404).json({ message: 'Usuário não encontrado' })
    return res.json(u)
  } catch (e) {
    console.error('GET /users/:id error', e)
    return res.status(500).json({ message: 'Erro ao buscar usuário' })
  }
})

// Update user (ADMIN or SUPER_ADMIN)
usersRouter.put('/:id', requirePermission('users:update'), async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    const body = req.body || {}
    const toUpdate = {}
    if (body.name !== undefined) toUpdate.name = String(body.name)
    if (body.email !== undefined) toUpdate.email = String(body.email).toLowerCase()
    if (body.role !== undefined) toUpdate.role = String(body.role)
    if (body.whatsapp !== undefined) toUpdate.whatsapp = String(body.whatsapp || null)
    // handle password change
    if (body.password) {
      const hash = await bcrypt.hash(String(body.password), 10)
      toUpdate.password = hash
    }
    const existing = await prisma.user.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Usuário não encontrado' })
    const updated = await prisma.user.update({ where: { id }, data: toUpdate, select: { id: true, name: true, email: true, role: true, whatsapp: true, updatedAt: true } })
    return res.json(updated)
  } catch (e) {
    console.error('PUT /users/:id error', e)
    return res.status(500).json({ message: 'Erro ao atualizar usuário' })
  }
})

// Delete user (only SUPER_ADMIN allowed)
usersRouter.delete('/:id', requirePermission('users:delete'), async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    const existing = await prisma.user.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Usuário não encontrado' })
    await prisma.user.delete({ where: { id } })
    return res.json({ success: true })
  } catch (e) {
    console.error('DELETE /users/:id error', e)
    return res.status(500).json({ message: 'Erro ao deletar usuário' })
  }
})

export default usersRouter
