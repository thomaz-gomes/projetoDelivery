// src/services/marketing/sendQueue.js
//
// Materialize a MarketingCampaignRun for a campaign:
//   1. Re-evaluate the segment (always fresh, no cache)
//   2. For RECURRING: subtract customers already reached by this campaign
//   3. Frequency cap: max FREQ_CAP_PER_WEEK marketing messages per
//      customer in a rolling 7-day window
//   4. Create CampaignRun + N MarketingMessage rows + N SendQueue rows
//      (single chain of writes — cleanup on partial failure is handled by
//      housekeeping, not transactional rollback, to keep writes fast)
//   5. For ONE_SHOT, transition campaign DRAFT/SCHEDULED -> RUNNING
//
// Send-slot scheduling intentionally lives here (not in the sender) so
// the cadence shape is decided once at enqueue time and the actual send
// loop just picks up due jobs.

import { prisma } from '../../prisma.js'
import { evaluateSegment } from './segmentEvaluator.js'
import { hourInTz, dayKeyInTz, startOfDayInTz, DEFAULT_TZ } from '../../utils/dateTz.js'

// Default per-customer 7-day cap when the company has no override set.
const DEFAULT_FREQ_CAP_PER_WEEK = 2

/**
 * Compute send-slot timestamps for `count` messages of a campaign.
 *   - Evolution: jitter 1-15s between sends (mimics human cadence to
 *     reduce ban-pattern detection on the unofficial channel)
 *   - Cloud (META_WA / AUTO): ~200ms baseline; the sender will further
 *     throttle on Meta usage headers when present
 *   - Quiet hours: 08:00 - 21:00 in the company's timezone (defaults to
 *     America/Sao_Paulo). Out-of-window slots push to the next valid
 *     08:00 in that TZ — NOT the container's UTC clock.
 */
function computeSendSlots(count, channel, tz = DEFAULT_TZ) {
  const slots = []
  let cursor = nextValidSlot(new Date(), tz)
  for (let i = 0; i < count; i++) {
    slots.push(new Date(cursor))
    const isEvo = channel === 'EVOLUTION_WA'
    const jitterMs = isEvo
      ? Math.floor(Math.random() * 14_000) + 1_000  // 1-15s
      : 200
    cursor = new Date(cursor.getTime() + jitterMs)
    cursor = nextValidSlot(cursor, tz)
  }
  return slots
}

/**
 * Return the next instant ≥ `t` that falls within 08:00–21:00 in `tz`.
 * Uses Intl-backed helpers from utils/dateTz.js so quiet-hours math is
 * correct regardless of the Node process timezone (container is UTC).
 */
function nextValidSlot(t, tz = DEFAULT_TZ) {
  const d = t instanceof Date ? new Date(t) : new Date(t)
  const h = hourInTz(d, tz)
  if (h >= 8 && h < 21) return d

  // Compute 08:00 in `tz` for "the right day": today if we're still before 08:00,
  // tomorrow if we're already past 21:00.
  const dayKey = dayKeyInTz(d, tz)
  let target = startOfDayInTz(dayKey, tz) // 00:00 local in tz
  target = new Date(target.getTime() + 8 * 60 * 60 * 1000) // +8h → 08:00 local

  if (target.getTime() <= d.getTime()) {
    // We're past 08:00 today (meaning h >= 21), roll to tomorrow's 08:00.
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000)
  }
  return target
}

/**
 * Materialize a CampaignRun for the campaign.
 * Returns { runId, queued }.
 *
 * @param {object} campaign — must include `segment` if you want to skip an extra round-trip.
 */
