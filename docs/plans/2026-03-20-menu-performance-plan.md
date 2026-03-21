# Menu Performance (Desempenho do Cardápio) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a menu performance analytics dashboard with real-time funnel tracking (Visit → View → Cart → Checkout → Complete), sales metrics, and product ranking.

**Architecture:** Instrument PublicMenu.vue to emit behavioral events via batched POST requests. Store events in PostgreSQL (MenuEvent table, 90-day retention). Aggregate daily into MenuEventDailySummary. Admin dashboard queries summaries + recent events for charts and KPIs.

**Tech Stack:** Prisma (PostgreSQL), Express.js, Vue 3 (Composition API), Chart.js, node-cron, Bootstrap 5

---

### Task 1: Add Prisma Schema — MenuEvent & MenuEventDailySummary

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (add enum + 2 models at end of file)

**Step 1: Add the enum and models to schema.prisma**

Add at the end of the file (before any closing brace if present):

```prisma
enum MenuEventType {
  VISIT
  ITEM_VIEW
  ADD_TO_CART
  CHECKOUT_START
  ORDER_COMPLETE
}

model MenuEvent {
  id         String        @id @default(uuid())
  companyId  String
  company    Company       @relation(fields: [companyId], references: [id])
  menuId     String
  sessionId  String
  customerId String?
  eventType  MenuEventType
  productId  String?
  metadata   Json?
  createdAt  DateTime      @default(now())

  @@index([companyId, menuId, createdAt])
  @@index([companyId, menuId, eventType, createdAt])
  @@index([sessionId])
}

model MenuEventDailySummary {
  id              String   @id @default(uuid())
  companyId       String
  company         Company  @relation(fields: [companyId], references: [id])
  menuId          String
  date            DateTime @db.Date
  visits          Int      @default(0)
  itemViews       Int      @default(0)
  addToCarts      Int      @default(0)
  checkoutStarts  Int      @default(0)
  orderCompletes  Int      @default(0)
  uniqueCustomers Int      @default(0)
  newCustomers    Int      @default(0)
  totalRevenue    Decimal  @default(0)
  avgTicket       Decimal  @default(0)

  @@unique([companyId, menuId, date])
}
```

**Step 2: Add relations to Company model**

In the `Company` model, add these two relation fields alongside the existing relations:

```prisma
menuEvents             MenuEvent[]
menuEventDailySummaries MenuEventDailySummary[]
```

**Step 3: Push schema to database**

Run: `cd delivery-saas-backend && npx prisma db push`

Expected: Schema pushed successfully, no errors.

**Step 4: Generate Prisma client**

Run: `cd delivery-saas-backend && npx prisma generate`

Expected: Prisma Client generated successfully.

**Step 5: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat: add MenuEvent and MenuEventDailySummary schema models"
```

---

### Task 2: Backend — Public Tracking Endpoint

**Files:**
- Create: `delivery-saas-backend/src/routes/publicTracking.js`
- Modify: `delivery-saas-backend/src/index.js` (register route)

**Step 1: Create the tracking route**

Create `delivery-saas-backend/src/routes/publicTracking.js`:

```javascript
import express from 'express'
import { prisma } from '../prisma.js'

export const publicTrackingRouter = express.Router()

