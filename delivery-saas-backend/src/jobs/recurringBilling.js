import { prisma } from '../prisma.js'
import { getActiveGateway, getBillingMode } from '../services/paymentGateway/index.js'

/**
 * Daily job: generates invoices for subscriptions due today.
 * If billingMode is AUTO, creates invoice marked for auto-charge.
 * If MANUAL, creates invoice as PENDING for client to pay.
 */
export async function runRecurringBilling() {
  const today = new Date()
  today.setHours(23, 59, 59, 999)

  console.log(`[recurring-billing] Running for date <= ${today.toISOString().slice(0, 10)}`)

  let gatewayConfig = null
  try {
    const result = await getActiveGateway()
    gatewayConfig = result.config
  } catch {
    console.log('[recurring-billing] No active gateway, generating manual invoices only')
  }

  // 1. Plan subscriptions due
  const planSubs = await prisma.saasSubscription.findMany({
    where: { status: 'ACTIVE', nextDueAt: { lte: today } },
    include: { plan: true },
  })

  for (const sub of planSubs) {
    try {
      await generateInvoiceForPlan(sub, gatewayConfig)
    } catch (e) {
      console.error(`[recurring-billing] Plan invoice error for company ${sub.companyId}:`, e?.message)
    }
  }

  // 2. Module subscriptions due
  const moduleSubs = await prisma.saasModuleSubscription.findMany({
    where: { status: 'ACTIVE', nextDueAt: { lte: today } },
    include: { module: { include: { prices: true } } },
  })

  for (const ms of moduleSubs) {
    try {
      await generateInvoiceForModule(ms, gatewayConfig)
    } catch (e) {
      console.error(`[recurring-billing] Module invoice error for company ${ms.companyId}:`, e?.message)
    }
  }

  // 3. Check overdue invoices for suspension
  await checkOverdueInvoices()

  console.log('[recurring-billing] Done')
}

async function generateInvoiceForPlan(sub, gatewayConfig) {
  const now = new Date()
  const price = Number(sub.plan.price)
  if (price <= 0) {
    await prisma.saasSubscription.update({
      where: { id: sub.id },
      data: { nextDueAt: addMonth(now) },
    })
    return
  }

  const billingMode = gatewayConfig ? getBillingMode(gatewayConfig, 'plan') : 'MANUAL'
  const isAuto = billingMode === 'AUTO'

  const invoice = await prisma.saasInvoice.create({
    data: {
      subscriptionId: sub.id,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      amount: price,
      status: 'PENDING',
      dueDate: addDays(now, 5),
      autoCharge: isAuto,
      gatewayProvider: gatewayConfig?.provider || null,
      items: {
        create: [{
          type: 'PLAN',
          referenceId: sub.planId,
          description: `Plano ${sub.plan.name} - ${now.getMonth() + 1}/${now.getFullYear()}`,
          amount: price,
        }],
      },
    },
  })

  await prisma.saasSubscription.update({
    where: { id: sub.id },
    data: { nextDueAt: addMonth(now) },
  })

  console.log(`[recurring-billing] Plan invoice ${invoice.id} for company ${sub.companyId} (${billingMode})`)
}

async function generateInvoiceForModule(ms, gatewayConfig) {
  const now = new Date()
  const priceRecord = ms.module.prices.find(p => p.period === ms.period)
  if (!priceRecord) {
    console.warn(`[recurring-billing] No price for module ${ms.module.key} period ${ms.period}`)
    return
  }

  const price = Number(priceRecord.price)
  const billingMode = gatewayConfig ? getBillingMode(gatewayConfig, 'module') : 'MANUAL'
  const isAuto = billingMode === 'AUTO'

  const sub = await prisma.saasSubscription.findUnique({ where: { companyId: ms.companyId } })
  if (!sub) {
    console.warn(`[recurring-billing] No subscription for company ${ms.companyId}`)
    return
  }

  const invoice = await prisma.saasInvoice.create({
    data: {
      subscriptionId: sub.id,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      amount: price,
      status: 'PENDING',
      dueDate: addDays(now, 5),
      autoCharge: isAuto,
      gatewayProvider: gatewayConfig?.provider || null,
      items: {
        create: [{
          type: 'MODULE',
          referenceId: ms.moduleId,
          description: `Módulo ${ms.module.name} - ${ms.period === 'ANNUAL' ? 'Anual' : 'Mensal'}`,
          amount: price,
        }],
      },
    },
  })

  const nextDue = ms.period === 'ANNUAL' ? addYear(now) : addMonth(now)
  await prisma.saasModuleSubscription.update({
    where: { id: ms.id },
    data: { nextDueAt: nextDue },
  })

  console.log(`[recurring-billing] Module invoice ${invoice.id} for ${ms.module.name} (${billingMode})`)
}

async function checkOverdueInvoices() {
  const now = new Date()
  const threeDaysAgo = addDays(now, -3)
  const sevenDaysAgo = addDays(now, -7)

  // Mark OVERDUE (3+ days past due)
  const overdueResult = await prisma.saasInvoice.updateMany({
    where: { status: 'PENDING', dueDate: { lte: threeDaysAgo } },
    data: { status: 'OVERDUE' },
  })
  if (overdueResult.count) {
    console.log(`[recurring-billing] Marked ${overdueResult.count} invoices as OVERDUE`)
  }

  // Suspend module subscriptions (7+ days overdue)
  const overdue7 = await prisma.saasInvoice.findMany({
    where: { status: 'OVERDUE', dueDate: { lte: sevenDaysAgo } },
    include: { items: true, subscription: { select: { companyId: true } } },
  })

  for (const inv of overdue7) {
    for (const item of inv.items) {
      if (item.type === 'MODULE') {
        await prisma.saasModuleSubscription.updateMany({
          where: { moduleId: item.referenceId, companyId: inv.subscription.companyId, status: 'ACTIVE' },
          data: { status: 'SUSPENDED' },
        })
        console.log(`[recurring-billing] Suspended module ${item.referenceId} for company ${inv.subscription.companyId}`)
      }
    }
  }
}

function addMonth(date) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + 1)
  return d
}

function addYear(date) {
  const d = new Date(date)
  d.setFullYear(d.getFullYear() + 1)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}
