/**
 * Seed: CUSTOM_DOMAIN module with default pricing.
 *
 * Usage:
 *   node prisma/seeds/seedCustomDomainModule.js
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Upsert module
  const mod = await prisma.saasModule.upsert({
    where: { key: 'CUSTOM_DOMAIN' },
    update: {},
    create: {
      key: 'CUSTOM_DOMAIN',
      name: 'Domínio Próprio',
      description: 'Configure um domínio personalizado para seu cardápio',
      isActive: true,
      platformFee: 0
    }
  })

  console.log('Module:', mod.id, mod.key)

  // Upsert prices
  const monthly = await prisma.saasModulePrice.upsert({
    where: { moduleId_period: { moduleId: mod.id, period: 'MONTHLY' } },
    update: { price: 9.90 },
    create: { moduleId: mod.id, period: 'MONTHLY', price: 9.90 }
  })

  const annual = await prisma.saasModulePrice.upsert({
    where: { moduleId_period: { moduleId: mod.id, period: 'ANNUAL' } },
    update: { price: 99.00 },
    create: { moduleId: mod.id, period: 'ANNUAL', price: 99.00 }
  })

  console.log('Prices:')
  console.log('  MONTHLY:', Number(monthly.price).toFixed(2))
  console.log('  ANNUAL:', Number(annual.price).toFixed(2))

  console.log('\nDone! CUSTOM_DOMAIN module seeded.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
