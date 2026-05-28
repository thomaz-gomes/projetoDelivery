// Declarative DSL validator for marketing segments.
// Validates a JSON rule tree against a strict field whitelist.
// Returns { ok: true } or { ok: false, error: string }.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DURATION_REGEX = /^\d+[hdwm]$/ // 30d, 2w, 6h, 3m (month, approx 30 days)
const MAX_DEPTH = 5

export const FIELD_SPECS = {
  lastOrderAt:       { ops: ['olderThan', 'newerThan', 'between'], valueType: 'duration_or_date' },
  firstOrderAt:      { ops: ['olderThan', 'newerThan', 'between'], valueType: 'duration_or_date' },
  totalSpent:        { ops: ['>=', '>', '<=', '<', 'between'],     valueType: 'number' },
  orderCount:        { ops: ['>=', '>', '<=', '<', 'between'],     valueType: 'number' },
  avgTicket:         { ops: ['>=', '>', '<=', '<', 'between'],     valueType: 'number' },
  orderedProductId:  { ops: ['in', 'notIn'],                       valueType: 'uuid_array' },
  orderedCategoryId: { ops: ['in', 'notIn'],                       valueType: 'uuid_array' },
  orderedMenuId:     { ops: ['in', 'notIn'],                       valueType: 'uuid_array' },
  lastProductId:     { ops: ['in', 'notIn'],                       valueType: 'uuid_array' },
  lastOrderTotal:    { ops: ['>=', '<=', 'between'],               valueType: 'number' },
  neighborhood:      { ops: ['in', 'notIn'],                       valueType: 'string_array' },
  paymentMethod:     { ops: ['in', 'notIn'],                       valueType: 'string_array' },
  birthdayInDays:    { ops: ['=', '<='],                           valueType: 'int' },
  customerCreatedAt: { ops: ['olderThan', 'newerThan'],            valueType: 'duration_or_date' },
  customerGroupId:   { ops: ['in', 'notIn'],                       valueType: 'uuid_array' },
  cashbackBalance:   { ops: ['>=', '<='],                          valueType: 'number' },
  optInMarketing:    { ops: ['='],                                  valueType: 'bool' },
  optOutMarketingAt: { ops: ['isNull', 'isNotNull'],               valueType: 'none' },
}

function isIsoParseable(v) {
  if (typeof v !== 'string') return false
  const t = Date.parse(v)
  return Number.isFinite(t)
}

function validateValue(valueType, op, value) {
  if (op === 'isNull' || op === 'isNotNull') {
    return value === undefined || value === null
      ? null
      : 'value must be omitted for isNull/isNotNull'
  }

  switch (valueType) {
    case 'number': {
      if (op === 'between') {
        if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
          return 'between requires [min, max] array of numbers'
        }
        return null
      }
      return typeof value === 'number' && Number.isFinite(value) ? null : 'value must be number'
    }
    case 'int': {
      return Number.isInteger(value) ? null : 'value must be integer'
    }
    case 'bool': {
      return typeof value === 'boolean' ? null : 'value must be boolean'
    }
    case 'uuid_array': {
      if (!Array.isArray(value) || value.length === 0) return 'value must be non-empty array'
      const bad = value.find((v) => !UUID_REGEX.test(String(v)))
      return bad ? `invalid uuid: ${bad}` : null
    }
    case 'string_array': {
      if (!Array.isArray(value) || value.length === 0) return 'value must be non-empty array'
      const allStrings = value.every((v) => typeof v === 'string' && v.length < 256)
      return allStrings ? null : 'array items must be strings (<256 chars)'
    }
    case 'duration_or_date': {
      if (op === 'between') {
        if (!Array.isArray(value) || value.length !== 2) {
          return 'between requires two values'
        }
        for (const v of value) {
          if (typeof v !== 'string') return 'between values must be strings'
          if (!DURATION_REGEX.test(v) && !isIsoParseable(v)) {
            return 'value must be duration (e.g. 30d) or ISO date'
          }
        }
        return null
      }
      if (typeof value !== 'string') return 'value must be string'
      if (DURATION_REGEX.test(value)) return null
      if (isIsoParseable(value)) return null
      return 'value must be duration (e.g. 30d) or ISO date'
    }
    case 'none': {
      return null
    }
    default:
      return 'unknown valueType'
  }
}

export function validateSegmentRule(rule, depth = 0) {
  if (depth > MAX_DEPTH) return { ok: false, error: 'max nesting depth exceeded' }
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return { ok: false, error: 'rule must be object' }
  }

  // Composables
  if ('all' in rule || 'any' in rule || 'not' in rule) {
    const key = 'all' in rule ? 'all' : 'any' in rule ? 'any' : 'not'
    const inner = rule[key]
    if (key === 'not') {
      if (!inner || typeof inner !== 'object') return { ok: false, error: 'not requires a rule' }
      return validateSegmentRule(inner, depth + 1)
    }
    if (!Array.isArray(inner) || inner.length === 0) {
      return { ok: false, error: `${key} requires non-empty array` }
    }
    for (const sub of inner) {
      const r = validateSegmentRule(sub, depth + 1)
      if (!r.ok) return r
    }
    return { ok: true }
  }

  // Leaf node
  if (!rule.field) return { ok: false, error: 'leaf requires field' }
  const spec = FIELD_SPECS[rule.field]
  if (!spec) return { ok: false, error: `unknown field: ${rule.field}` }
  if (!spec.ops.includes(rule.op)) {
    return { ok: false, error: `op ${rule.op} not valid for field ${rule.field}` }
  }
  const err = validateValue(spec.valueType, rule.op, rule.value)
  if (err) return { ok: false, error: err }
  return { ok: true }
}
