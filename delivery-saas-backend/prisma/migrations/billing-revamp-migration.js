// Run with: node prisma/migrations/billing-revamp-migration.js
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function migrate() {
  console.log('Starting billing revamp migration...')

  // 1. Find or create the single basic plan
  let basicPlan = await prisma.saasPlan.findFirst({ where: { isDefault: true } })
  if (!basicPlan) {
    basicPlan = await prisma.saasPlan.findFirst({ orderBy: { createdAt: 'asc' } })
  }
  if (!basicPlan) {
    console.log('No plans found. Creating default basic plan...')
    basicPlan = await prisma.saasPlan.create({
      data: { name: 'Básico', price: 0, isDefault: true, isSystem: true }
    })
  }
  console.log(`Using basic plan: ${basicPlan.name} (${basicPlan.id})`)

  // 2. Migrate existing subscriptions
  const subscriptions = await prisma.saasSubscription.findMany({
    where: { status: 'ACTIVE' },
    include: {
      plan: { include: { modules: { include: { module: true } } } }
    }
  })

  let migratedCount = 0
  for (const sub of subscriptions) {
    const companyId = sub.companyId
    const modules = sub.plan?.modules || []

    for (const pm of modules) {
      if (!pm.module || !pm.module.isActive) continue

      const existing = await prisma.saasModuleSubscription.findUnique({
        where: { companyId_moduleId: { companyId, moduleId: pm.moduleId } }
      })
      if (existing) continue

      await prisma.saasModuleSubscription.create({
        data: {
          companyId,
          moduleId: pm.moduleId,
          status: 'ACTIVE',
          period: sub.period || 'MONTHLY',
          startedAt: sub.startedAt || new Date(),
          nextDueAt: sub.nextDueAt || new Date()
        }
      })
    }

    // Update subscription to point to basic plan
    if (sub.planId !== basicPlan.id) {
      await prisma.saasSubscription.update({
        where: { id: sub.id },
        data: { planId: basicPlan.id }
      })
    }

    migratedCount++
  }

  // 3. Mark non-basic plans as inactive
  await prisma.saasPlan.updateMany({
    where: { NOT: { id: basicPlan.id } },
    data: { isActive: false }
  })

  // 4. Set basic plan as default and system
  await prisma.saasPlan.update({
    where: { id: basicPlan.id },
    data: { isDefault: true, isSystem: true }
  })

  console.log(`Migration complete: ${migratedCount} subscriptions migrated`)
  console.log('Old plans marked inactive. SaasPlanModule data preserved for rollback.')
}

migrate()
  .catch(e => { console.error('Migration failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
