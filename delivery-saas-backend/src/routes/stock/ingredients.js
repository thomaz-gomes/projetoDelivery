import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';
import { areUnitsCompatible, convertQuantity } from '../../services/unitConversion.js';
import { assertNoCycle, cascadeRecomputeComposites, computeCompositeAvgCost } from '../../services/compositeCost.js';

export const ingredientsRouter = express.Router();
ingredientsRouter.use(authMiddleware);

const ALLOWED_UNITS = ['UN','GR','KG','ML','L'];

function validateCompositeFields(body) {
  if (!body.isComposite) return null;
  const y = Number(body.yieldQuantity);
  if (!Number.isFinite(y) || y <= 0) return 'Rendimento deve ser maior que zero';
  if (!ALLOWED_UNITS.includes(body.yieldUnit)) return 'Unidade do rendimento inválida';
  if (!Array.isArray(body.compositionItems) || !body.compositionItems.length) {
    return 'Insumo composto deve ter ao menos um ingrediente';
  }
  for (const item of body.compositionItems) {
    if (!item.ingredientId) return 'Ingrediente obrigatório em item da composição';
    const q = Number(item.quantity);
    if (!Number.isFinite(q) || q <= 0) return 'Quantidade do item deve ser maior que zero';
    if (!ALLOWED_UNITS.includes(item.unit)) return 'Unidade do item inválida';
  }
  return null;
}

async function validateCompositionItemsAgainstDb(tx, companyId, compositeId, items) {
  const ids = items.map(i => i.ingredientId);
  const baseIngredients = await tx.ingredient.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, unit: true, description: true },
  });
  const byId = new Map(baseIngredients.map(b => [b.id, b]));
  for (const item of items) {
    const base = byId.get(item.ingredientId);
    if (!base) return `Ingrediente ${item.ingredientId} não pertence à empresa`;
    if (!areUnitsCompatible(item.unit, base.unit)) {
      return `Unidade ${item.unit} incompatível com ${base.description} (${base.unit})`;
    }
    if (compositeId) {
      await assertNoCycle(compositeId, item.ingredientId, tx);
    }
  }
  return null;
}

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
  const row = await prisma.ingredient.findFirst({
    where: { id, companyId },
    include: {
      group: true,
      compositionItems: { include: { ingredient: true } },
    },
  });
  if (!row) return res.status(404).json({ message: 'Ingrediente não encontrado' });
  res.json(row);
});

// create
ingredientsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      description, unit, groupId = null,
      controlsStock = true, composesCmv = false,
      minStock = null, currentStock = null, avgCost = null,
      isComposite = false, yieldQuantity = null, yieldUnit = null,
      compositionItems = [],
    } = req.body || {};

    if (!description) return res.status(400).json({ message: 'Descrição é obrigatória' });
    if (!unit || !ALLOWED_UNITS.includes(unit)) return res.status(400).json({ message: 'Unidade inválida' });
    if (groupId) {
      const g = await prisma.ingredientGroup.findFirst({ where: { id: groupId, companyId } });
      if (!g) return res.status(400).json({ message: 'Grupo inválido' });
    }

    const compositeError = validateCompositeFields({ isComposite, yieldQuantity, yieldUnit, compositionItems });
    if (compositeError) return res.status(400).json({ message: compositeError });

    const result = await prisma.$transaction(async (tx) => {
      const data = {
        companyId, description, unit, groupId,
        controlsStock: !!controlsStock,
        composesCmv: !!composesCmv,
        minStock: controlsStock ? (minStock !== null ? Number(minStock) : 0) : null,
        currentStock: controlsStock ? (currentStock !== null ? Number(currentStock) : 0) : null,
        avgCost: avgCost !== undefined && avgCost !== null ? Number(avgCost) : null,
        isComposite: !!isComposite,
        yieldQuantity: isComposite ? Number(yieldQuantity) : null,
        yieldUnit: isComposite ? yieldUnit : null,
      };

      const created = await tx.ingredient.create({ data });

      if (isComposite) {
        const validationError = await validateCompositionItemsAgainstDb(tx, companyId, created.id, compositionItems);
        if (validationError) throw new Error(validationError);
        await tx.compositeIngredientItem.createMany({
          data: compositionItems.map(item => ({
            compositeId: created.id,
            ingredientId: item.ingredientId,
            quantity: Number(item.quantity),
            unit: item.unit,
          })),
        });
        const derivedCost = await computeCompositeAvgCost(created.id, tx);
        if (derivedCost != null) {
          await tx.ingredient.update({ where: { id: created.id }, data: { avgCost: derivedCost } });
        }
      }

      await cascadeRecomputeComposites([created.id], tx);
      return tx.ingredient.findUnique({
        where: { id: created.id },
        include: { group: true, compositionItems: { include: { ingredient: true } } },
      });
    });

    res.status(201).json(result);
  } catch (e) {
    console.error('POST /ingredients error', e);
    res.status(400).json({ message: e.message || 'Erro ao criar ingrediente' });
  }
});

