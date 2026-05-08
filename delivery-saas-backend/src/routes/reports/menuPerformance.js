import express from 'express'
import { prisma } from '../../prisma.js'
import { authMiddleware } from '../../auth.js'
import {
  startOfDayInTz, endOfDayInTz, dayKeyInTz, hourInTz, weekdayInTz, previousPeriod,
} from '../../utils/dateTz.js'

const router = express.Router()
router.use(authMiddleware)

const DEFAULT_TZ = 'America/Sao_Paulo'

async function getCompanyTimezone(companyId) {
  try {
    const c = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
    return c?.timezone || DEFAULT_TZ
  } catch (e) {
    return DEFAULT_TZ
  }
}

function parseDateRange(query, tz) {
  const todayKey = dayKeyInTz(new Date(), tz)
  // Default: last 7 days through today (in the company's tz)
  const sevenDaysAgo = new Date(startOfDayInTz(todayKey, tz).getTime() - 7 * 24 * 60 * 60 * 1000)
  const defaultFromKey = dayKeyInTz(sevenDaysAgo, tz)
  const fromStr = String(query.dateFrom || defaultFromKey)
  const toStr = String(query.dateTo || todayKey)
  return { from: startOfDayInTz(fromStr, tz), to: endOfDayInTz(toStr, tz) }
}

async function resolveStoreId(menuId) {
  if (!menuId) return undefined
  const menu = await prisma.menu.findUnique({ where: { id: menuId }, select: { storeId: true } })
  return menu?.storeId || undefined
}

function getPreviousPeriod(from, to) {
  return previousPeriod(from, to)
}

// GET /reports/menu-performance/funnel
router.get('/funnel', async (req, res) => {
  try {
    const { companyId } = req.user
    const { menuId } = req.query
    const tz = await getCompanyTimezone(companyId)
    const { from, to } = parseDateRange(req.query, tz)
    const prev = getPreviousPeriod(from, to)

    const where = { companyId, createdAt: { gte: from, lte: to } }
    if (menuId) where.menuId = menuId

    const prevWhere = { companyId, createdAt: { gte: prev.from, lte: prev.to } }
    if (menuId) prevWhere.menuId = menuId

    // Count DISTINCT sessions per event type (not total events)
    const buildQuery = (w) => {
      const params = [w.companyId, w.createdAt.gte, w.createdAt.lte]
      let sql = `SELECT "eventType", COUNT(DISTINCT "sessionId") as count FROM "MenuEvent" WHERE "companyId" = $1 AND "createdAt" >= $2 AND "createdAt" <= $3`
      if (w.menuId) { sql += ` AND "menuId" = $${params.length + 1}`; params.push(w.menuId) }
      sql += ` GROUP BY "eventType"`
      return prisma.$queryRawUnsafe(sql, ...params)
    }

    const [current, previous] = await Promise.all([
      buildQuery(where),
      buildQuery(prevWhere),
    ])

    const toMap = (rows) => {
      const m = {}
      for (const r of rows) m[r.eventType] = Number(r.count)
      return m
    }

    res.json({ current: toMap(current), previous: toMap(previous) })
  } catch (e) {
    console.error('GET /reports/menu-performance/funnel error:', e)
    res.status(500).json({ message: 'Erro ao buscar funil' })
  }
})

// GET /reports/menu-performance/sales
router.get('/sales', async (req, res) => {
  try {
    const { companyId } = req.user
    const { menuId } = req.query
    const tz = await getCompanyTimezone(companyId)
    const { from, to } = parseDateRange(req.query, tz)
    const prev = getPreviousPeriod(from, to)

    const storeId = await resolveStoreId(menuId)

    const orderWhere = {
      companyId,
      status: { not: 'CANCELADO' },
      createdAt: { gte: from, lte: to },
    }
    if (storeId) orderWhere.storeId = storeId

    const prevOrderWhere = {
      companyId,
      status: { not: 'CANCELADO' },
      createdAt: { gte: prev.from, lte: prev.to },
    }
    if (storeId) prevOrderWhere.storeId = storeId

    const [orders, prevOrders] = await Promise.all([
      prisma.order.findMany({
        where: orderWhere,
        select: { id: true, total: true, createdAt: true, customerId: true },
      }),
      prisma.order.findMany({
        where: prevOrderWhere,
        select: { id: true, total: true, createdAt: true, customerId: true },
      }),
    ])

    // New customers: first order ever in this period
    const customerIds = [...new Set(orders.filter(o => o.customerId).map(o => o.customerId))]
    let newCustomers = 0
    if (customerIds.length > 0) {
      const existing = await prisma.order.findMany({
        where: {
          companyId,
          customerId: { in: customerIds },
          status: { not: 'CANCELADO' },
          createdAt: { lt: from },
        },
        select: { customerId: true },
        distinct: ['customerId'],
      })
      const existingSet = new Set(existing.map(c => c.customerId))
      newCustomers = customerIds.filter(id => !existingSet.has(id)).length
    }

    const totalSales = orders.length
    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total), 0)
    const avgTicket = totalSales > 0 ? totalRevenue / totalSales : 0

    const prevTotalSales = prevOrders.length
    const prevTotalRevenue = prevOrders.reduce((sum, o) => sum + Number(o.total), 0)
    const prevAvgTicket = prevTotalSales > 0 ? prevTotalRevenue / prevTotalSales : 0
    const prevCustomerIds = [...new Set(prevOrders.filter(o => o.customerId).map(o => o.customerId))]

    // Daily series for line chart (grouped by company timezone calendar day)
    const dailyMap = {}
    for (const o of orders) {
      const day = dayKeyInTz(o.createdAt, tz)
      if (!dailyMap[day]) dailyMap[day] = { count: 0, revenue: 0 }
      dailyMap[day].count++
      dailyMap[day].revenue += Number(o.total)
    }

    const prevDailyMap = {}
    for (const o of prevOrders) {
      const day = dayKeyInTz(o.createdAt, tz)
      if (!prevDailyMap[day]) prevDailyMap[day] = { count: 0, revenue: 0 }
      prevDailyMap[day].count++
      prevDailyMap[day].revenue += Number(o.total)
    }

    res.json({
      current: { totalSales, totalRevenue, avgTicket, newCustomers, daily: dailyMap },
      previous: { totalSales: prevTotalSales, totalRevenue: prevTotalRevenue, avgTicket: prevAvgTicket, newCustomers: prevCustomerIds.length, daily: prevDailyMap },
    })
  } catch (e) {
    console.error('GET /reports/menu-performance/sales error:', e)
    res.status(500).json({ message: 'Erro ao buscar vendas' })
  }
})

