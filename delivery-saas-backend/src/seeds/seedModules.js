/**
 * Seed: Garante que todos os SaasModule do enum ModuleKey existem no banco
 * e que empresas com SaasSubscription tenham os módulos básicos ativos.
 *
 * Uso:
 *   node src/seeds/seedModules.js
 *
 * Idempotente: pode rodar múltiplas vezes sem duplicar dados.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ALL_MODULES = [
  { key: 'CARDAPIO_SIMPLES',  name: 'Cardapio Simples' },
  { key: 'CARDAPIO_COMPLETO', name: 'Cardapio Completo' },
  { key: 'RIDERS',            name: 'Motoboys' },
  { key: 'AFFILIATES',        name: 'Afiliados' },
  { key: 'STOCK',             name: 'Estoque' },
  { key: 'CASHBACK',          name: 'Cashback' },
  { key: 'COUPONS',           name: 'Cupons' },
  { key: 'WHATSAPP',          name: 'WhatsApp' },
  { key: 'FINANCIAL',         name: 'Financeiro' },
  { key: 'FISCAL',            name: 'Fiscal' },
];

// Modules every company should have active by default
const DEFAULT_MODULES = ['CARDAPIO_SIMPLES', 'CARDAPIO_COMPLETO'];

async function main() {
  // 1. Upsert all SaasModule records
  for (const m of ALL_MODULES) {
    const existing = await prisma.saasModule.findFirst({ where: { key: m.key } });
    if (!existing) {
      const created = await prisma.saasModule.create({
        data: { key: m.key, name: m.name, isActive: true },
      });
      console.log(`  SaasModule ${m.key} criado: ${created.id}`);
    } else {
      console.log(`  SaasModule ${m.key} ja existe: ${existing.id}`);
    }
  }

  // 2. For every company with a SaasSubscription, ensure default modules are subscribed
  const subscriptions = await prisma.saasSubscription.findMany({
    where: { status: 'ACTIVE' },
    select: { companyId: true },
  });

  if (subscriptions.length === 0) {
    console.log('Nenhuma empresa com SaasSubscription ativa.');
    return;
  }

  const defaultModules = await prisma.saasModule.findMany({
    where: { key: { in: DEFAULT_MODULES } },
  });

  for (const sub of subscriptions) {
    for (const mod of defaultModules) {
      const exists = await prisma.saasModuleSubscription.findUnique({
        where: { companyId_moduleId: { companyId: sub.companyId, moduleId: mod.id } },
      });
      if (!exists) {
        await prisma.saasModuleSubscription.create({
          data: {
            companyId: sub.companyId,
            moduleId: mod.id,
            status: 'ACTIVE',
            period: 'MONTHLY',
            nextDueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        console.log(`  Modulo ${mod.key} atribuido a empresa ${sub.companyId}`);
      }
    }
  }

  console.log('Seed de modulos concluido.');
}

main()
  .catch((e) => {
    console.error('Erro no seed de modulos:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