// patch
ingredientsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const existing = await prisma.ingredient.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Ingrediente não encontrado' });

    const {
      description, unit, groupId,
      controlsStock, composesCmv,
      minStock, currentStock, avgCost,
      isComposite, yieldQuantity, yieldUnit,
      compositionItems,
    } = req.body || {};

    if (unit && !ALLOWED_UNITS.includes(unit)) return res.status(400).json({ message: 'Unidade inválida' });
    if (groupId) {
      const g = await prisma.ingredientGroup.findFirst({ where: { id: groupId, companyId } });
      if (!g) return res.status(400).json({ message: 'Grupo inválido' });
    }

    const nextIsComposite = isComposite === undefined ? existing.isComposite : !!isComposite;
    const nextCompositionItems = compositionItems === undefined ? null : compositionItems;

    if (nextIsComposite && nextCompositionItems !== null) {
      const compositeError = validateCompositeFields({
        isComposite: true,
        yieldQuantity: yieldQuantity ?? existing.yieldQuantity,
        yieldUnit: yieldUnit ?? existing.yieldUnit,
        compositionItems: nextCompositionItems,
      });
      if (compositeError) return res.status(400).json({ message: compositeError });
    }

    const result = await prisma.$transaction(async (tx) => {
      const data = {
        description: description ?? existing.description,
        unit: unit ?? existing.unit,
        groupId: groupId === undefined ? existing.groupId : groupId,
        controlsStock: controlsStock === undefined ? existing.controlsStock : !!controlsStock,
        composesCmv: composesCmv === undefined ? existing.composesCmv : !!composesCmv,
        isComposite: nextIsComposite,
        yieldQuantity: nextIsComposite
          ? (yieldQuantity !== undefined ? Number(yieldQuantity) : existing.yieldQuantity)
          : null,
        yieldUnit: nextIsComposite
          ? (yieldUnit !== undefined ? yieldUnit : existing.yieldUnit)
          : null,
      };

      if (data.controlsStock) {
        data.minStock = minStock !== undefined ? (minStock === null ? null : Number(minStock)) : existing.minStock;
        data.currentStock = currentStock !== undefined ? (currentStock === null ? null : Number(currentStock)) : existing.currentStock;
      } else {
        data.minStock = null;
        data.currentStock = null;
      }

      // For composites, avgCost is derived; do not honour manual avgCost edits.
      if (nextIsComposite) {
        data.avgCost = existing.avgCost;
      } else {
        data.avgCost = avgCost !== undefined ? (avgCost === null ? null : Number(avgCost)) : existing.avgCost;
      }

      await tx.ingredient.update({ where: { id }, data });

      // Replace composition items if provided (or if composite flag was flipped off).
      if (nextCompositionItems !== null || (!nextIsComposite && existing.isComposite)) {
        await tx.compositeIngredientItem.deleteMany({ where: { compositeId: id } });
        if (nextIsComposite && nextCompositionItems !== null) {
          const validationError = await validateCompositionItemsAgainstDb(tx, companyId, id, nextCompositionItems);
          if (validationError) throw new Error(validationError);
          await tx.compositeIngredientItem.createMany({
            data: nextCompositionItems.map(item => ({
              compositeId: id,
              ingredientId: item.ingredientId,
              quantity: Number(item.quantity),
              unit: item.unit,
            })),
          });
        }
      }

      // Recompute this composite's cost (if applicable) and propagate upward.
      if (nextIsComposite) {
        const derivedCost = await computeCompositeAvgCost(id, tx);
        if (derivedCost != null) {
          await tx.ingredient.update({ where: { id }, data: { avgCost: derivedCost } });
        }
      }
      await cascadeRecomputeComposites([id], tx);

      return tx.ingredient.findUnique({
        where: { id },
        include: { group: true, compositionItems: { include: { ingredient: true } } },
      });
    });

    res.json(result);
  } catch (e) {
    console.error('PATCH /ingredients/:id error', e);
    res.status(400).json({ message: e.message || 'Erro ao atualizar ingrediente' });
  }
});

