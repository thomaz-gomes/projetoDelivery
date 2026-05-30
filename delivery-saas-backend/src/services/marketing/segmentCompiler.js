// Compiles a validated segment DSL rule tree into a SQL fragment.
// The fragment references `c.` (Customer) and is meant to be wrapped:
//   SELECT c.id FROM "Customer" c WHERE ... AND (<compiled>)
//
// All user-supplied values are validated/sanitized here (UUIDs by regex,
// numbers by Number(), strings by single-quote doubling) — no raw value
// is ever interpolated unchecked.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const COMPLETED_STATUSES =
  "('EM_PREPARO','PRONTO','SAIU_PARA_ENTREGA','CONFIRMACAO_PAGAMENTO','CONCLUIDO')"

export function parseDuration(value) {
  const m = /^(\d+)([hdwm])$/.exec(String(value))
  if (!m) throw new Error(`invalid duration: ${value}`)
  const n = Number(m[1])
  const unit = m[2]
  switch (unit) {
    case 'h':
      return `${n} hours`
    case 'd':
      return `${n} days`
    case 'w':
      return `${n * 7} days`
    case 'm':
      return `${n * 30} days` // approximation: 1m ≈ 30 days
    default:
      throw new Error(`invalid duration unit: ${unit}`)
  }
}

function escapeUuid(v) {
  const s = String(v)
  if (!UUID_REGEX.test(s)) throw new Error(`invalid uuid: ${v}`)
  return `'${s}'`
}

function escapeString(v) {
  return `'${String(v).replace(/'/g, "''")}'`
}

function safeNumber(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`invalid number: ${v}`)
  return n
}

function intervalOrDate(value) {
  // Returns SQL expression representing a moment in time relative to NOW().
  // Accepts duration like '30d' or an ISO date string.
  const s = String(value)
  if (/^(\d+)([hdwm])$/.test(s)) {
    return `NOW() - interval '${parseDuration(s)}'`
  }
  // ISO date — wrap as timestamp literal
  const t = Date.parse(s)
  if (!Number.isFinite(t)) throw new Error(`invalid date: ${value}`)
  return `TIMESTAMP '${new Date(t).toISOString()}'`
}