// POST /public/tracking/events — batch insert menu events (no auth required)
publicTrackingRouter.post('/events', async (req, res) => {
  try {
    const events = req.body.events
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ message: 'events array required' })
    }

    // Limit batch size to prevent abuse
    const batch = events.slice(0, 50)

    const validTypes = ['VISIT', 'ITEM_VIEW', 'ADD_TO_CART', 'CHECKOUT_START', 'ORDER_COMPLETE']

    const records = []
    for (const evt of batch) {
      if (!evt.menuId || !evt.sessionId || !evt.companyId || !validTypes.includes(evt.eventType)) continue
      records.push({
        companyId: evt.companyId,
        menuId: evt.menuId,
        sessionId: evt.sessionId,
        customerId: evt.customerId || null,
        eventType: evt.eventType,
        productId: evt.productId || null,
        metadata: evt.metadata || null,
      })
    }

    if (records.length > 0) {
      await prisma.menuEvent.createMany({ data: records })
    }

    res.json({ ok: true, count: records.length })
  } catch (e) {
    console.error('POST /public/tracking/events error:', e)
    res.status(500).json({ message: 'Erro ao registrar eventos' })
  }
})
```

**Step 2: Register route in index.js**

In `delivery-saas-backend/src/index.js`, add import near other public imports (around line 27):

```javascript
import { publicTrackingRouter } from './routes/publicTracking.js'
```

Add route registration near other `/public` routes (around line 225):

```javascript
app.use('/public/tracking', publicTrackingRouter)
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/publicTracking.js delivery-saas-backend/src/index.js
git commit -m "feat: add public tracking endpoint for menu events"
```

---

### Task 3: Backend — Daily Aggregation Job

**Files:**
- Create: `delivery-saas-backend/src/jobs/aggregateMenuEvents.js`
- Modify: `delivery-saas-backend/src/cron.js` (register cron)

**Step 1: Create the aggregation job**

Create `delivery-saas-backend/src/jobs/aggregateMenuEvents.js`:

```javascript
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
```

**Step 2: Register cron job in cron.js**

Add import at top of `delivery-saas-backend/src/cron.js`:

```javascript
import { aggregateMenuEvents } from './jobs/aggregateMenuEvents.js'
```

Add cron schedule at end of file (before the final console.log):

```javascript
/**
 * Agregação diária de eventos de menu: agrega os eventos do dia anterior
 * em resumos diários e remove eventos brutos com mais de 90 dias.
 */
cron.schedule('30 2 * * *', async () => {
  console.log('[Cron] Iniciando agregação de eventos de menu...')
  try {
    await aggregateMenuEvents()
    console.log('[Cron] Agregação de eventos de menu concluída')
  } catch (err) {
    console.error('[Cron] Erro na agregação de eventos de menu:', err)
  }
}, {
  timezone: 'America/Sao_Paulo',
})
```

Update the final console.log to include the new job.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/jobs/aggregateMenuEvents.js delivery-saas-backend/src/cron.js
git commit -m "feat: add daily menu event aggregation cron job"
```

---

### Task 4: Backend — Menu Performance Report Endpoint

**Files:**
- Create: `delivery-saas-backend/src/routes/reports/menuPerformance.js`
- Modify: `delivery-saas-backend/src/index.js` (register route)

**Step 1: Create the report route**

Create `delivery-saas-backend/src/routes/reports/menuPerformance.js`:

