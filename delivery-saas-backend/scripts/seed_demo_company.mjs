import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function ensureModulesAndPlan() {
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

  let starter = await prisma.saasPlan.findFirst({ where: { name: 'Starter' } });
  if (!starter) {
    starter = await prisma.saasPlan.create({
      data: {
        name: 'Starter',
        price: '59.90',
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
    const existingLinks = await prisma.saasPlanModule.findMany({ where: { planId: starter.id } });
    const linkedIds = new Set(existingLinks.map(l => l.moduleId));
    const toLink = [riders, affiliates].filter(m => !linkedIds.has(m.id));
    for (const m of toLink) {
      await prisma.saasPlanModule.create({ data: { planId: starter.id, moduleId: m.id } });
    }
  }
  return starter.id;
}

async function main() {
  const company = await prisma.company.upsert({
    where: { slug: 'demo-lanchonete' },
    update: { name: 'Demo Lanchonete', alwaysOpen: true, timezone: 'America/Sao_Paulo' },
    create: { name: 'Demo Lanchonete', slug: 'demo-lanchonete', alwaysOpen: true, timezone: 'America/Sao_Paulo' }
  });

  let store = await prisma.store.findFirst({ where: { companyId: company.id } });
  if (!store) {
    store = await prisma.store.create({ data: { companyId: company.id, name: 'Matriz', isActive: true } });
  }

  const adminEmail = 'admin@demo.local';
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    const hashed = await bcrypt.hash('admin123', 10);
    admin = await prisma.user.create({
      data: {
        companyId: company.id,
        role: 'ADMIN',
        name: 'Admin Demo',
        email: adminEmail,
        password: hashed
      }
    });
  }

  const planId = await ensureModulesAndPlan();

  let sub = await prisma.saasSubscription.findUnique({ where: { companyId: company.id } });
  if (!sub) {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    sub = await prisma.saasSubscription.create({
      data: {
        companyId: company.id,
        planId,
        status: 'ACTIVE',
        nextDueAt: nextMonth
      }
    });
  }

  console.log('Demo company seeded:', {
    company: company.slug,
    store: store?.name,
    adminEmail,
    adminPassword: 'admin123',
    planId,
    subscriptionCreated: Boolean(sub)
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