const HANDLERS = {
  lastOrderAt: (op, value) => {
    if (op === 'olderThan') {
      const cutoff = intervalOrDate(value)
      // Customer has at least one completed order, and NONE of them are newer than cutoff
      return (
        `(EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES})` +
        ` AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND o."createdAt" > ${cutoff}))`
      )
    }
    if (op === 'newerThan') {
      const cutoff = intervalOrDate(value)
      return `EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND o."createdAt" > ${cutoff})`
    }
    if (op === 'between') {
      const [lo, hi] = value
      const loExpr = intervalOrDate(lo)
      const hiExpr = intervalOrDate(hi)
      return (
        `EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} ` +
        `AND o."createdAt" BETWEEN ${loExpr} AND ${hiExpr})`
      )
    }
    throw new Error(`op ${op} not implemented for lastOrderAt`)
  },

  firstOrderAt: (op, value) => {
    // Subquery isolates the FIRST completed order's createdAt
    const firstAt = `(SELECT MIN(o."createdAt") FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES})`
    if (op === 'olderThan') {
      const cutoff = intervalOrDate(value)
      return `(${firstAt}) IS NOT NULL AND (${firstAt}) < ${cutoff}`
    }
    if (op === 'newerThan') {
      const cutoff = intervalOrDate(value)
      return `(${firstAt}) IS NOT NULL AND (${firstAt}) > ${cutoff}`
    }
    if (op === 'between') {
      const [lo, hi] = value
      return `(${firstAt}) BETWEEN ${intervalOrDate(lo)} AND ${intervalOrDate(hi)}`
    }
    throw new Error(`op ${op} not implemented for firstOrderAt`)
  },

  totalSpent: (op, value) => {
    const sub = `(SELECT COALESCE(SUM(o.total), 0) FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES})`
    return numericCompare(sub, op, value)
  },

  orderCount: (op, value) => {
    const sub = `(SELECT COUNT(*) FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES})`
    return numericCompare(sub, op, value)
  },

  avgTicket: (op, value) => {
    const sub = `(SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE COALESCE(SUM(o.total), 0) / COUNT(*) END FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES})`
    return numericCompare(sub, op, value)
  },

  orderedProductId: (op, value) => {
    const ids = value.map(escapeUuid).join(',')
    const exists = `EXISTS (SELECT 1 FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND oi."productId" IN (${ids}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },

  orderedCategoryId: (op, value) => {
    const ids = value.map(escapeUuid).join(',')
    const exists = `EXISTS (SELECT 1 FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" JOIN "Product" p ON p.id = oi."productId" WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND p."categoryId" IN (${ids}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },

  orderedMenuId: (op, value) => {
    // Matches customers who placed a completed order tied to the given menu.
    // Order.menuId is populated for direct cardápio orders AND for iFood
    // orders (via ApiIntegrationMenu default link → upsertOrder forcedMenuId),
    // so this filter naturally captures both channels.
    const ids = value.map(escapeUuid).join(',')
    const exists = `EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND o."menuId" IN (${ids}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },

  lastProductId: (op, value) => {
    // "lastProductId" = any item belonging to the customer's MOST RECENT completed order
    const ids = value.map(escapeUuid).join(',')
    const lastOrderId = `(SELECT o.id FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} ORDER BY o."createdAt" DESC LIMIT 1)`
    const exists = `EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = ${lastOrderId} AND oi."productId" IN (${ids}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },

  lastOrderTotal: (op, value) => {
    const sub = `(SELECT o.total FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} ORDER BY o."createdAt" DESC LIMIT 1)`
    return numericCompare(sub, op, value)
  },

  neighborhood: (op, value) => {
    const strs = value.map(escapeString).join(',')
    const exists = `EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o."deliveryNeighborhood" IN (${strs}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },

  paymentMethod: (op, value) => {
    // Payment method is stored inside Order.payload JSON.
    // V1 decision: match on payload->>'paymentMethod' OR payload->'payment'->>'method'
    // (covers both top-level legacy and nested structures observed in the codebase).
    const strs = value.map(escapeString).join(',')
    const exists =
      `EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} ` +
      `AND (o.payload->>'paymentMethod' IN (${strs}) OR o.payload->'payment'->>'method' IN (${strs})))`
    return op === 'in' ? exists : `NOT ${exists}`
  },

  birthdayInDays: (op, value) => {
    const n = safeNumber(value)
    if (!Number.isInteger(n)) throw new Error('birthdayInDays requires integer')
    if (op === '=') {
      return (
        `c.birthday IS NOT NULL ` +
        `AND EXTRACT(MONTH FROM c.birthday) = EXTRACT(MONTH FROM NOW() + interval '${n} days') ` +
        `AND EXTRACT(DAY FROM c.birthday) = EXTRACT(DAY FROM NOW() + interval '${n} days')`
      )
    }
    if (op === '<=') {
      // Birthday falls within next N days (using MONTH*100+DAY for ordering)
      return (
        `c.birthday IS NOT NULL AND ` +
        `((EXTRACT(MONTH FROM c.birthday) * 100 + EXTRACT(DAY FROM c.birthday)) ` +
        `BETWEEN (EXTRACT(MONTH FROM NOW()) * 100 + EXTRACT(DAY FROM NOW())) ` +
        `AND (EXTRACT(MONTH FROM NOW() + interval '${n} days') * 100 + EXTRACT(DAY FROM NOW() + interval '${n} days')))`
      )
    }
    throw new Error(`op ${op} not implemented for birthdayInDays`)
  },

  customerCreatedAt: (op, value) => {
    const cutoff = intervalOrDate(value)
    if (op === 'olderThan') return `c."createdAt" < ${cutoff}`
    if (op === 'newerThan') return `c."createdAt" > ${cutoff}`
    throw new Error(`op ${op} not implemented for customerCreatedAt`)
  },

  customerGroupId: (op, value) => {
    const ids = value.map(escapeUuid).join(',')
    const exists = `EXISTS (SELECT 1 FROM "CustomerGroupMember" cgm WHERE cgm."customerId" = c.id AND cgm."groupId" IN (${ids}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },

  customerId: (op, value) => {
    // Pins the segment to a fixed list of customers. Used by the "Criar
    // lista" action on the customers screen — operator picks N customers,
    // we persist a segment with `{ field: 'customerId', op: 'in', value: [ids] }`
    // so the rule survives and re-evaluates correctly if a campaign reuses it.
    const ids = value.map(escapeUuid).join(',')
    const cond = `c.id IN (${ids})`
    return op === 'in' ? cond : `NOT (${cond})`
  },

  cashbackBalance: (op, value) => {
    // CashbackWallet has `clientId` (not customerId) per schema
    const sub = `(SELECT COALESCE(SUM(cw.balance), 0) FROM "CashbackWallet" cw WHERE cw."clientId" = c.id)`
    return numericCompare(sub, op, value)
  },

  optInMarketing: (op, value) => {
    return `c."optInMarketing" = ${value ? 'true' : 'false'}`
  },

  optOutMarketingAt: (op) => {
    return op === 'isNull' ? `c."optOutMarketingAt" IS NULL` : `c."optOutMarketingAt" IS NOT NULL`
  },
}

function numericCompare(sub, op, value) {
  if (op === 'between') {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error('between requires [min, max]')
    }
    const lo = safeNumber(value[0])
    const hi = safeNumber(value[1])
    return `(${sub} >= ${lo} AND ${sub} <= ${hi})`
  }
  const allowed = ['>=', '>', '<=', '<', '=']
  if (!allowed.includes(op)) throw new Error(`unsupported numeric op: ${op}`)
  return `${sub} ${op} ${safeNumber(value)}`
}

export function compileRule(rule) {
  if (!rule || typeof rule !== 'object') throw new Error('rule must be object')
  if (Array.isArray(rule)) throw new Error('rule must be object, got array')

  if ('all' in rule) {
    if (!Array.isArray(rule.all) || rule.all.length === 0) throw new Error('all requires non-empty array')
    return `(${rule.all.map(compileRule).join(' AND ')})`
  }
  if ('any' in rule) {
    if (!Array.isArray(rule.any) || rule.any.length === 0) throw new Error('any requires non-empty array')
    return `(${rule.any.map(compileRule).join(' OR ')})`
  }
  if ('not' in rule) {
    return `NOT (${compileRule(rule.not)})`
  }

  const handler = HANDLERS[rule.field]
  if (!handler) throw new Error(`unknown field: ${rule.field}`)
  return handler(rule.op, rule.value)
}