export async function enqueueRun(campaign) {
  // For ONE_SHOT campaigns, atomically claim the campaign at the top of
  // enqueueRun by flipping SCHEDULED → RUNNING. If updateMany affects zero
  // rows another tick already picked this up and we bail out — without this
  // guard, two overlapping ticks (or two backend instances) would both
  // enqueue the same ONE_SHOT and double-send.
  if (campaign.scheduleType === 'ONE_SHOT') {
    const claim = await prisma.marketingCampaign.updateMany({
      where: { id: campaign.id, status: 'SCHEDULED' },
      data: { status: 'RUNNING' },
    })
    if (claim.count === 0) {
      console.log('[marketing-worker] campaign already claimed:', campaign.id)
      return { runId: null, queued: 0 }
    }
  }

  // Load segment if not eagerly loaded
  const segment =
    campaign.segment ??
    (await prisma.marketingSegment.findUnique({ where: { id: campaign.segmentId } }))
  if (!segment) {
    console.warn('[enqueueRun] segment not found for campaign', campaign.id)
    return { runId: null, queued: 0 }
  }

  const customerIds = await evaluateSegment({
    companyId: campaign.companyId,
    ruleJson: segment.ruleJson,
  })

  let candidates = customerIds
  if (campaign.scheduleType === 'RECURRING') {
    if (candidates.length) {
      const already = await prisma.marketingMessage.findMany({
        where: { campaignId: campaign.id, customerId: { in: customerIds } },
        select: { customerId: true },
      })
      const sentSet = new Set(already.map(m => m.customerId))
      candidates = customerIds.filter(id => !sentSet.has(id))
    }
  }

  // Frequency cap — max N marketing messages per customer in a rolling
  // 7-day window (counts across ALL campaigns). N comes from the company's
  // `marketingFrequencyCapPerWeek` override when set, else the system
  // default. Capped at 0..50 in the company route, so we don't re-validate.
  if (candidates.length > 0) {
    const companyForCap = await prisma.company.findUnique({
      where: { id: campaign.companyId },
      select: { marketingFrequencyCapPerWeek: true },
    })
    const cap = (companyForCap?.marketingFrequencyCapPerWeek != null)
      ? companyForCap.marketingFrequencyCapPerWeek
      : DEFAULT_FREQ_CAP_PER_WEEK

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000)
    const recent = await prisma.marketingMessage.groupBy({
      by: ['customerId'],
      where: { customerId: { in: candidates }, sentAt: { gte: sevenDaysAgo } },
      _count: { id: true },
    })
    const capMap = new Map(recent.map(r => [r.customerId, r._count.id]))
    candidates = candidates.filter(id => (capMap.get(id) || 0) < cap)
  }

  const run = await prisma.marketingCampaignRun.create({
    data: {
      campaignId: campaign.id,
      companyId: campaign.companyId, // denormalized for tenant scoping
      totalQueued: candidates.length,
    },
  })

  if (candidates.length === 0) {
    await prisma.marketingCampaignRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date() },
    })
    if (campaign.scheduleType === 'ONE_SHOT') {
      await prisma.marketingCampaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED' },
      })
    }
    return { runId: run.id, queued: 0 }
  }

  // Resolve company timezone for quiet-hours math. Fall back to the menu's
  // timezone if the company didn't set one, then DEFAULT_TZ (BRT).
  let tz = DEFAULT_TZ
  try {
    const company = await prisma.company.findUnique({
      where: { id: campaign.companyId },
      select: { timezone: true },
    })
    if (company?.timezone) {
      tz = company.timezone
    } else if (campaign.segmentMenuId) {
      const menu = await prisma.menu.findUnique({
        where: { id: campaign.segmentMenuId },
        select: { timezone: true },
      })
      if (menu?.timezone) tz = menu.timezone
    }
  } catch (e) {
    console.warn('[enqueueRun] timezone lookup failed, using default', e?.message)
  }

  const slots = computeSendSlots(candidates.length, campaign.channel, tz)

  // Create messages then queue rows. Use createManyAndReturn if available
  // (Prisma 5.14+); else fall back to two queries.
  let messages
  try {
    messages = await prisma.marketingMessage.createManyAndReturn({
      data: candidates.map((customerId, i) => ({
        companyId: campaign.companyId,
        campaignId: campaign.id,
        campaignRunId: run.id,
        customerId,
        providerUsed: campaign.channel,
        status: 'QUEUED',
        scheduledFor: slots[i],
      })),
    })
  } catch (e) {
    // createManyAndReturn unavailable — fallback
    await prisma.marketingMessage.createMany({
      data: candidates.map((customerId, i) => ({
        companyId: campaign.companyId,
        campaignId: campaign.id,
        campaignRunId: run.id,
        customerId,
        providerUsed: campaign.channel,
        status: 'QUEUED',
        scheduledFor: slots[i],
      })),
    })
    const fetched = await prisma.marketingMessage.findMany({
      where: { campaignRunId: run.id },
      select: { id: true, customerId: true },
    })
    // align order to candidates so slots index matches
    const byCustomer = new Map(fetched.map(m => [m.customerId, m]))
    messages = candidates.map(id => byCustomer.get(id)).filter(Boolean)
  }

  await prisma.marketingSendQueue.createMany({
    data: messages.map((m, i) => ({
      messageId: m.id,
      scheduledFor: slots[i],
    })),
  })

  // (ONE_SHOT campaigns were already flipped to RUNNING at the top of this
  // function as part of the claim — no second update needed.)

  console.log(
    '[marketing-worker] enqueued run', run.id,
    'for campaign', campaign.id,
    'with', candidates.length, 'messages',
  )
  return { runId: run.id, queued: candidates.length }
}
