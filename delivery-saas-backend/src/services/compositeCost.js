import { prisma } from '../prisma.js';
import { convertQuantity } from './unitConversion.js';

/**
 * Throws if adding `ingredientId` as a direct child of `compositeId`
 * would introduce a cycle. DFS the composition graph starting from
 * `ingredientId` and bail out if we reach `compositeId`.
 */
export async function assertNoCycle(compositeId, ingredientId, tx = prisma) {
  if (compositeId === ingredientId) {
    throw new Error('Um insumo composto não pode referenciar a si mesmo');
  }
  const visited = new Set();
  const stack = [ingredientId];
  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === compositeId) {
      throw new Error('Ciclo detectado: esta composição criaria uma dependência circular');
    }
    const children = await tx.compositeIngredientItem.findMany({
      where: { compositeId: current },
      select: { ingredientId: true },
    });
    for (const c of children) stack.push(c.ingredientId);
  }
}

/**
 * Compute the derived avgCost for a composite ingredient.
 * avgCost = sum(item.qty_in_base_unit * base.avgCost) / yield_in_composite_unit.
 * Returns null if any base ingredient lacks avgCost or if any unit is incompatible.
 */
export async function computeCompositeAvgCost(compositeId, tx = prisma) {
  const composite = await tx.ingredient.findUnique({
    where: { id: compositeId },
    include: {
      compositionItems: { include: { ingredient: true } },
    },
  });
  if (!composite || !composite.isComposite) return null;
  if (composite.yieldQuantity == null || !composite.yieldUnit) return null;
  if (!composite.compositionItems.length) return null;

  let totalCost = 0;
  for (const item of composite.compositionItems) {
    const baseCost = item.ingredient.avgCost;
    if (baseCost == null) return null;
    const qtyInBaseUnit = convertQuantity(item.quantity, item.unit, item.ingredient.unit);
    if (qtyInBaseUnit == null) return null;
    totalCost += qtyInBaseUnit * Number(baseCost);
  }

  const yieldInCompositeUnit = convertQuantity(composite.yieldQuantity, composite.yieldUnit, composite.unit);
  if (!yieldInCompositeUnit || yieldInCompositeUnit <= 0) return null;

  return totalCost / yieldInCompositeUnit;
}

/**
 * Returns all composite IDs that depend (directly or transitively) on `ingredientId`.
 */
async function findDependentComposites(ingredientId, tx = prisma) {
  const affected = new Set();
  const queue = [ingredientId];
  while (queue.length) {
    const current = queue.shift();
    const parents = await tx.compositeIngredientItem.findMany({
      where: { ingredientId: current },
      select: { compositeId: true },
    });
    for (const p of parents) {
      if (!affected.has(p.compositeId)) {
        affected.add(p.compositeId);
        queue.push(p.compositeId);
      }
    }
  }
  return affected;
}

/**
 * Recompute and persist avgCost for all composites that depend on the given base ingredient(s).
 * Iterates to a fixed point (safe because the graph is acyclic after assertNoCycle).
 */
export async function cascadeRecomputeComposites(changedIngredientIds, tx = prisma) {
  const seen = new Set();
  for (const id of changedIngredientIds) {
    const deps = await findDependentComposites(id, tx);
    for (const d of deps) seen.add(d);
  }
  if (!seen.size) return;

  const idsInOrder = [...seen];
  let changed = true;
  let iterations = 0;
  const maxIterations = idsInOrder.length + 1;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const id of idsInOrder) {
      const newCost = await computeCompositeAvgCost(id, tx);
      const current = await tx.ingredient.findUnique({ where: { id }, select: { avgCost: true } });
      const currentNum = current?.avgCost == null ? null : Number(current.avgCost);
      const newNum = newCost == null ? null : Number(newCost);
      if (newNum !== currentNum) {
        await tx.ingredient.update({ where: { id }, data: { avgCost: newNum } });
        changed = true;
      }
    }
  }
}