// GET /reports/menu-performance/by-hour
router.get('/by-hour', async (req, res) => {
  try {
    const { companyId } = req.user
    const { menuId } = req.query
    const tz = await getCompanyTimezone(companyId)
    const { from, to } = parseDateRange(req.query, tz)
    const storeId = await resolveStoreId(menuId)

    const where = { companyId, status: { not: 'CANCELADO' }, createdAt: { gte: from, lte: to } }
    if (storeId) where.storeId = storeId

    const orders = await prisma.order.findMany({
      where,
      select: { createdAt: true },
    })

    const byHour = Array(12).fill(0)
    const labels = []
    for (let i = 0; i < 24; i += 2) {
      labels.push(`${String(i).padStart(2, '0')}:00 - ${String(i + 2).padStart(2, '0')}:00`)
    }

    for (const o of orders) {
      const h = hourInTz(o.createdAt, tz)
      byHour[Math.floor(h / 2)]++
    }

    const maxIdx = byHour.indexOf(Math.max(...byHour))

    res.json({ labels, data: byHour, bestHour: labels[maxIdx], bestHourCount: byHour[maxIdx] })
  } catch (e) {
    console.error('GET /reports/menu-performance/by-hour error:', e)
    res.status(500).json({ message: 'Erro ao buscar vendas por hora' })
  }
})

// GET /reports/menu-performance/by-weekday
router.get('/by-weekday', async (req, res) => {
  try {
    const { companyId } = req.user
    const { menuId } = req.query
    const tz = await getCompanyTimezone(companyId)
    const { from, to } = parseDateRange(req.query, tz)
    const storeId = await resolveStoreId(menuId)

    const where = { companyId, status: { not: 'CANCELADO' }, createdAt: { gte: from, lte: to } }
    if (storeId) where.storeId = storeId

    const orders = await prisma.order.findMany({
      where,
      select: { createdAt: true },
    })

    const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
    const data = Array(7).fill(0)

    for (const o of orders) {
      const dow = weekdayInTz(o.createdAt, tz)
      const idx = dow === 0 ? 6 : dow - 1
      data[idx]++
    }

    const maxIdx = data.indexOf(Math.max(...data))

    res.json({ labels, data, bestDay: labels[maxIdx], bestDayCount: data[maxIdx] })
  } catch (e) {
    console.error('GET /reports/menu-performance/by-weekday error:', e)
    res.status(500).json({ message: 'Erro ao buscar vendas por dia da semana' })
  }
})

// GET /reports/menu-performance/product-ranking
router.get('/product-ranking', async (req, res) => {
  try {
    const { companyId } = req.user
    const { menuId } = req.query
    const tz = await getCompanyTimezone(companyId)
    const { from, to } = parseDateRange(req.query, tz)
    const storeId = await resolveStoreId(menuId)

    const where = { companyId, status: { not: 'CANCELADO' }, createdAt: { gte: from, lte: to } }
    if (storeId) where.storeId = storeId

    const orders = await prisma.order.findMany({
      where,
      select: { id: true },
    })

    if (!orders.length) return res.json([])

    const orderIds = orders.map(o => o.id)
    const items = await prisma.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { name: true, price: true, quantity: true },
    })

    const grouped = {}
    for (const item of items) {
      if (!grouped[item.name]) grouped[item.name] = { name: item.name, quantity: 0, revenue: 0 }
      grouped[item.name].quantity += Number(item.quantity)
      grouped[item.name].revenue += Number(item.price) * Number(item.quantity)
    }

    const result = Object.values(grouped)
      .sort((a, b) => b.quantity - a.quantity)
      .map((item, idx) => ({ ...item, position: idx + 1 }))

    res.json(result)
  } catch (e) {
    console.error('GET /reports/menu-performance/product-ranking error:', e)
    res.status(500).json({ message: 'Erro ao buscar ranking de produtos' })
  }
})

// GET /reports/menu-performance/menus — list menus for filter dropdown
router.get('/menus', async (req, res) => {
  try {
    const { companyId } = req.user
    const stores = await prisma.store.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        menus: { select: { id: true, name: true } },
      },
    })
    res.json(stores)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar menus' })
  }
})

export default router
