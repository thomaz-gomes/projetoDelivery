import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Upsert SaaS modules
  const cardapioSimples = await prisma.saasModule.upsert({
    where: { key: 'CARDAPIO_SIMPLES' },
    update: { name: 'Cardápio Simples', isActive: true },
    create: { key: 'CARDAPIO_SIMPLES', name: 'Cardápio Simples', isActive: true }
  });
  const cardapioCompleto = await prisma.saasModule.upsert({
    where: { key: 'CARDAPIO_COMPLETO' },
    update: { name: 'Cardápio Completo', isActive: true },
    create: { key: 'CARDAPIO_COMPLETO', name: 'Cardápio Completo', isActive: true }
  });
  const riders = await prisma.saasModule.upsert({
    where: { key: 'RIDERS' },
    update: { name: 'Entregadores', isActive: true },
    create: { key: 'RIDERS', name: 'Entregadores', isActive: true }
  });
  const affiliates = await prisma.saasModule.upsert({
    where: { key: 'AFFILIATES' },
    update: { name: 'Afiliados', isActive: true },
    create: { key: 'AFFILIATES', name: 'Afiliados', isActive: true }
  });

  // ── Plano padrão: Cardápio Simples (isDefault + isSystem) ──────────────
  // Criado ou atualizado para sempre existir; não pode ser excluído.
  let defaultPlan = await prisma.saasPlan.findFirst({ where: { isSystem: true } });
  if (!defaultPlan) {
    defaultPlan = await prisma.saasPlan.create({
      data: {
        name: 'Cardápio Simples',
        price: '0',
        menuLimit: null,
        storeLimit: null,
        unlimitedMenus: true,
        unlimitedStores: true,
        isActive: true,
        isDefault: true,
        isSystem: true,
        modules: {
          create: [{ module: { connect: { id: cardapioSimples.id } } }]
        }
      }
    });
    console.log('Plano padrão "Cardápio Simples" criado.');
  } else {
    // Garante campos obrigatórios e módulo vinculado
    await prisma.saasPlan.update({
      where: { id: defaultPlan.id },
      data: { isDefault: true, isSystem: true, isActive: true }
    });
    const linked = await prisma.saasPlanModule.findUnique({
      where: { planId_moduleId: { planId: defaultPlan.id, moduleId: cardapioSimples.id } }
    });
    if (!linked) {
      await prisma.saasPlanModule.create({ data: { planId: defaultPlan.id, moduleId: cardapioSimples.id } });
    }
    console.log('Plano padrão "Cardápio Simples" já existe — atualizado.');
  }

  // ── Plano completo: Starter (mantém compatibilidade) ───────────────────
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
        isDefault: false,
        isSystem: false,
        modules: {
          create: [
            { module: { connect: { id: cardapioSimples.id } } },
            { module: { connect: { id: cardapioCompleto.id } } },
            { module: { connect: { id: riders.id } } },
            { module: { connect: { id: affiliates.id } } }
          ]
        }
      }
    });
    console.log('Plano "Starter" criado.');
  } else {
    const existingLinks = await prisma.saasPlanModule.findMany({ where: { planId: starter.id } });
    const linkedIds = new Set(existingLinks.map(l => l.moduleId));
    const toLink = [cardapioSimples, cardapioCompleto, riders, affiliates].filter(m => !linkedIds.has(m.id));
    for (const m of toLink) {
      await prisma.saasPlanModule.create({ data: { planId: starter.id, moduleId: m.id } });
    }
  }

  // ── Garante subscription para empresas sem plano ───────────────────────
  const companies = await prisma.company.findMany({});
  let assigned = 0;
  for (const c of companies) {
    const exists = await prisma.saasSubscription.findUnique({ where: { companyId: c.id } });
    if (!exists) {
      await prisma.saasSubscription.create({
        data: { companyId: c.id, planId: defaultPlan.id, status: 'ACTIVE', nextDueAt: null }
      });
      assigned++;
    }
  }

  console.log('Seed concluído:', {
    modules: ['CARDAPIO_SIMPLES', 'CARDAPIO_COMPLETO', 'RIDERS', 'AFFILIATES'],
    defaultPlan: defaultPlan.name,
    companiesSeeded: assigned
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
