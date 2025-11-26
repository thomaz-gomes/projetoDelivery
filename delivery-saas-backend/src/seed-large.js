// src/seed-large.js
// Large dataset seeder: creates multiple companies, stores, menus, categories, products and option groups
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function randPrice(min = 5, max = 80) {
  const v = (Math.random() * (max - min) + min);
  return v.toFixed(2);
}

async function upsertCompany(slug, name) {
  return prisma.company.upsert({
    where: { slug },
    update: { name },
    create: { slug, name },
  });
}

async function upsertStore(companyId, slug, name) {
  return prisma.store.upsert({
    where: { slug },
    update: { name, companyId },
    create: { slug, name, companyId },
  });
}

async function upsertMenu(storeId, slug, name, position = 0) {
  return prisma.menu.upsert({
    where: { slug },
    update: { name, storeId, position },
    create: { slug, name, storeId, position },
  });
}

async function ensureCategory(companyId, menuId, name, position = 0) {
  // try find existing category by name + company
  const existing = await prisma.menuCategory.findFirst({ where: { companyId, name, menuId } });
  if (existing) return existing;
  return prisma.menuCategory.create({ data: { companyId, menuId, name, position } });
}

async function ensureProduct(companyId, menuId, categoryId, name, price, position = 0) {
  const exists = await prisma.product.findFirst({ where: { companyId, name } });
  if (exists) return exists;
  return prisma.product.create({ data: { companyId, menuId, categoryId, name, price: String(price), position } });
}

async function ensureOptionGroup(companyId, name, min = 0, max = null) {
  const existing = await prisma.optionGroup.findFirst({ where: { companyId, name } });
  if (existing) return existing;
  return prisma.optionGroup.create({ data: { companyId, name, min, max } });
}

async function ensureOption(groupId, name, price = '0.00', position = 0) {
  const exists = await prisma.option.findFirst({ where: { groupId, name } });
  if (exists) return exists;
  return prisma.option.create({ data: { groupId, name, price: String(price), position } });
}

async function linkProductToGroup(productId, groupId) {
  try {
    await prisma.productOptionGroup.create({ data: { productId, groupId } });
  } catch (e) {
    // ignore duplicate key errors
  }
}

async function main() {
  console.log('🌱 Starting large seed...');

  const companies = [
    { slug: 'demo-company-1', name: 'Demo Company 1' },
    { slug: 'demo-company-2', name: 'Demo Company 2' },
    { slug: 'demo-company-3', name: 'Demo Company 3' },
  ];

  let totalProducts = 0;
  let totalCategories = 0;

  for (const cmp of companies) {
    const company = await upsertCompany(cmp.slug, cmp.name);
    console.log('Company:', company.slug, company.id);

    // create an admin user per company (idempotent by email)
    const adminEmail = `${cmp.slug}.admin@example.com`;
    const adminExists = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!adminExists) {
      await prisma.user.create({ data: { companyId: company.id, role: 'ADMIN', name: 'Admin', email: adminEmail, password: 'changeme' } });
    }

    // create 2 stores per company
    for (let s = 1; s <= 2; s++) {
      const storeSlug = `${cmp.slug}-store-${s}`;
      const storeName = `${cmp.name} Store ${s}`;
      const store = await upsertStore(company.id, storeSlug, storeName);

      // create 2 menus per store
      for (let m = 1; m <= 2; m++) {
        const menuSlug = `${storeSlug}-menu-${m}`;
        const menuName = `${storeName} Menu ${m}`;
        const menu = await upsertMenu(store.id, menuSlug, menuName, m);

        // create 5 categories per menu
        const categories = [];
        for (let c = 1; c <= 5; c++) {
          const catName = `Categoria ${c}`;
          const cat = await ensureCategory(company.id, menu.id, catName, c);
          categories.push(cat);
        }
        totalCategories += categories.length;

        // create 20 products per category
        for (const cat of categories) {
          for (let p = 1; p <= 20; p++) {
            const prodName = `${menu.name} - ${cat.name} Item ${p}`;
            const price = randPrice(8, 80);
            const prod = await ensureProduct(company.id, menu.id, cat.id, prodName, price, p);
            totalProducts++;

            // link first 8 products to an option group later
          }
        }

        // create option groups and options per company (reused across menus)
        const addonsGroup = await ensureOptionGroup(company.id, 'Adicionais', 0, 5);
        await ensureOption(addonsGroup.id, 'Queijo extra', '3.50', 1);
        await ensureOption(addonsGroup.id, 'Bacon', '4.50', 2);
        await ensureOption(addonsGroup.id, 'Cebola caramelizada', '2.50', 3);

        const sizesGroup = await ensureOptionGroup(company.id, 'Tamanhos', 1, 1);
        await ensureOption(sizesGroup.id, 'Pequeno', '0.00', 1);
        await ensureOption(sizesGroup.id, 'Médio', '6.00', 2);
        await ensureOption(sizesGroup.id, 'Grande', '10.00', 3);

        // link the first 8 products of this menu to these groups
        const prods = await prisma.product.findMany({ where: { menuId: menu.id }, take: 8, orderBy: { createdAt: 'asc' } });
        for (const pd of prods) {
          await linkProductToGroup(pd.id, addonsGroup.id);
          await linkProductToGroup(pd.id, sizesGroup.id);
        }
      }
    }
  }

  console.log('✅ Large seed complete. Categories created:', totalCategories, 'Products approx:', totalProducts);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
