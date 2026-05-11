import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phoneVariants, normalizePhone } from '../src/messaging/phoneVariants.js'

test('phoneVariants: generates variants with and without 9', () => {
  const v = phoneVariants('5571999990000')
  assert.ok(v.includes('5571999990000'))
  assert.ok(v.includes('557199990000'))
})

test('normalizePhone: prepends 55 if missing', () => {
  assert.equal(normalizePhone('71999990000'), '5571999990000')
})

test('normalizePhone: idempotent when already normalized', () => {
  assert.equal(normalizePhone('5571999990000'), '5571999990000')
})
