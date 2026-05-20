'use strict'
const test = require('node:test')
const assert = require('node:assert')
const router = require('./ifoodRouter')

function makePayload(extra = {}) {
  return {
    orderNumber: 'A1',
    kind: 'CONFIRMED',
    createdAt: Date.now(),  // fresh
    message: 'hi',
    ...extra,
  }
}

test('forwards a fresh, non-duplicate payload', () => {
  router._resetSentForTests()
  router.clearFailures()
  let forwarded = null
  const res = router.handleIncomingChat(makePayload(), {
    forwardToRenderer: (p) => { forwarded = p },
  })
  assert.strictEqual(res.action, 'forward')
  assert.ok(forwarded)
  assert.strictEqual(forwarded.orderNumber, 'A1')
})

test('drops stale payload and records a failure', () => {
  router._resetSentForTests()
  router.clearFailures()
  // CONFIRMED TTL is 10 min; 11 min old → stale
  const stale = makePayload({ createdAt: Date.now() - 11 * 60 * 1000 })
  let forwarded = false
  const res = router.handleIncomingChat(stale, {
    forwardToRenderer: () => { forwarded = true },
  })
  assert.strictEqual(res.action, 'drop')
  assert.strictEqual(res.reason, 'stale')
  assert.strictEqual(forwarded, false)
  assert.strictEqual(router.getFailures().length, 1)
})

test('drops already-sent (dedup hit) without recording failure', () => {
  router._resetSentForTests()
  router.clearFailures()
  const payload = makePayload()
  // Forward + mark as success → sent map updated
  const r1 = router.handleIncomingChat(payload, { forwardToRenderer: () => {} })
  router.handleSendResult({ key: r1.key, success: true })

  let forwarded = false
  const r2 = router.handleIncomingChat(payload, { forwardToRenderer: () => { forwarded = true } })
  assert.strictEqual(r2.action, 'drop')
  assert.strictEqual(r2.reason, 'already-sent')
  assert.strictEqual(forwarded, false)
  assert.strictEqual(router.getFailures().length, 0)
})

test('handleSendResult records failure on success=false', () => {
  router._resetSentForTests()
  router.clearFailures()
  router.handleSendResult({ success: false, orderNumber: 'X', kind: 'CONFIRMED', error: 'iframe missing' })
  const fails = router.getFailures()
  assert.strictEqual(fails.length, 1)
  assert.strictEqual(fails[0].error, 'iframe missing')
})
