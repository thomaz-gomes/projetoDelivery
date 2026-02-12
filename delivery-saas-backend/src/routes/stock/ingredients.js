import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';

export const ingredientsRouter = express.Router();
ingredientsRouter.use(authMiddleware);

const ALLOWED_UNITS = ['UN','GR','KG','ML','L'];

// list
ingredientsRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  const rows = await prisma.ingredient.findMany({ where: { companyId }, orderBy: { description: 'asc' }, include: { group: true } });
  res.json(rows);
});

// get single
ingredientsRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const row = await prisma.ingredient.findFirst({ where: { id, companyId }, include: { group: true } });
  if (!row) return res.status(404).json({ message: 'Ingrediente não encontrado' });
  res.json(row);
});

// create
ingredientsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { description, unit, groupId = null, controlsStock = true, composesCmv = false, minStock = null, currentStock = null, avgCost = null } = req.body || {};
  if (!description) return res.status(400).json({ message: 'Descrição é obrigatória' });
  if (!unit || ALLOWED_UNITS.indexOf(unit) === -1) return res.status(400).json({ message: 'Unidade inválida' });

  if (groupId) {
    const g = await prisma.ingredientGroup.findFirst({ where: { id: groupId, companyId } });
    if (!g) return res.status(400).json({ message: 'Grupo inválido' });
  }

  const data = {
    companyId,
    description,
    unit,
    groupId,
    controlsStock: !!controlsStock,
    composesCmv: !!composesCmv,
    minStock: controlsStock ? (minStock !== null ? Number(minStock) : 0) : null,
    currentStock: controlsStock ? (currentStock !== null ? Number(currentStock) : 0) : null,
    avgCost: avgCost !== undefined ? (avgCost === null ? null : Number(avgCost)) : null
  };

  const created = await prisma.ingredient.create({ data });
  res.status(201).json(created);
});

// patch
ingredientsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.ingredient.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Ingrediente não encontrado' });

  const { description, unit, groupId, controlsStock, composesCmv, minStock, currentStock, avgCost } = req.body || {};

  if (unit && ALLOWED_UNITS.indexOf(unit) === -1) return res.status(400).json({ message: 'Unidade inválida' });
  if (groupId) {
    const g = await prisma.ingredientGroup.findFirst({ where: { id: groupId, companyId } });
    if (!g) return res.status(400).json({ message: 'Grupo inválido' });
  }

  const data = {
    description: description ?? existing.description,
    unit: unit ?? existing.unit,
    groupId: groupId === undefined ? existing.groupId : groupId,
    controlsStock: controlsStock === undefined ? existing.controlsStock : !!controlsStock,
    composesCmv: composesCmv === undefined ? existing.composesCmv : !!composesCmv,
    minStock: existing.minStock,
    currentStock: existing.currentStock,
    avgCost: existing.avgCost
  };

  // only update stock fields when controlsStock=true
  if (data.controlsStock) {
    data.minStock = minStock !== undefined ? (minStock === null ? null : Number(minStock)) : existing.minStock;
    data.currentStock = currentStock !== undefined ? (currentStock === null ? null : Number(currentStock)) : existing.currentStock;
  } else {
    data.minStock = null;
    data.currentStock = null;
  }

  data.avgCost = avgCost !== undefined ? (avgCost === null ? null : Number(avgCost)) : existing.avgCost;

  const updated = await prisma.ingredient.update({ where: { id }, data });
  res.json(updated);
});

// delete
ingredientsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.ingredient.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Ingrediente não encontrado' });

  const used = await prisma.technicalSheetItem.findFirst({ where: { ingredientId: id } });
  if (used) return res.status(400).json({ message: 'Ingrediente usado em fichas técnicas; remova referências antes' });

  await prisma.ingredient.delete({ where: { id } });
  res.json({ ok: true });
});

export default ingredientsRouter;
