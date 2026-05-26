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

const FREQ_CAP_PER_WEEK = 2

/**
 * Compute send-slot timestamps for `count` messages of a campaign.
 *   - Evolution: jitter 1-15s between sends (mimics human cadence to
 *     reduce ban-pattern detection on the unofficial channel)
 *   - Cloud (META_WA / AUTO): ~200ms baseline; the sender will further
 *     throttle on Meta usage headers when present
 *   - Quiet hours: 08:00 - 21:00 local server time. Out-of-window slots
 *     push to next valid 08:00.
 */
function computeSendSlots(count, channel) {
  const slots = []
  let cursor = nextValidSlot(new Date())
  for (let i = 0; i < count; i++) {
    slots.push(new Date(cursor))
    const isEvo = channel === 'EVOLUTION_WA'
    const jitterMs = isEvo
      ? Math.floor(Math.random() * 14_000) + 1_000  // 1-15s
      : 200
    cursor = new Date(cursor.getTime() + jitterMs)
    cursor = nextValidSlot(cursor)
  }
  return slots
}

function nextValidSlot(t) {
  const d = new Date(t)
  const h = d.getHours()
  if (h < 8) {
    d.setHours(8, 0, 0, 0)
    return d
  }
  if (h >= 21) {
    d.setDate(d.getDate() + 1)
    d.setHours(8, 0, 0, 0)
    return d
  }
  return d
}

/**
 * Materialize a CampaignRun for the campaign.
 * Returns { runId, queued }.
 *
 * @param {object} campaign — must include `segment` if you want to skip an extra round-trip.
 */
export async function enqueueRun(campaign) {
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

  // Frequency cap — max FREQ_CAP_PER_WEEK marketing messages per
  // customer in a rolling 7-day window (counts across ALL campaigns).
  if (candidates.length > 0) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000)
    const recent = await prisma.marketingMessage.groupBy({
      by: ['customerId'],
      where: { customerId: { in: candidates }, sentAt: { gte: sevenDaysAgo } },
      _count: { id: true },
    })
    const capMap = new Map(recent.map(r => [r.customerId, r._count.id]))
    candidates = candidates.filter(id => (capMap.get(id) || 0) < FREQ_CAP_PER_WEEK)
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

  const slots = computeSendSlots(candidates.length, campaign.channel)

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

  if (campaign.scheduleType === 'ONE_SHOT') {
    await prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: { status: 'RUNNING' },
    })
  }

  console.log(
    '[marketing-worker] enqueued run', run.id,
    'for campaign', campaign.id,
    'with', candidates.length, 'messages',
  )
  return { runId: run.id, queued: candidates.length }
}
