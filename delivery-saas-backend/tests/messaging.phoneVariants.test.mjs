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

test('phoneVariants: 13-digit input also emits no-DDI legacy forms', () => {
  // 5571999990000 → also 71999990000 (11) and 7199990000 (10)
  const v = phoneVariants('5571999990000')
  assert.ok(v.includes('71999990000'), 'expected 11-digit no-DDI variant')
  assert.ok(v.includes('7199990000'), 'expected 10-digit no-DDI variant')
})

test('phoneVariants: 12-digit input also emits no-DDI legacy forms', () => {
  // 557199990000 (no 9th digit) → also 5571999990000, 71999990000, 7199990000
  const v = phoneVariants('557199990000')
  assert.ok(v.includes('557199990000'), 'canonical 12-digit')
  assert.ok(v.includes('5571999990000'), 'with-9 13-digit form')
  assert.ok(v.includes('7199990000'), 'expected 10-digit no-DDI variant')
  assert.ok(v.includes('71999990000'), 'expected 11-digit no-DDI variant')
})
