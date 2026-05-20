const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isStale, dedupKey, KIND_TTL_MS } = require('./ttlDedupe')

test('isStale: CONFIRMED com idade > 10min é stale', () => {
  const now = Date.now()
  const stale = { kind: 'CONFIRMED', createdAt: now - 11 * 60 * 1000 }
  const fresh = { kind: 'CONFIRMED', createdAt: now - 5 * 60 * 1000 }
  assert.equal(isStale(stale), true)
  assert.equal(isStale(fresh), false)
})

test('isStale: DELIVERED com idade > 2h é stale', () => {
  const now = Date.now()
  const stale = { kind: 'DELIVERED', createdAt: now - 3 * 60 * 60 * 1000 }
  const fresh = { kind: 'DELIVERED', createdAt: now - 1 * 60 * 60 * 1000 }
  assert.equal(isStale(stale), true)
  assert.equal(isStale(fresh), false)
})

test('isStale: sem createdAt retorna false (não descarta)', () => {
  assert.equal(isStale({ kind: 'CONFIRMED' }), false)
  assert.equal(isStale(null), false)
})

test('dedupKey: combina orderId + kind', () => {
  assert.equal(dedupKey({ orderId: '123', kind: 'CONFIRMED' }), '123:CONFIRMED')
})

test('dedupKey: fallback para orderNumber quando orderId ausente', () => {
  assert.equal(dedupKey({ orderNumber: '999', kind: 'DISPATCHED' }), '999:DISPATCHED')
})

test('dedupKey: null quando sem id nenhum', () => {
  assert.equal(dedupKey({ kind: 'CONFIRMED' }), null)
})

test('KIND_TTL_MS: valores corretos', () => {
  assert.equal(KIND_TTL_MS.CONFIRMED, 10 * 60 * 1000)
  assert.equal(KIND_TTL_MS.DISPATCHED, 30 * 60 * 1000)
  assert.equal(KIND_TTL_MS.DELIVERED, 2 * 60 * 60 * 1000)
})
