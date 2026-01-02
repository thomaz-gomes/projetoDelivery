import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';

export const ingredientGroupsRouter = express.Router();
ingredientGroupsRouter.use(authMiddleware);

// list groups
ingredientGroupsRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  const rows = await prisma.ingredientGroup.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  res.json(rows);
});

// create
ingredientGroupsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { name, parentId = null, composesCmv = false } = req.body || {};
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' });

  // prevent cycles: verify parent chain does not include new node (no cycles since new id unknown)
  if (parentId) {
    const parent = await prisma.ingredientGroup.findFirst({ where: { id: parentId, companyId } });
    if (!parent) return res.status(400).json({ message: 'Grupo pai inválido' });
  }

  const created = await prisma.ingredientGroup.create({ data: { companyId, name, parentId, composesCmv } });
  res.status(201).json(created);
});

// patch
ingredientGroupsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.ingredientGroup.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Grupo não encontrado' });

  const { name, parentId, composesCmv } = req.body || {};

  // prevent cycles if parentId provided
  if (parentId) {
    if (parentId === id) return res.status(400).json({ message: 'Grupo pai não pode ser o próprio grupo' });
    // walk up parent chain to ensure no cycle
    let cur = parentId;
    while (cur) {
      if (cur === id) return res.status(400).json({ message: 'Ciclo hierárquico detectado' });
      const p = await prisma.ingredientGroup.findUnique({ where: { id: cur }, select: { parentId: true } });
      cur = p ? p.parentId : null;
    }
  }

  const updated = await prisma.ingredientGroup.update({ where: { id }, data: { name: name ?? existing.name, parentId: parentId === undefined ? existing.parentId : parentId, composesCmv: composesCmv === undefined ? existing.composesCmv : composesCmv } });
  res.json(updated);
});

// delete
ingredientGroupsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.ingredientGroup.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Grupo não encontrado' });

  // prevent delete if has children or ingredients
  const child = await prisma.ingredientGroup.findFirst({ where: { parentId: id } });
  if (child) return res.status(400).json({ message: 'Existem subgrupos; remova-os primeiro' });
  const linkedIng = await prisma.ingredient.findFirst({ where: { groupId: id } });
  if (linkedIng) return res.status(400).json({ message: 'Existem ingredientes vinculados ao grupo; remova-os ou reatribua primeiro' });

  await prisma.ingredientGroup.delete({ where: { id } });
  res.json({ ok: true });
});

export default ingredientGroupsRouter;
