import test from 'node:test';
import assert from 'node:assert/strict';
import { getAffiliateIfOwned } from '../src/routes/affiliates.helpers.js';

test('getAffiliateIfOwned returns affiliate when found', async (t) => {
  const mockPrisma = {
    affiliate: {
      findFirst: async ({ where }) => ({ id: where.id, companyId: where.companyId, name: 'Mock Affiliate' })
    }
  };

  const res = await getAffiliateIfOwned(mockPrisma, 'aff-1', 'comp-1');
  assert.equal(res.id, 'aff-1');
  assert.equal(res.companyId, 'comp-1');
});

test('getAffiliateIfOwned returns null when not found', async (t) => {
  const mockPrisma = {
    affiliate: {
      findFirst: async () => null
    }
  };

  const res = await getAffiliateIfOwned(mockPrisma, 'aff-2', 'comp-2');
  assert.equal(res, null);
});
