const { test } = require('node:test')
const assert = require('node:assert/strict')
const failures = require('./failures')

test('record adds entry and list returns a copy', () => {
  failures.clear()
  failures.record({ orderNumber: '123', error: 'boom' })
  const items = failures.list()
  assert.strictEqual(items.length, 1)
  assert.strictEqual(items[0].orderNumber, '123')
  // list() returns a copy — mutating it must not affect internal state
  items.push({ fake: true })
  assert.strictEqual(failures.count(), 1)
})

test('caps at MAX_FAILURES and drops oldest', () => {
  failures.clear()
  for (let i = 0; i < 55; i++) failures.record({ i })
  assert.strictEqual(failures.count(), 50)
  const items = failures.list()
  // oldest dropped → first remaining is i=5, last is i=54
  assert.strictEqual(items[0].i, 5)
  assert.strictEqual(items[items.length - 1].i, 54)
})

test('clear empties the list', () => {
  failures.record({ x: 1 })
  failures.record({ x: 2 })
  failures.clear()
  assert.strictEqual(failures.count(), 0)
  assert.deepStrictEqual(failures.list(), [])
})
