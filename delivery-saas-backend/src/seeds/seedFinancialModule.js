/**
 * Seed: Cria o SaasModule FINANCIAL e o associa a todos os planos existentes.
 *
 * Uso:
 *   node src/seeds/seedFinancialModule.js
 *
 * Idempotente: se o módulo já existir, apenas garante que está associado a todos os planos.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Upsert SaasModule FINANCIAL
  let mod = await prisma.saasModule.findFirst({ where: { key: 'FINANCIAL' } });

  if (!mod) {
    mod = await prisma.saasModule.create({
      data: {
        key: 'FINANCIAL',
        name: 'Financeiro',
        description: 'Módulo financeiro completo: contas a pagar/receber, fluxo de caixa, DRE, taxas de operadoras, conciliação OFX.',
        isActive: true,
      },
    });
    console.log('SaasModule FINANCIAL criado:', mod.id);
  } else {
    console.log('SaasModule FINANCIAL já existe:', mod.id);
  }

  // 2. Associar a todos os planos existentes
  const plans = await prisma.saasPlan.findMany();
  let linked = 0;

  for (const plan of plans) {
    const exists = await prisma.saasPlanModule.findFirst({
      where: { planId: plan.id, moduleId: mod.id },
    });

    if (!exists) {
      await prisma.saasPlanModule.create({
        data: { planId: plan.id, moduleId: mod.id },
      });
      console.log(`  Módulo FINANCIAL associado ao plano "${plan.name}" (${plan.id})`);
      linked++;
    }
  }

  if (linked === 0) {
    console.log('Módulo FINANCIAL já associado a todos os planos.');
  } else {
    console.log(`Módulo FINANCIAL associado a ${linked} plano(s).`);
  }
}

main()
  .catch((e) => {
    console.error('Erro no seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
