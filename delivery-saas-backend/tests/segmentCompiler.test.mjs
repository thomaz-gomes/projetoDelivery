import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileRule, parseDuration } from '../src/services/marketing/segmentCompiler.js'

test('parseDuration converts duration codes to interval strings', () => {
  assert.equal(parseDuration('30d'), '30 days')
  assert.equal(parseDuration('2w'), '14 days')
  assert.equal(parseDuration('6h'), '6 hours')
})

test('compileRule for totalSpent >= 100', () => {
  const sql = compileRule({ field: 'totalSpent', op: '>=', value: 100 })
  assert.match(sql, /COALESCE\(SUM\(o\.total\)/)
  assert.match(sql, />=\s*100/)
})

test('compileRule for lastOrderAt olderThan 30d', () => {
  const sql = compileRule({ field: 'lastOrderAt', op: 'olderThan', value: '30d' })
  assert.match(sql, /interval '30 days'/)
  assert.match(sql, /NOT EXISTS/)
})

test('compileRule for orderedProductId in [uuid]', () => {
  const sql = compileRule({
    field: 'orderedProductId',
    op: 'in',
    value: ['11111111-1111-1111-1111-111111111111'],
  })
  assert.match(sql, /EXISTS/)
  assert.match(sql, /'11111111-1111-1111-1111-111111111111'/)
})

test('compileRule for nested all (AND)', () => {
  const sql = compileRule({
    all: [
      { field: 'totalSpent', op: '>=', value: 50 },
      { field: 'orderCount', op: '>', value: 2 },
    ],
  })
  assert.match(sql, / AND /)
})

test('compileRule for any (OR)', () => {
  const sql = compileRule({
    any: [
      { field: 'totalSpent', op: '>=', value: 50 },
      { field: 'orderCount', op: '>', value: 2 },
    ],
  })
  assert.match(sql, / OR /)
})

test('compileRule for birthdayInDays = 0', () => {
  const sql = compileRule({ field: 'birthdayInDays', op: '=', value: 0 })
  assert.match(sql, /EXTRACT\(MONTH/)
  assert.match(sql, /interval '0 days'/)
})

test('compileRule rejects unknown field at compile time', () => {
  assert.throws(() => compileRule({ field: 'foo', op: '=', value: 1 }))
})

test('compileRule for not wraps with NOT', () => {
  const sql = compileRule({ not: { field: 'totalSpent', op: '>=', value: 50 } })
  assert.match(sql, /^NOT\s*\(/)
})

test('compileRule rejects invalid uuid in orderedProductId', () => {
  assert.throws(() =>
    compileRule({ field: 'orderedProductId', op: 'in', value: ['not-a-uuid'] }),
  )
})

test('compileRule escapes single quotes in neighborhood string', () => {
  const sql = compileRule({
    field: 'neighborhood',
    op: 'in',
    value: ["O'Higgins"],
  })
  // single quote should be doubled
  assert.match(sql, /'O''Higgins'/)
})

test('compileRule for optInMarketing = true', () => {
  const sql = compileRule({ field: 'optInMarketing', op: '=', value: true })
  assert.match(sql, /"optInMarketing"\s*=\s*true/)
})

test('compileRule for optOutMarketingAt isNull', () => {
  const sql = compileRule({ field: 'optOutMarketingAt', op: 'isNull' })
  assert.match(sql, /"optOutMarketingAt"\s+IS\s+NULL/)
})
