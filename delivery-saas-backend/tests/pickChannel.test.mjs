import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickConnectedChannel } from '../src/services/whatsapp/pickChannel.js'

test('pickConnectedChannel exports a function', () => {
  assert.equal(typeof pickConnectedChannel, 'function')
})

test('returns null when companyId is missing', async () => {
  assert.equal(await pickConnectedChannel({}), null)
  assert.equal(await pickConnectedChannel({ companyId: null }), null)
})

test('returns null when nothing is configured', async () => {
  // Random UUID that doesn't exist in DB
  const result = await pickConnectedChannel({
    companyId: '00000000-0000-0000-0000-000000000000',
  })
  assert.equal(result, null)
})
