import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Upsert SaaS modules
  const riders = await prisma.saasModule.upsert({
    where: { key: 'RIDERS' },
    update: { name: 'Riders', isActive: true },
    create: { key: 'RIDERS', name: 'Riders', isActive: true }
  });
  const affiliates = await prisma.saasModule.upsert({
    where: { key: 'AFFILIATES' },
    update: { name: 'Afiliados', isActive: true },
    create: { key: 'AFFILIATES', name: 'Afiliados', isActive: true }
  });

  // Create or update a starter plan
  let starter = await prisma.saasPlan.findFirst({ where: { name: 'Starter' } });
  if (!starter) {
    starter = await prisma.saasPlan.create({
      data: {
        name: 'Starter',
        price: '59.90', // Decimal as string
        menuLimit: 10,
        storeLimit: 1,
        unlimitedMenus: false,
        unlimitedStores: false,
        isActive: true,
        modules: {
          create: [
            { module: { connect: { id: riders.id } } },
            { module: { connect: { id: affiliates.id } } }
          ]
        }
      }
    });
  } else {
    // ensure modules linked
    const existingLinks = await prisma.saasPlanModule.findMany({ where: { planId: starter.id } });
    const linkedIds = new Set(existingLinks.map(l => l.moduleId));
    const toLink = [riders, affiliates].filter(m => !linkedIds.has(m.id));
    for (const m of toLink) {
      await prisma.saasPlanModule.create({ data: { planId: starter.id, moduleId: m.id } });
    }
  }

  // Ensure each company has a subscription
  const companies = await prisma.company.findMany({});
  for (const c of companies) {
    const exists = await prisma.saasSubscription.findUnique({ where: { companyId: c.id } });
    if (!exists) {
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      await prisma.saasSubscription.create({
        data: {
          companyId: c.id,
          planId: starter.id,
          status: 'ACTIVE',
          nextDueAt: nextMonth
        }
      });
    }
  }

  console.log('Seed complete:', {
    modules: ['RIDERS', 'AFFILIATES'],
    plan: 'Starter',
    companiesSeeded: companies.length
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
