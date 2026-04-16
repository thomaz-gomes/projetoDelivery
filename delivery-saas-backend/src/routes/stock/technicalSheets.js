import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';
import { assertCompatibleUnit } from '../../utils/unitConversion.js';
import { auditSheetItems } from '../../services/auditUnits.js';
import { makeCopyName } from '../../utils/copyName.js';

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

// Audit: list sheet items whose unit is incompatible with the ingredient's unit.
// MUST be declared BEFORE `/:id` so Express doesn't capture "audit-units" as an id.
technicalSheetsRouter.get('/audit-units', async (req, res) => {
  try {
    const result = await auditSheetItems(prisma, req.user.companyId);
    res.json(result);
  } catch (e) {
    console.error('GET /technical-sheets/audit-units error:', e);
    res.status(500).json({ message: e?.message });
  }
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
  const companyId = req.user?.companyId;
  const { name, notes = '', yield: yieldValue } = req.body || {};
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' });
  if (!companyId) return res.status(400).json({ message: 'Usuário não está associado a uma empresa (companyId ausente)' });

  // ensure company exists to avoid foreign-key violations
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return res.status(400).json({ message: 'Empresa não encontrada para o usuário' });

  try {
    const created = await prisma.technicalSheet.create({ data: { companyId, name, notes, yield: yieldValue || null } });
    res.status(201).json(created);
  } catch (err) {
    console.error('technicalSheets.create error', err);
    // return limited info to client, log full error on server
    return res.status(500).json({ message: 'Erro ao criar ficha técnica', detail: err?.message });
  }
});

// patch
technicalSheetsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.technicalSheet.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Ficha técnica não encontrada' });

  const { name, notes, yield: yieldValue } = req.body || {};
  const updated = await prisma.technicalSheet.update({
    where: { id },
    data: {
      name: name ?? existing.name,
      notes: notes ?? existing.notes,
      yield: yieldValue !== undefined ? (yieldValue || null) : existing.yield,
    },
  });
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

  const { ingredientId, quantity, unit } = req.body || {};
  if (!ingredientId) return res.status(400).json({ message: 'ingredientId é obrigatório' });
  if (!quantity || Number(quantity) <= 0) return res.status(400).json({ message: 'Quantidade deve ser > 0' });

  const ALLOWED_UNITS = ['UN', 'GR', 'KG', 'ML', 'L'];
  const ing = await prisma.ingredient.findFirst({ where: { id: ingredientId, companyId } });
  if (!ing) return res.status(400).json({ message: 'Ingrediente inválido' });

  const itemUnit = unit && ALLOWED_UNITS.includes(String(unit).toUpperCase()) ? String(unit).toUpperCase() : null;

  // Reject incompatible unit families (e.g. UN against a KG ingredient) — this would
  // silently corrupt cost calculation and stock deduction on sales.
  try {
    assertCompatibleUnit(itemUnit, ing.unit);
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message, code: e.code });
  }

  const created = await prisma.technicalSheetItem.create({ data: { technicalSheetId: id, ingredientId, quantity: Number(quantity), unit: itemUnit } });
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

  const { quantity, unit } = req.body || {};
  if (quantity !== undefined && Number(quantity) <= 0) return res.status(400).json({ message: 'Quantidade deve ser > 0' });

  const ALLOWED_UNITS = ['UN', 'GR', 'KG', 'ML', 'L'];
  const data = {};
  if (quantity !== undefined) data.quantity = Number(quantity);
  if (unit !== undefined) data.unit = unit && ALLOWED_UNITS.includes(String(unit).toUpperCase()) ? String(unit).toUpperCase() : null;

  // If unit is being updated, validate it against the target ingredient's unit
  // (loaded from the existing item) to prevent incompatible family mismatches.
  if (unit !== undefined) {
    const ing = await prisma.ingredient.findUnique({ where: { id: existing.ingredientId } });
    if (!ing) return res.status(404).json({ message: 'Ingrediente não encontrado' });
    try {
      assertCompatibleUnit(data.unit, ing.unit);
    } catch (e) {
      return res.status(e.status || 400).json({ message: e.message, code: e.code });
    }
  }

  const updated = await prisma.technicalSheetItem.update({ where: { id: itemId }, data: Object.keys(data).length ? data : { quantity: existing.quantity } });
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

// Duplicate a technical sheet and all its items (atomic).
// Copies shared FKs (ingredientId) — does NOT deep-copy ingredients.
technicalSheetsRouter.post('/:id/duplicate', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const source = await prisma.technicalSheet.findFirst({
      where: { id: req.params.id, companyId },
      include: { items: true },
    });
    if (!source) return res.status(404).json({ message: 'Ficha técnica não encontrada' });

    const existing = await prisma.technicalSheet.findMany({
      where: { companyId },
      select: { name: true },
    });
    const newName = makeCopyName(source.name, existing.map(s => s.name));

    const created = await prisma.$transaction(async (tx) => {
      const sheet = await tx.technicalSheet.create({
        data: {
          companyId,
          name: newName,
          notes: source.notes,
          yield: source.yield,
        },
      });
      if (source.items && source.items.length) {
        await tx.technicalSheetItem.createMany({
          data: source.items.map(it => ({
            technicalSheetId: sheet.id,
            ingredientId: it.ingredientId,
            quantity: it.quantity,
            unit: it.unit,
          })),
        });
      }
      return tx.technicalSheet.findUnique({
        where: { id: sheet.id },
        include: { items: { include: { ingredient: true } } },
      });
    });

    res.status(201).json(created);
  } catch (e) {
    console.error('POST /technical-sheets/:id/duplicate error:', e);
    res.status(500).json({ message: e?.message || 'Erro ao duplicar ficha técnica' });
  }
});

export default technicalSheetsRouter;
