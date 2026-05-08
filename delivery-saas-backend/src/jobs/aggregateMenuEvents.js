import { prisma } from '../prisma.js'
import { dayKeyInTz, startOfDayInTz, endOfDayInTz } from '../utils/dateTz.js'

// Cron trigger runs in BRT (see cron.js), so "yesterday" must be the BRT
// calendar day. With container UTC, plain Date math placed events from
// 21:00–23:59 BRT into the next-day bucket and missed the last 3h of the
// real BRT day. The job stays system-wide (one run for all companies);
// per-company timezones could be added later if a non-Brazilian merchant
// onboards.
const JOB_TZ = 'America/Sao_Paulo'

/**
 * Aggregates yesterday's MenuEvent rows into MenuEventDailySummary
 * and deletes raw events older than 90 days.
 */
export async function aggregateMenuEvents() {
  const now = new Date()

  // Yesterday in JOB_TZ — 00:00 to 23:59:59.999 of the BRT calendar day.
  const todayKey = dayKeyInTz(now, JOB_TZ)
  const yesterdayKey = dayKeyInTz(new Date(startOfDayInTz(todayKey, JOB_TZ).getTime() - 1), JOB_TZ)
  const dayStart = startOfDayInTz(yesterdayKey, JOB_TZ)
  const dayEnd = endOfDayInTz(yesterdayKey, JOB_TZ)

  // Fetch yesterday's events grouped by company + menu
  const events = await prisma.menuEvent.findMany({
    where: { createdAt: { gte: dayStart, lte: dayEnd } },
    select: {
      companyId: true,
      menuId: true,
      eventType: true,
      sessionId: true,
      customerId: true,
      metadata: true,
    },
  })

  if (events.length === 0) {
    console.log('[AggregateMenuEvents] No events to aggregate for', yesterdayKey)
    return
  }

  // Group by companyId + menuId
  const groups = {}
  for (const evt of events) {
    const key = `${evt.companyId}|${evt.menuId}`
    if (!groups[key]) {
      groups[key] = {
        companyId: evt.companyId,
        menuId: evt.menuId,
        sessions: new Set(),
        customers: new Set(),
        visits: 0,
        itemViews: 0,
        addToCarts: 0,
        checkoutStarts: 0,
        orderCompletes: 0,
        totalRevenue: 0,
      }
    }
    const g = groups[key]
    g.sessions.add(evt.sessionId)
    if (evt.customerId) g.customers.add(evt.customerId)

    switch (evt.eventType) {
      case 'VISIT': g.visits++; break
      case 'ITEM_VIEW': g.itemViews++; break
      case 'ADD_TO_CART': g.addToCarts++; break
      case 'CHECKOUT_START': g.checkoutStarts++; break
      case 'ORDER_COMPLETE':
        g.orderCompletes++
        if (evt.metadata?.total) g.totalRevenue += Number(evt.metadata.total)
        break
    }
  }

  // Upsert summaries
  for (const g of Object.values(groups)) {
    const avgTicket = g.orderCompletes > 0 ? g.totalRevenue / g.orderCompletes : 0

    await prisma.menuEventDailySummary.upsert({
      where: {
        companyId_menuId_date: {
          companyId: g.companyId,
          menuId: g.menuId,
          date: dayStart,
        },
      },
      update: {
        visits: g.sessions.size,
        itemViews: g.itemViews,
        addToCarts: g.addToCarts,
        checkoutStarts: g.checkoutStarts,
        orderCompletes: g.orderCompletes,
        uniqueCustomers: g.customers.size,
        totalRevenue: g.totalRevenue,
        avgTicket: avgTicket,
      },
      create: {
        companyId: g.companyId,
        menuId: g.menuId,
        date: dayStart,
        visits: g.sessions.size,
        itemViews: g.itemViews,
        addToCarts: g.addToCarts,
        checkoutStarts: g.checkoutStarts,
        orderCompletes: g.orderCompletes,
        uniqueCustomers: g.customers.size,
        totalRevenue: g.totalRevenue,
        avgTicket: avgTicket,
      },
    })
  }

  console.log(`[AggregateMenuEvents] Aggregated ${events.length} events into ${Object.keys(groups).length} summaries for ${yesterdayKey}`)

  // Delete events older than 90 days
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - 90)

  const deleted = await prisma.menuEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })

  if (deleted.count > 0) {
    console.log(`[AggregateMenuEvents] Deleted ${deleted.count} events older than 90 days`)
  }
}
