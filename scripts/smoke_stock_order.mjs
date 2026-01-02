import { prisma } from '../delivery-saas-backend/src/prisma.js';
import buildAndPersistStockMovementFromOrderItems from '../delivery-saas-backend/src/services/stockFromOrder.js';

async function run() {
  try {
    // find a product with technical sheet
    const product = await prisma.product.findFirst({ where: { technicalSheetId: { not: null } } });
    const option = await prisma.option.findFirst({ where: { technicalSheetId: { not: null } } });

    if (!product && !option) {
      console.error('No product or option with technicalSheetId found. Seed required.');
      process.exit(1);
    }

    const companyId = (product && product.companyId) || (option && option.group && option.group.companyId) || (option && option.companyId) || (product && product.companyId) || null;

    // choose companyId from product if exists
    const usedCompanyId = product ? product.companyId : (option ? option.group && option.group.companyId : null) || null;

    const chosenOption = option || null;

    // build test order
    const order = {
      id: 'TEST-ORDER-1',
      companyId: product ? product.companyId : (option ? option.group && option.group.companyId : null),
      storeId: null,
      items: [
        {
          name: product ? product.name : 'Test Item',
          productId: product ? product.id : null,
          quantity: 1,
          options: chosenOption ? [{ id: chosenOption.id, name: chosenOption.name, quantity: 2 }] : []
        }
      ]
    };

    // collect ingredient ids to observe
    const ingredientIds = new Set();
    if (product && product.technicalSheetId) {
      const sheet = await prisma.technicalSheet.findUnique({ where: { id: product.technicalSheetId }, include: { items: true } });
      if (sheet) sheet.items.forEach(i => ingredientIds.add(i.ingredientId));
    }
    if (chosenOption && chosenOption.technicalSheetId) {
      const os = await prisma.technicalSheet.findUnique({ where: { id: chosenOption.technicalSheetId }, include: { items: true } });
      if (os) os.items.forEach(i => ingredientIds.add(i.ingredientId));
    }

    console.log('Tracked ingredientIds:', Array.from(ingredientIds));

    const before = await prisma.ingredient.findMany({ where: { id: { in: Array.from(ingredientIds) } }, select: { id: true, description: true, currentStock: true } });
    console.log('Before stocks:');
    console.table(before);

    const movement = await buildAndPersistStockMovementFromOrderItems(prisma, order);
    console.log('Created movement:', movement ? movement.id : null);

    const after = await prisma.ingredient.findMany({ where: { id: { in: Array.from(ingredientIds) } }, select: { id: true, description: true, currentStock: true } });
    console.log('After stocks:');
    console.table(after);

    const movements = await prisma.stockMovement.findMany({ where: { note: { contains: 'Order:TEST-ORDER-1' } }, include: { items: { include: { ingredient: true } } } });
    console.log('Stock movements for test order:');
    console.dir(movements, { depth: 4 });

    process.exit(0);
  } catch (e) {
    console.error('Smoke test error', e && (e.stack || e.message || e));
    process.exit(2);
  }
}

run();
