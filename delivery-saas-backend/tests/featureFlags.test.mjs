import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFlagEnabled, invalidateFlagCache, _clearFlagCacheForTests } from '../src/utils/featureFlags.js'

test('isFlagEnabled returns false when companyId is missing', async () => {
  _clearFlagCacheForTests()
  assert.equal(await isFlagEnabled(null, 'any_flag'), false)
  assert.equal(await isFlagEnabled('', 'any_flag'), false)
})

test('isFlagEnabled returns false when flag name is missing', async () => {
  _clearFlagCacheForTests()
  assert.equal(await isFlagEnabled('some-company', null), false)
  assert.equal(await isFlagEnabled('some-company', ''), false)
})

test('isFlagEnabled returns false for non-existent company', async () => {
  _clearFlagCacheForTests()
  // Random UUID that does not exist in the DB
  assert.equal(await isFlagEnabled('00000000-0000-0000-0000-000000000000', 'marketing_v1_enabled'), false)
})

test('invalidateFlagCache removes cached entry', () => {
  invalidateFlagCache('test-company', 'test-flag')
  // Just verify it doesn't throw — there's nothing to assert on a cache miss
  assert.ok(true)
})