```javascript
import express from 'express'
import { prisma } from '../../prisma.js'
import { authMiddleware } from '../../auth.js'

const router = express.Router()
router.use(authMiddleware)

function parseDateRange(query) {
  const now = new Date()
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const from = query.dateFrom ? new Date(query.dateFrom) : sevenDaysAgo
  const to = query.dateTo ? new Date(query.dateTo) : new Date()
  to.setHours(23, 59, 59, 999)
  from.setHours(0, 0, 0, 0)
  return { from, to }
}

function getPreviousPeriod(from, to) {
  const diff = to.getTime() - from.getTime()
  const prevTo = new Date(from.getTime() - 1)
  prevTo.setHours(23, 59, 59, 999)
  const prevFrom = new Date(prevTo.getTime() - diff)
  prevFrom.setHours(0, 0, 0, 0)
  return { from: prevFrom, to: prevTo }
}

// GET /reports/menu-performance/funnel
router.get('/funnel', async (req, res) => {
  try {
    const { companyId } = req.user
    const { menuId } = req.query
    const { from, to } = parseDateRange(req.query)
    const prev = getPreviousPeriod(from, to)

    const where = { companyId, createdAt: { gte: from, lte: to } }
    if (menuId) where.menuId = menuId

    const prevWhere = { companyId, createdAt: { gte: prev.from, lte: prev.to } }
    if (menuId) prevWhere.menuId = menuId

    // Current period — count unique sessions per event type
    const [current, previous] = await Promise.all([
      prisma.menuEvent.groupBy({
        by: ['eventType'],
        where,
        _count: { sessionId: true },
      }),
      prisma.menuEvent.groupBy({
        by: ['eventType'],
        where: prevWhere,
        _count: { sessionId: true },
      }),
    ])

    const toMap = (rows) => {
      const m = {}
      for (const r of rows) m[r.eventType] = r._count.sessionId
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
    const { from, to } = parseDateRange(req.query)
    const prev = getPreviousPeriod(from, to)

    // Build order query
    const orderWhere = {
      companyId,
      status: 'CONCLUIDO',
      createdAt: { gte: from, lte: to },
    }
    if (menuId) {
      // Filter orders that have items from this menu's products
      const menuProducts = await prisma.product.findMany({
        where: { menuId },
        select: { name: true },
      })
      const productNames = menuProducts.map(p => p.name)
      orderWhere.items = { some: { name: { in: productNames } } }
    }

    const prevOrderWhere = { ...orderWhere, createdAt: { gte: prev.from, lte: prev.to } }

    const [orders, prevOrders] = await Promise.all([
      prisma.order.findMany({
        where: orderWhere,
        select: { id: true, total: true, createdAt: true, customerId: true },
      }),
      prisma.order.findMany({
        where: prevOrderWhere,
        select: { id: true, total: true, customerId: true },
      }),
    ])

    // New customers: first order ever in this period
    const customerIds = [...new Set(orders.filter(o => o.customerId).map(o => o.customerId))]
    let newCustomers = 0
    if (customerIds.length > 0) {
      const existingCustomers = await prisma.order.groupBy({
        by: ['customerId'],
        where: {
          companyId,
          customerId: { in: customerIds },
          status: 'CONCLUIDO',
          createdAt: { lt: from },
        },
        _count: true,
      })
      const existingSet = new Set(existingCustomers.map(c => c.customerId))
      newCustomers = customerIds.filter(id => !existingSet.has(id)).length
    }

    const totalSales = orders.length
    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total), 0)
    const avgTicket = totalSales > 0 ? totalRevenue / totalSales : 0

    const prevTotalSales = prevOrders.length
    const prevTotalRevenue = prevOrders.reduce((sum, o) => sum + Number(o.total), 0)
    const prevAvgTicket = prevTotalSales > 0 ? prevTotalRevenue / prevTotalSales : 0
    const prevCustomerIds = [...new Set(prevOrders.filter(o => o.customerId).map(o => o.customerId))]

    // Daily series for line chart
    const dailyMap = {}
    for (const o of orders) {
      const day = o.createdAt.toISOString().slice(0, 10)
      if (!dailyMap[day]) dailyMap[day] = { count: 0, revenue: 0 }
      dailyMap[day].count++
      dailyMap[day].revenue += Number(o.total)
    }

    const prevDailyMap = {}
    for (const o of prevOrders) {
      const day = o.createdAt.toISOString().slice(0, 10)
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
    const { from, to } = parseDateRange(req.query)

    const orderWhere = {
      companyId,
      status: 'CONCLUIDO',
      createdAt: { gte: from, lte: to },
    }

    const orders = await prisma.order.findMany({
      where: orderWhere,
      select: { createdAt: true },
    })

    // By hour (2h ranges)
    const byHour = Array(12).fill(0)
    const labels = []
    for (let i = 0; i < 24; i += 2) {
      labels.push(`${String(i).padStart(2, '0')}:00 - ${String(i + 2).padStart(2, '0')}:00`)
    }

    for (const o of orders) {
      const h = o.createdAt.getHours()
      byHour[Math.floor(h / 2)]++
    }

    // Best hour
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
    const { from, to } = parseDateRange(req.query)

    const orders = await prisma.order.findMany({
      where: { companyId, status: 'CONCLUIDO', createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
    })

    const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
    const data = Array(7).fill(0)

    for (const o of orders) {
      const dow = o.createdAt.getDay() // 0=Sun
      const idx = dow === 0 ? 6 : dow - 1 // Shift to Mon=0
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
    const { from, to } = parseDateRange(req.query)

    const orderWhere = {
      companyId,
      status: { not: 'CANCELADO' },
      createdAt: { gte: from, lte: to },
    }

    const orders = await prisma.order.findMany({
      where: orderWhere,
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
```

