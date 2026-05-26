// tests/optInOptOut.test.mjs
//
// Pure-logic tests for isOptOutMessage — no DB required, so they can run
// in CI without a Postgres instance. The DB-dependent helpers
// (maybeAutoOptIn / maybeAutoOptOut) are exercised via integration tests
// against the inbound pipeline.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOptOutMessage } from '../src/services/marketing/optInOptOut.js'

test('isOptOutMessage detects PARAR', () => {
  assert.equal(isOptOutMessage('PARAR'), true)
  assert.equal(isOptOutMessage(' parar '), true)
  assert.equal(isOptOutMessage('Parar'), true)
})

test('isOptOutMessage ignores normal messages', () => {
  assert.equal(isOptOutMessage('Olá, quero pedir'), false)
  assert.equal(isOptOutMessage(''), false)
  assert.equal(isOptOutMessage(null), false)
})

test('isOptOutMessage detects all variants', () => {
  for (const kw of ['STOP', 'SAIR', 'CANCELAR', 'DESCADASTRAR', 'PARE']) {
    assert.equal(isOptOutMessage(kw), true, `expected ${kw} to opt-out`)
  }
})