// produce — create a PRODUCTION movement that debits bases and credits the composite
ingredientsRouter.post('/:id/produce', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const { quantity, storeId = null, note = null, allowNegative = false } = req.body || {};
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: 'Quantidade inválida' });

    const composite = await prisma.ingredient.findFirst({
      where: { id, companyId, isComposite: true },
      include: { compositionItems: { include: { ingredient: true } } },
    });
    if (!composite) return res.status(404).json({ message: 'Insumo composto não encontrado' });
    if (!composite.yieldQuantity || Number(composite.yieldQuantity) <= 0) {
      return res.status(400).json({ message: 'Composto sem rendimento definido' });
    }
    if (!composite.compositionItems.length) {
      return res.status(400).json({ message: 'Composto sem ingredientes na composição' });
    }

    const ratio = qty / Number(composite.yieldQuantity);
    const baseConsumption = composite.compositionItems.map(item => {
      const consumedInItemUnit = Number(item.quantity) * ratio;
      const consumedInBaseUnit = convertQuantity(consumedInItemUnit, item.unit, item.ingredient.unit);
      return { ingredientId: item.ingredientId, qtyInBaseUnit: consumedInBaseUnit, baseIngredient: item.ingredient };
    });

    for (const c of baseConsumption) {
      if (c.qtyInBaseUnit == null) {
        return res.status(400).json({ message: `Conversão de unidade falhou para ${c.baseIngredient.description}` });
      }
    }

    if (!allowNegative) {
      for (const c of baseConsumption) {
        if (Number(c.baseIngredient.currentStock || 0) < c.qtyInBaseUnit) {
          return res.status(400).json({ message: `Estoque insuficiente para ${c.baseIngredient.description}` });
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: { companyId, storeId: storeId || null, type: 'PRODUCTION', note: note || null },
      });

      for (const c of baseConsumption) {
        await tx.stockMovementItem.create({
          data: { stockMovementId: movement.id, ingredientId: c.ingredientId, quantity: c.qtyInBaseUnit, unitCost: null },
        });
        const base = await tx.ingredient.findUnique({ where: { id: c.ingredientId } });
        await tx.ingredient.update({
          where: { id: c.ingredientId },
          data: { currentStock: Number(base.currentStock || 0) - c.qtyInBaseUnit },
        });
      }

      await tx.stockMovementItem.create({
        data: { stockMovementId: movement.id, ingredientId: composite.id, quantity: qty, unitCost: null },
      });
      await tx.ingredient.update({
        where: { id: composite.id },
        data: { currentStock: Number(composite.currentStock || 0) + qty },
      });

      const changedIds = [...baseConsumption.map(c => c.ingredientId), composite.id];
      await cascadeRecomputeComposites(changedIds, tx);

      return tx.stockMovement.findUnique({
        where: { id: movement.id },
        include: { items: { include: { ingredient: true } } },
      });
    });

    res.json(result);
  } catch (e) {
    console.error('POST /ingredients/:id/produce error', e);
    res.status(500).json({ message: e.message || 'Erro ao registrar produção' });
  }
});

// delete
ingredientsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.ingredient.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Ingrediente não encontrado' });

  const usedInSheets = await prisma.technicalSheetItem.findFirst({ where: { ingredientId: id } });
  if (usedInSheets) return res.status(400).json({ message: 'Ingrediente usado em fichas técnicas; remova referências antes' });

  const usedInComposites = await prisma.compositeIngredientItem.findFirst({ where: { ingredientId: id } });
  if (usedInComposites) return res.status(400).json({ message: 'Ingrediente usado em insumos compostos; remova referências antes' });

  await prisma.$transaction(async (tx) => {
    await tx.compositeIngredientItem.deleteMany({ where: { compositeId: id } });
    await tx.ingredient.delete({ where: { id } });
  });
  res.json({ ok: true });
});

export default ingredientsRouter;