**Step 2: Register route in index.js**

Add import in `delivery-saas-backend/src/index.js` near the products report import:

```javascript
import menuPerformanceRouter from './routes/reports/menuPerformance.js'
```

Add route registration near line 270 (after products report):

```javascript
app.use('/reports/menu-performance', menuPerformanceRouter)
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/reports/menuPerformance.js delivery-saas-backend/src/index.js
git commit -m "feat: add menu performance report API endpoints"
```

---

### Task 5: Frontend — Tracking Service in PublicMenu

**Files:**
- Create: `delivery-saas-frontend/src/services/menuTracking.js`
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (instrument events)

**Step 1: Create tracking service**

Create `delivery-saas-frontend/src/services/menuTracking.js`:

```javascript
import api from '../api.js'

let buffer = []
let flushTimer = null
let sessionId = null

function getSessionId() {
  if (sessionId) return sessionId
  sessionId = sessionStorage.getItem('mt_session')
  if (!sessionId) {
    sessionId = crypto.randomUUID()
    sessionStorage.setItem('mt_session', sessionId)
  }
  return sessionId
}

export function trackMenuEvent(companyId, menuId, eventType, { productId, customerId, metadata } = {}) {
  buffer.push({
    companyId,
    menuId,
    sessionId: getSessionId(),
    eventType,
    productId: productId || null,
    customerId: customerId || null,
    metadata: metadata || null,
  })

  if (!flushTimer) {
    flushTimer = setTimeout(flushEvents, 10000) // 10s
  }
}

export async function flushEvents() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (buffer.length === 0) return

  const events = buffer.splice(0)
  try {
    await api.post('/public/tracking/events', { events })
  } catch (e) {
    // On failure, put events back for next flush
    buffer.unshift(...events)
    console.warn('[MenuTracking] flush failed, will retry', e)
  }
}

// Flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (buffer.length > 0) {
      const events = buffer.splice(0)
      const blob = new Blob([JSON.stringify({ events })], { type: 'application/json' })
      navigator.sendBeacon('/api/public/tracking/events', blob)
    }
  })
}
```

**Step 2: Instrument PublicMenu.vue**

Import at top of `<script setup>` (after existing imports):

```javascript
import { trackMenuEvent, flushEvents } from '../services/menuTracking.js'
```

Add VISIT event after menu data is loaded (around line 3505, in the mount section, after `const data = res.data || {}`):

```javascript
// Track visit
const visitKey = `mt_visited_${companyId}`
if (!sessionStorage.getItem(visitKey)) {
  trackMenuEvent(companyId, menuId?.value || data.menu?.id, 'VISIT')
  sessionStorage.setItem(visitKey, '1')
}
```

Add ITEM_VIEW in `openProductModal` function (around line 2514, inside the function after `selectedProduct.value = p`):

```javascript
trackMenuEvent(companyId, menuId?.value, 'ITEM_VIEW', { productId: p.id })
```

Add ADD_TO_CART in `addToCartWithOptions` function (around line 2491, at beginning of function):

```javascript
trackMenuEvent(companyId, menuId?.value, 'ADD_TO_CART', { productId: p.id })
```

Add CHECKOUT_START in `goToReview` function (around line 3402):

```javascript
trackMenuEvent(companyId, menuId?.value, 'CHECKOUT_START', { customerId: customer.value?.id })
```

Add ORDER_COMPLETE after successful order submission. Find `submitOrder` success handler and add:

