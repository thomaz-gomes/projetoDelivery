import { prisma } from '../prisma.js'

/**
 * Aggregates yesterday's MenuEvent rows into MenuEventDailySummary
 * and deletes raw events older than 90 days.
 */
export async function aggregateMenuEvents() {
  const now = new Date()

  // Yesterday range (00:00:00 to 23:59:59)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const dayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0)
  const dayEnd = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999)

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
    console.log('[AggregateMenuEvents] No events to aggregate for', dayStart.toISOString().slice(0, 10))
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

  console.log(`[AggregateMenuEvents] Aggregated ${events.length} events into ${Object.keys(groups).length} summaries for ${dayStart.toISOString().slice(0, 10)}`)

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
