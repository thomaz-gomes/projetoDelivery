import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSegmentRule, FIELD_SPECS } from '../src/services/marketing/segmentValidator.js'

test('accepts valid simple rule', () => {
  const r = validateSegmentRule({
    field: 'lastOrderAt',
    op: 'olderThan',
    value: '30d',
  })
  assert.equal(r.ok, true)
})

test('rejects unknown field', () => {
  const r = validateSegmentRule({
    field: 'nonExistent',
    op: '=',
    value: 'x',
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /unknown field/i)
})

test('rejects unknown op for field', () => {
  const r = validateSegmentRule({
    field: 'totalSpent',
    op: 'olderThan', // not valid for number
    value: 100,
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /op/i)
})

test('accepts nested all/any', () => {
  const r = validateSegmentRule({
    all: [
      { field: 'totalSpent', op: '>=', value: 100 },
      {
        any: [
          { field: 'orderedProductId', op: 'in', value: ['00000000-0000-0000-0000-000000000001'] },
        ],
      },
    ],
  })
  assert.equal(r.ok, true)
})

test('rejects invalid uuid in array value', () => {
  const r = validateSegmentRule({
    field: 'orderedProductId',
    op: 'in',
    value: ['not-a-uuid'],
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /uuid/i)
})

test('rejects invalid duration format', () => {
  const r = validateSegmentRule({
    field: 'lastOrderAt',
    op: 'olderThan',
    value: 'forever',
  })
  assert.equal(r.ok, false)
})

test('rejects deep nesting beyond 5 levels', () => {
  let inner = { field: 'totalSpent', op: '>=', value: 1 }
  for (let i = 0; i < 6; i++) inner = { all: [inner] }
  const r = validateSegmentRule(inner)
  assert.equal(r.ok, false)
})

test('FIELD_SPECS is exported with all 17 fields', () => {
  const expected = [
    'lastOrderAt', 'firstOrderAt', 'totalSpent', 'orderCount', 'avgTicket',
    'orderedProductId', 'orderedCategoryId', 'lastProductId', 'lastOrderTotal',
    'neighborhood', 'paymentMethod', 'birthdayInDays', 'customerCreatedAt',
    'customerGroupId', 'cashbackBalance', 'optInMarketing', 'optOutMarketingAt',
  ]
  for (const f of expected) assert.ok(FIELD_SPECS[f], `missing field ${f}`)
})