```javascript
trackMenuEvent(companyId, menuId?.value, 'ORDER_COMPLETE', {
  customerId: customer.value?.id,
  metadata: { total: Number(cartTotal.value) }
})
flushEvents() // Flush immediately on order complete
```

Add flush on unmount:

```javascript
import { onBeforeUnmount } from 'vue'
onBeforeUnmount(() => { flushEvents() })
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/services/menuTracking.js delivery-saas-frontend/src/views/PublicMenu.vue
git commit -m "feat: instrument PublicMenu with menu event tracking"
```

---

### Task 6: Frontend — MenuPerformanceReport.vue Dashboard

**Files:**
- Create: `delivery-saas-frontend/src/views/reports/MenuPerformanceReport.vue`
- Modify: `delivery-saas-frontend/src/router.js` (add route)
- Modify: `delivery-saas-frontend/src/config/nav.js` (add nav item)

**Step 1: Create the report component**

Create `delivery-saas-frontend/src/views/reports/MenuPerformanceReport.vue`.

The component must follow these patterns (from existing codebase):
- Use `<script setup>` with Composition API
- Use `api` from `'../../api.js'` for HTTP calls (NOT fetch)
- Use Bootstrap 5 classes for layout
- Use `<SelectInput>` and `<TextInput>` wrappers where appropriate
- Use Chart.js for charts (already used in ProductsReport.vue)

**Component structure:**

