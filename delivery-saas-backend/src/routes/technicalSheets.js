import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';

export const technicalSheetsRouter = express.Router();
technicalSheetsRouter.use(authMiddleware);

// list
technicalSheetsRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  // include ingredient relation on items so clients can compute sheet cost without extra requests
  const rows = await prisma.technicalSheet.findMany({ where: { companyId }, orderBy: { name: 'asc' }, include: { items: { include: { ingredient: true } } } });
  // map with count
  const mapped = rows.map(r => ({ ...r, itemCount: (r.items || []).length }));
  res.json(mapped);
});

// get single
technicalSheetsRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const row = await prisma.technicalSheet.findFirst({ where: { id, companyId }, include: { items: { include: { ingredient: true } } } });
  if (!row) return res.status(404).json({ message: 'Ficha técnica não encontrada' });
  res.json(row);
});

// create
technicalSheetsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { name, notes = '' } = req.body || {};
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' });

  const created = await prisma.technicalSheet.create({ data: { companyId, name, notes } });
  res.status(201).json(created);
});

// patch
technicalSheetsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.technicalSheet.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Ficha técnica não encontrada' });

  const { name, notes } = req.body || {};
  const updated = await prisma.technicalSheet.update({ where: { id }, data: { name: name ?? existing.name, notes: notes ?? existing.notes } });
  res.json(updated);
});

// delete
technicalSheetsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.technicalSheet.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Ficha técnica não encontrada' });

  // remove items first
  await prisma.technicalSheetItem.deleteMany({ where: { technicalSheetId: id } });
  await prisma.technicalSheet.delete({ where: { id } });
  res.json({ ok: true });
});

// Items: add
technicalSheetsRouter.post('/:id/items', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const sheet = await prisma.technicalSheet.findFirst({ where: { id, companyId } });
  if (!sheet) return res.status(404).json({ message: 'Ficha técnica não encontrada' });

  const { ingredientId, quantity } = req.body || {};
  if (!ingredientId) return res.status(400).json({ message: 'ingredientId é obrigatório' });
  if (!quantity || Number(quantity) <= 0) return res.status(400).json({ message: 'Quantidade deve ser > 0' });

  const ing = await prisma.ingredient.findFirst({ where: { id: ingredientId, companyId } });
  if (!ing) return res.status(400).json({ message: 'Ingrediente inválido' });

  const created = await prisma.technicalSheetItem.create({ data: { technicalSheetId: id, ingredientId, quantity: Number(quantity) } });
  res.status(201).json(created);
});

// Items: patch
technicalSheetsRouter.patch('/:id/items/:itemId', requireRole('ADMIN'), async (req, res) => {
  const { id, itemId } = req.params;
  const companyId = req.user.companyId;
  const sheet = await prisma.technicalSheet.findFirst({ where: { id, companyId } });
  if (!sheet) return res.status(404).json({ message: 'Ficha técnica não encontrada' });

  const existing = await prisma.technicalSheetItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.technicalSheetId !== id) return res.status(404).json({ message: 'Item não encontrado' });

  const { quantity } = req.body || {};
  if (quantity !== undefined && Number(quantity) <= 0) return res.status(400).json({ message: 'Quantidade deve ser > 0' });

  const updated = await prisma.technicalSheetItem.update({ where: { id: itemId }, data: { quantity: quantity !== undefined ? Number(quantity) : existing.quantity } });
  res.json(updated);
});

// Items: delete
technicalSheetsRouter.delete('/:id/items/:itemId', requireRole('ADMIN'), async (req, res) => {
  const { id, itemId } = req.params;
  const companyId = req.user.companyId;
  const sheet = await prisma.technicalSheet.findFirst({ where: { id, companyId } });
  if (!sheet) return res.status(404).json({ message: 'Ficha técnica não encontrada' });

  const existing = await prisma.technicalSheetItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.technicalSheetId !== id) return res.status(404).json({ message: 'Item não encontrado' });

  await prisma.technicalSheetItem.delete({ where: { id: itemId } });
  res.json({ ok: true });
});

export default technicalSheetsRouter;
