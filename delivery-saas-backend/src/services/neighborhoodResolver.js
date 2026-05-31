// Centralized "given a raw neighborhood text, give me the canonical
// Neighborhood (or none, and enqueue the unknown)" service.
//
// Three layers, in order:
//   1. Hit the NeighborhoodAlias table directly. After the first time an
//      input is classified (or auto-classified by step 2), subsequent
//      occurrences of the exact same normalized text resolve in O(1)
//      without scanning the Neighborhood list.
//   2. Run findNeighborhoodMatch against the canonical Neighborhood list
//      (strict equality + substring containment over name/aliases). When
//      it matches, persist a CLASSIFIED alias row so step 1 catches the
//      next occurrence.
//   3. Persist a PENDING alias row (or bump occurrence count on an
//      existing one) so the admin queue surfaces the unknown text for
//      manual classification. Returns null neighborhood — caller falls
//      back to fee=0 and Order.deliveryNeighborhood = the raw text.
//
// The whole point of this service is that the daily "validate
// neighborhoods" script becomes unnecessary: every unknown input lands
// in the queue automatically and stays out of the operator's way until
// they have time to classify it. After classification, the alias row
// upgrades to CLASSIFIED and never causes a query miss again.

import { prisma } from '../prisma.js';
import { findNeighborhoodMatch, normalizeForMatch } from '../utils/neighborhoodMatch.js';

export async function resolveNeighborhood(companyId, rawText) {
  const empty = { neighborhood: null, neighborhoodId: null, deliveryFee: 0, riderFee: 0, name: null };
  if (!companyId || !rawText || typeof rawText !== 'string') return empty;

  const sample = rawText.trim();
  if (!sample) return empty;

  const rawInput = normalizeForMatch(sample);
  if (!rawInput) return empty;

  // 1) Hit the alias table first (fast path).
  let alias = null;
  try {
    alias = await prisma.neighborhoodAlias.findUnique({
      where: { company_alias_raw_input_idx: { companyId, rawInput } },
      include: { neighborhood: true },
    });
  } catch (e) { /* ignore — table might be missing on a stale deploy */ }

  if (alias?.status === 'CLASSIFIED' && alias.neighborhood) {
    // Bump occurrence asynchronously — we don't want the resolver to wait.
    prisma.neighborhoodAlias.update({
      where: { id: alias.id },
      data: { lastSeenAt: new Date(), occurrences: { increment: 1 } },
    }).catch(() => {});
    return {
      neighborhood: alias.neighborhood,
      neighborhoodId: alias.neighborhood.id,
      deliveryFee: Number(alias.neighborhood.deliveryFee) || 0,
      riderFee: Number(alias.neighborhood.riderFee) || 0,
      name: alias.neighborhood.name,
    };
  }

  if (alias?.status === 'IGNORED') {
    // Operator explicitly said "this is garbage" — don't try to match again,
    // don't bump the queue. Returns null so the order saves with fee=0.
    return { ...empty, name: alias.rawSample };
  }

  // 2) Canonical match against Neighborhood list.
  let neighborhoods = [];
  try {
    neighborhoods = await prisma.neighborhood.findMany({ where: { companyId } });
  } catch (e) { /* keep empty */ }
  const matched = findNeighborhoodMatch(neighborhoods, sample);

  if (matched) {
    // Persist alias upgrade so future occurrences hit step 1 immediately.
    try {
      await prisma.neighborhoodAlias.upsert({
        where: { company_alias_raw_input_idx: { companyId, rawInput } },
        update: {
          neighborhoodId: matched.id,
          status: 'CLASSIFIED',
          lastSeenAt: new Date(),
          occurrences: { increment: 1 },
          resolvedAt: new Date(),
          resolvedBy: 'auto',
        },
        create: {
          companyId,
          rawInput,
          rawSample: sample,
          neighborhoodId: matched.id,
          status: 'CLASSIFIED',
          resolvedAt: new Date(),
          resolvedBy: 'auto',
        },
      });
    } catch (e) { /* non-fatal */ }
    return {
      neighborhood: matched,
      neighborhoodId: matched.id,
      deliveryFee: Number(matched.deliveryFee) || 0,
      riderFee: Number(matched.riderFee) || 0,
      name: matched.name,
    };
  }

  // 3) Unknown — enqueue/bump PENDING so the admin can classify once.
  try {
    await prisma.neighborhoodAlias.upsert({
      where: { company_alias_raw_input_idx: { companyId, rawInput } },
      update: { lastSeenAt: new Date(), occurrences: { increment: 1 } },
      create: { companyId, rawInput, rawSample: sample, status: 'PENDING' },
    });
  } catch (e) { /* non-fatal */ }

  return empty;
}

export default { resolveNeighborhood };