```vue
<template>
  <div class="container-fluid py-3">
    <h4 class="mb-3">Desempenho do Cardápio</h4>

    <!-- Filters row -->
    <div class="card mb-4">
      <div class="card-body">
        <div class="row g-3 align-items-end">
          <!-- Menu selector -->
          <div class="col-md-3">
            <label class="form-label">Cardápio</label>
            <select class="form-select" v-model="filters.menuId">
              <option value="">Todos</option>
              <option v-for="store in stores" :key="store.id" disabled>{{ store.name }}</option>
              <template v-for="store in stores" :key="'m'+store.id">
                <option v-for="menu in store.menus" :key="menu.id" :value="menu.id">
                  &nbsp;&nbsp;{{ menu.name }}
                </option>
              </template>
            </select>
          </div>
          <!-- Period selector -->
          <div class="col-md-3">
            <label class="form-label">Período</label>
            <div class="btn-group w-100">
              <button v-for="p in periods" :key="p.key"
                class="btn btn-sm"
                :class="filters.period === p.key ? 'btn-danger' : 'btn-outline-secondary'"
                @click="setPeriod(p.key)">
                {{ p.label }}
              </button>
            </div>
          </div>
          <!-- Custom date range (visible when period === 'custom') -->
          <template v-if="filters.period === 'custom'">
            <div class="col-md-2">
              <label class="form-label">De</label>
              <input type="date" class="form-control" v-model="filters.dateFrom" />
            </div>
            <div class="col-md-2">
              <label class="form-label">Até</label>
              <input type="date" class="form-control" v-model="filters.dateTo" />
            </div>
          </template>
          <div class="col-md-2">
            <button class="btn btn-danger" @click="loadReport" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
              Gerar
            </button>
          </div>
        </div>
        <small class="text-muted mt-2 d-block" v-if="comparisonLabel">{{ comparisonLabel }}</small>
      </div>
    </div>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-danger"></div>
    </div>

    <template v-if="!loading && loaded">
      <!-- 1. Funnel -->
      <div class="card mb-4">
        <div class="card-header"><strong>Funil de Conversão</strong></div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col" v-for="(step, idx) in funnelSteps" :key="step.key">
              <div class="border rounded p-3 text-center position-relative">
                <small class="text-muted">{{ step.label }}</small>
                <h3 class="mb-0">{{ step.value }}</h3>
                <div class="mt-1">
                  <span :class="step.changeClass" style="font-size: 0.85rem;">
                    {{ step.changeIcon }} {{ step.changePercent }}
                  </span>
                </div>
                <div class="mt-2" style="height: 6px; background: #eee; border-radius: 3px;">
                  <div :style="{ width: step.barPercent + '%', height: '100%', background: '#e74c3c', borderRadius: '3px' }"></div>
                </div>
                <small class="text-muted">{{ step.barPercent }}%</small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Sales KPIs + Line chart -->
      <div class="card mb-4">
        <div class="card-header"><strong>Vendas</strong></div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-3" v-for="kpi in salesKpis" :key="kpi.label">
              <small class="text-muted">{{ kpi.label }}</small>
              <h5 class="mb-0">{{ kpi.value }}</h5>
              <small :class="kpi.changeClass">{{ kpi.changeIcon }} {{ kpi.changePercent }}</small>
            </div>
          </div>
          <canvas ref="salesChart" height="80"></canvas>
        </div>
      </div>

      <!-- 3 + 4: Hours + Days side by side -->
      <div class="row g-3 mb-4">
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header">
              <strong>Horários com mais vendas</strong>
              <div class="btn-group btn-group-sm ms-2">
                <button class="btn" :class="hourFilter === 'week' ? 'btn-danger' : 'btn-outline-secondary'" @click="hourFilter='week'">Durante a semana</button>
                <button class="btn" :class="hourFilter === 'weekend' ? 'btn-danger' : 'btn-outline-secondary'" @click="hourFilter='weekend'">Final de semana</button>
              </div>
            </div>
            <div class="card-body">
              <p class="mb-2">Melhor horário: <strong>{{ byHour.bestHour }}</strong> — {{ byHour.bestHourCount }} vendas</p>
              <canvas ref="hourChart" height="200"></canvas>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><strong>Dias com mais vendas</strong></div>
            <div class="card-body">
              <p class="mb-2">Melhor dia: <strong>{{ byWeekday.bestDay }}</strong> — {{ byWeekday.bestDayCount }} pedidos</p>
              <canvas ref="weekdayChart" height="200"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- 5. Product Ranking -->
      <div class="card mb-4">
        <div class="card-header"><strong>Ranking de Itens do Cardápio</strong></div>
        <div class="card-body p-0">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>#</th>
                <th>Produto</th>
                <th class="text-end">Qtd vendida</th>
                <th class="text-end">Receita</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in productRanking" :key="item.name">
                <td>{{ item.position }}</td>
                <td>{{ item.name }}</td>
                <td class="text-end">{{ item.quantity }}</td>
                <td class="text-end">R$ {{ item.revenue.toFixed(2) }}</td>
              </tr>
              <tr v-if="!productRanking.length">
                <td colspan="4" class="text-center text-muted py-3">Nenhum dado no período</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import api from '../../api.js'
import Chart from 'chart.js/auto'

// State
const loading = ref(false)
const loaded = ref(false)
const stores = ref([])
const hourFilter = ref('week')

const filters = ref({
  menuId: '',
  period: '7d',
  dateFrom: '',
  dateTo: '',
})

const periods = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: 'Últ. 7 dias' },
  { key: '30d', label: 'Últ. 30 dias' },
  { key: 'custom', label: 'Personalizado' },
]

// Data
const funnel = ref({ current: {}, previous: {} })
const sales = ref({ current: {}, previous: {} })
const byHour = ref({ labels: [], data: [], bestHour: '', bestHourCount: 0 })
const byWeekday = ref({ labels: [], data: [], bestDay: '', bestDayCount: 0 })
const productRanking = ref([])

// Chart refs
const salesChart = ref(null)
const hourChart = ref(null)
const weekdayChart = ref(null)
let salesChartInstance = null
let hourChartInstance = null
let weekdayChartInstance = null

const comparisonLabel = computed(() => {
  const days = filters.value.period === 'today' ? 1 : filters.value.period === '7d' ? 7 : filters.value.period === '30d' ? 30 : null
  if (!days) return ''
  return `Comparação com os ${days === 1 ? 'dia anterior' : `últimos ${days} dias anteriores`}`
})

function setPeriod(key) {
  filters.value.period = key
  if (key !== 'custom') {
    const now = new Date()
    const to = now.toISOString().slice(0, 10)
    let from
    if (key === 'today') from = to
    else if (key === '7d') { const d = new Date(now); d.setDate(d.getDate() - 7); from = d.toISOString().slice(0, 10) }
    else if (key === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30); from = d.toISOString().slice(0, 10) }
    filters.value.dateFrom = from
    filters.value.dateTo = to
  }
}

function pctChange(curr, prev) {
  if (!prev || prev === 0) return curr > 0 ? '+100%' : '0%'
  const pct = ((curr - prev) / prev * 100).toFixed(2)
  return (pct > 0 ? '+' : '') + pct + '%'
}

function changeClass(curr, prev) {
  if (curr >= prev) return 'text-success'
  return 'text-danger'
}

function changeIcon(curr, prev) {
  return curr >= prev ? '▲' : '▼'
}

const funnelSteps = computed(() => {
  const c = funnel.value.current || {}
  const p = funnel.value.previous || {}
  const steps = [
    { key: 'VISIT', label: 'Visitas' },
    { key: 'ITEM_VIEW', label: 'Visualizações' },
    { key: 'ADD_TO_CART', label: 'Carrinho' },
    { key: 'CHECKOUT_START', label: 'Revisão' },
    { key: 'ORDER_COMPLETE', label: 'Concluídos' },
  ]
  const maxVal = Math.max(...steps.map(s => c[s.key] || 0), 1)
  return steps.map(s => ({
    ...s,
    value: c[s.key] || 0,
    barPercent: Math.round(((c[s.key] || 0) / maxVal) * 100),
    changePercent: pctChange(c[s.key] || 0, p[s.key] || 0),
    changeClass: changeClass(c[s.key] || 0, p[s.key] || 0),
    changeIcon: changeIcon(c[s.key] || 0, p[s.key] || 0),
  }))
})

const salesKpis = computed(() => {
  const c = sales.value.current || {}
  const p = sales.value.previous || {}
  return [
    { label: 'Total de vendas', value: c.totalSales || 0, changePercent: pctChange(c.totalSales, p.totalSales), changeClass: changeClass(c.totalSales, p.totalSales), changeIcon: changeIcon(c.totalSales, p.totalSales) },
    { label: 'Valor total', value: 'R$ ' + (c.totalRevenue || 0).toFixed(2), changePercent: pctChange(c.totalRevenue, p.totalRevenue), changeClass: changeClass(c.totalRevenue, p.totalRevenue), changeIcon: changeIcon(c.totalRevenue, p.totalRevenue) },
    { label: 'Ticket médio', value: 'R$ ' + (c.avgTicket || 0).toFixed(2), changePercent: pctChange(c.avgTicket, p.avgTicket), changeClass: changeClass(c.avgTicket, p.avgTicket), changeIcon: changeIcon(c.avgTicket, p.avgTicket) },
    { label: 'Novos clientes', value: c.newCustomers || 0, changePercent: pctChange(c.newCustomers, p.newCustomers), changeClass: changeClass(c.newCustomers, p.newCustomers), changeIcon: changeIcon(c.newCustomers, p.newCustomers) },
  ]
})

async function loadReport() {
  loading.value = true
  const params = { dateFrom: filters.value.dateFrom, dateTo: filters.value.dateTo }
  if (filters.value.menuId) params.menuId = filters.value.menuId

  try {
    const [funnelRes, salesRes, hourRes, weekdayRes, rankingRes] = await Promise.all([
      api.get('/reports/menu-performance/funnel', { params }),
      api.get('/reports/menu-performance/sales', { params }),
      api.get('/reports/menu-performance/by-hour', { params }),
      api.get('/reports/menu-performance/by-weekday', { params }),
      api.get('/reports/menu-performance/product-ranking', { params }),
    ])

    funnel.value = funnelRes.data
    sales.value = salesRes.data
    byHour.value = hourRes.data
    byWeekday.value = weekdayRes.data
    productRanking.value = rankingRes.data

    loaded.value = true
    await nextTick()
    renderCharts()
  } catch (e) {
    console.error('Error loading report:', e)
  } finally {
    loading.value = false
  }
}

function renderCharts() {
  // Sales line chart
  if (salesChartInstance) salesChartInstance.destroy()
  if (salesChart.value) {
    const daily = sales.value.current?.daily || {}
    const prevDaily = sales.value.previous?.daily || {}
    const labels = Object.keys(daily).sort()
    const prevLabels = Object.keys(prevDaily).sort()
    salesChartInstance = new Chart(salesChart.value, {
      type: 'line',
      data: {
        labels: labels.map(d => d.slice(5)), // MM-DD
        datasets: [
          { label: 'Período atual', data: labels.map(d => daily[d]?.count || 0), borderColor: '#e74c3c', tension: 0.3, fill: false },
          { label: 'Período anterior', data: prevLabels.map(d => prevDaily[d]?.count || 0), borderColor: '#ccc', borderDash: [5, 5], tension: 0.3, fill: false },
        ],
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
    })
  }

  // Hour chart
  if (hourChartInstance) hourChartInstance.destroy()
  if (hourChart.value) {
    hourChartInstance = new Chart(hourChart.value, {
      type: 'bar',
      data: {
        labels: byHour.value.labels,
        datasets: [{ data: byHour.value.data, backgroundColor: '#e74c3c' }],
      },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } },
    })
  }

  // Weekday chart
  if (weekdayChartInstance) weekdayChartInstance.destroy()
  if (weekdayChart.value) {
    weekdayChartInstance = new Chart(weekdayChart.value, {
      type: 'bar',
      data: {
        labels: byWeekday.value.labels,
        datasets: [{ data: byWeekday.value.data, backgroundColor: '#e74c3c' }],
      },
      options: { responsive: true, plugins: { legend: { display: false } } },
    })
  }
}

onMounted(async () => {
  setPeriod('7d')
  try {
    const res = await api.get('/reports/menu-performance/menus')
    stores.value = res.data
  } catch (e) {
    console.error('Error loading menus:', e)
  }
  loadReport()
})
</script>
```

