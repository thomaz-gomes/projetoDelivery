const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  try {
    const companyId = 'bd6a5381-6b90-4cc9-bc8f-24890c491693';

    const pm = await prisma.paymentMethod.upsert({
      where: { code: 'CASH' },
      update: { isActive: true },
      create: { companyId, name: 'Cash', code: 'CASH', isActive: true },
    });

    const category = await prisma.menuCategory.upsert({
      where: { id: 'category-default-1' },
      update: { name: 'Default', position: 0 },
      create: { id: 'category-default-1', companyId, name: 'Default', position: 0 },
    });

    const product = await prisma.product.upsert({
      where: { id: 'product-default-1' },
      update: { name: 'Produto A', price: 10.0, isActive: true, categoryId: category.id },
      create: {
        id: 'product-default-1',
        companyId,
        categoryId: category.id,
        name: 'Produto A',
        description: 'Produto de teste',
        price: 10.0,
        isActive: true,
        position: 0,
      },
    });

    console.log('Upsert results:');
    console.log('paymentMethod:', pm);
    console.log('category:', category);
    console.log('product:', product);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
