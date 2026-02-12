import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

// List stock movements
router.get('/', async (req, res) => {
  try {
    const companyId = req.query.companyId || req.body?.companyId || req.headers['x-company-id'];
    const items = await prisma.stockMovement.findMany({ where: companyId ? { companyId } : {}, include: { items: { include: { ingredient: true } }, company: true, store: true }, orderBy: { createdAt: 'desc' } });
    res.json(items);
  } catch (e) {
    console.error('stockMovements GET error:', e && e.message ? e.message : e);
    const msg = e && e.message ? e.message : 'Erro ao listar movimentos';
    res.status(500).json({ message: msg });
  }
});

// Create a stock movement with items
router.post('/', async (req, res) => {
  try {
    const { companyId, storeId, type, reason, note, items } = req.body;
    if (!companyId || !type || !Array.isArray(items) || !items.length) return res.status(400).json({ message: 'Dados inválidos' });

    // validate company exists
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return res.status(400).json({ message: 'Empresa (companyId) inválida' });

    // perform creation inside a transaction to avoid partial updates
    const result = await prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({ data: { companyId, storeId: storeId || null, type, reason: reason || null, note: note || null } });

      for (const it of items) {
        const ingredient = await tx.ingredient.findUnique({ where: { id: it.ingredientId } });
        if (!ingredient) {
          throw new Error(`Ingrediente não encontrado: ${it.ingredientId}`);
        }

        const qty = Number(it.quantity) || 0;
        const unitCost = it.unitCost !== undefined ? (it.unitCost === null ? null : Number(it.unitCost)) : null;

        await tx.stockMovementItem.create({ data: { stockMovementId: movement.id, ingredientId: it.ingredientId, quantity: qty, unitCost } });

        // adjust ingredient stock and avg cost if IN
        let newStock = Number(ingredient.currentStock || 0);
        let newAvg = ingredient.avgCost !== null && ingredient.avgCost !== undefined ? Number(ingredient.avgCost) : null;

        if (type === 'IN') {
          if (unitCost !== null && unitCost !== undefined) {
            const existingQty = Number(ingredient.currentStock || 0);
            const existingAvg = ingredient.avgCost !== null && ingredient.avgCost !== undefined ? Number(ingredient.avgCost) : 0;
            const totalVal = existingAvg * existingQty + unitCost * qty;
            const totalQty = existingQty + qty;
            newAvg = totalQty > 0 ? (totalVal / totalQty) : unitCost;
          }
          newStock = newStock + qty;
        } else if (type === 'OUT') {
          newStock = newStock - qty;
        }

        await tx.ingredient.update({ where: { id: it.ingredientId }, data: { currentStock: newStock, avgCost: newAvg } });
      }

      return await tx.stockMovement.findUnique({ where: { id: movement.id }, include: { items: { include: { ingredient: true } }, company: true, store: true } });
    });

    res.json(result);
  } catch (e) {
    console.error('stockMovements POST error:', e && e.message ? e.message : e);
    const msg = e && e.message ? e.message : 'Erro ao criar movimento';
    res.status(500).json({ message: msg });
  }
});

// Get one movement
router.get('/:id', async (req, res) => {
  try {
    const m = await prisma.stockMovement.findUnique({ where: { id: req.params.id }, include: { items: { include: { ingredient: true } }, company: true, store: true } });
    if (!m) return res.status(404).json({ message: 'Movimento não encontrado' });
    res.json(m);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro' });
  }
});

// Delete movement (soft delete not implemented) — when deleting we won't try to revert stock here
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // remove items then movement
    await prisma.stockMovementItem.deleteMany({ where: { stockMovementId: id } });
    await prisma.stockMovement.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao deletar' });
  }
});

export default router;