**Step 2: Add route in router.js**

In `delivery-saas-frontend/src/router.js`, add import near line 109 (after ProductsReport import):

```javascript
import MenuPerformanceReport from './views/reports/MenuPerformanceReport.vue';
```

Add route after line 238 (after ProductsReport route):

```javascript
,{ path: '/reports/menu-performance', component: MenuPerformanceReport, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } }
```

**Step 3: Add navigation item in nav.js**

In `delivery-saas-frontend/src/config/nav.js`, add after line 9 (after "Produtos mais vendidos"):

```javascript
{ name: 'Desempenho do Cardápio', to: '/reports/menu-performance', icon: 'bi bi-graph-up' },
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/reports/MenuPerformanceReport.vue delivery-saas-frontend/src/router.js delivery-saas-frontend/src/config/nav.js
git commit -m "feat: add menu performance report dashboard"
```

---

### Task 7: Verify & Test End-to-End

**Step 1: Start dev environment**

Run: `docker compose up -d`

**Step 2: Verify schema migration**

Run: `docker compose exec backend npx prisma db push`

**Step 3: Test tracking endpoint**

```bash
curl -X POST http://localhost:3000/public/tracking/events \
  -H "Content-Type: application/json" \
  -d '{"events":[{"companyId":"test","menuId":"test","sessionId":"abc","eventType":"VISIT"}]}'
```

Expected: `{"ok":true,"count":1}`

**Step 4: Open frontend and navigate to Relatórios → Desempenho do Cardápio**

Verify: page loads, filters work, no console errors.

**Step 5: Open a public menu page, browse products, add to cart**

Verify: events appear in MenuEvent table.

**Step 6: Commit any fixes**

```bash
git commit -m "fix: address issues from end-to-end testing"
```
