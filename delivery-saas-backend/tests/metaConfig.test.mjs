import { test } from 'node:test'
import assert from 'node:assert/strict'

test('mascaraSecret returns last 4', async () => {
  const { mascaraSecret } = await import('../src/services/metaConfig.js')
  assert.equal(mascaraSecret('abcdefghij'), '***ghij')
  assert.equal(mascaraSecret('abc'), '***abc')
  assert.equal(mascaraSecret(''), '')
  assert.equal(mascaraSecret(null), '')
})
