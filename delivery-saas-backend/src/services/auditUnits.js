import { areUnitsCompatible } from '../utils/unitConversion.js';

export async function auditSheetItems(prismaInstance, companyId, { limit = 100 } = {}) {
  const items = await prismaInstance.technicalSheetItem.findMany({
    where: { technicalSheet: { companyId } },
    include: {
      technicalSheet: { select: { id: true, name: true, companyId: true } },
      ingredient: { select: { id: true, description: true, unit: true } },
    },
    // no take here — we need to filter first, then slice
  });
  const bad = [];
  for (const it of items) {
    if (!it.ingredient || !it.technicalSheet) continue;
    if (!areUnitsCompatible(it.unit, it.ingredient.unit)) {
      bad.push({
        itemId: it.id,
        sheetId: it.technicalSheet.id,
        sheetName: it.technicalSheet.name,
        ingredientId: it.ingredient.id,
        ingredientName: it.ingredient.description,
        itemUnit: it.unit,
        ingredientUnit: it.ingredient.unit,
        quantity: Number(it.quantity),
      });
    }
  }
  return { items: bad.slice(0, limit), total: bad.length, truncated: bad.length > limit };
}
