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

test('drops in-flight duplicate before handleSendResult is called', () => {
  router._resetSentForTests()
  router.clearFailures()
  const payload = makePayload({ orderNumber: 'B1', kind: 'DISPATCHED' })

  // Primeira emissão: vai pra fila do renderer e fica in-flight.
  let forwardCount = 0
  const r1 = router.handleIncomingChat(payload, {
    forwardToRenderer: () => { forwardCount++ },
  })
  assert.strictEqual(r1.action, 'forward')
  assert.strictEqual(forwardCount, 1)

  // Segunda emissão CHEGA antes do handleSendResult — deve cair como in-flight,
  // sem chamar forwardToRenderer de novo.
  const r2 = router.handleIncomingChat(payload, {
    forwardToRenderer: () => { forwardCount++ },
  })
  assert.strictEqual(r2.action, 'drop')
  assert.strictEqual(r2.reason, 'in-flight')
  assert.strictEqual(forwardCount, 1)

  // Após handleSendResult com sucesso, vira already-sent.
  router.handleSendResult({ key: r1.key, success: true })
  const r3 = router.handleIncomingChat(payload, {
    forwardToRenderer: () => { forwardCount++ },
  })
  assert.strictEqual(r3.action, 'drop')
  assert.strictEqual(r3.reason, 'already-sent')
  assert.strictEqual(forwardCount, 1)
})

test('in-flight is cleared on failure so retry is allowed', () => {
  router._resetSentForTests()
  router.clearFailures()
  const payload = makePayload({ orderNumber: 'C1', kind: 'DISPATCHED' })

  let forwardCount = 0
  const r1 = router.handleIncomingChat(payload, {
    forwardToRenderer: () => { forwardCount++ },
  })
  assert.strictEqual(r1.action, 'forward')

  // Falha no envio → in-flight liberado, sent NÃO marcado.
  router.handleSendResult({ key: r1.key, success: false, error: 'tab missing' })

  // Próxima emissão deve passar normalmente — não é dedup nem in-flight.
  const r2 = router.handleIncomingChat(payload, {
    forwardToRenderer: () => { forwardCount++ },
  })
  assert.strictEqual(r2.action, 'forward')
  assert.strictEqual(forwardCount, 2)
})
