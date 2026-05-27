// src/workers/marketing.js
//
// Background worker for the WhatsApp marketing campaigns module.
// Runs INSIDE the main backend process via setInterval (every TICK_INTERVAL_MS).
// Each tick performs (eventually) three jobs:
//   1. discoverWork()     — find SCHEDULED campaigns that are due (V1: ONE_SHOT only)
//   2. drainSendQueue()   — pick up MarketingSendQueue jobs and send them (Task 1.11)
//   3. housekeeping()     — close attribution windows, finalize runs, auto-pause (Task 1.20)
//
// RECURRING / TRIGGER schedule types are deferred to Phase 2.

import { prisma } from '../prisma.js'
import { enqueueRun } from '../services/marketing/sendQueue.js'
import { drainSendQueue } from '../services/marketing/sender.js'

const TICK_INTERVAL_MS = 30_000

// Guard against overlapping ticks. setInterval fires every TICK_INTERVAL_MS
// regardless of how long the previous tick took (slow Meta calls + large
// queue can blow past 30s), so without this flag two ticks could both see
// the same SCHEDULED campaign and both call enqueueRun on it.
let running = false

async function tick() {
  if (running) {
    console.log('[marketing-worker] previous tick still running, skipping')
    return
  }
  running = true
  try {
    await discoverWork()
    await drainSendQueue()
    await housekeeping()
  } catch (e) {
    console.error('[marketing-worker] tick error', e?.message || e)
  } finally {
    running = false
  }
}

async function discoverWork() {
  const now = new Date()
  // ONE_SHOT campaigns SCHEDULED and due. The UI lets the operator leave
  // `scheduledFor` blank to mean "send immediately on activation", which
  // persists as NULL. Prisma's `lte` filter does not match NULL, so we OR
  // both branches explicitly — otherwise "immediate" campaigns sit in
  // SCHEDULED forever.
  const oneShot = await prisma.marketingCampaign.findMany({
    where: {
      status: 'SCHEDULED',
      scheduleType: 'ONE_SHOT',
      OR: [
        { scheduledFor: null },
        { scheduledFor: { lte: now } },
      ],
    },
    select: { id: true, name: true },
  })
  for (const c of oneShot) {
    console.log('[marketing-worker] discovered ONE_SHOT due:', c.id, c.name)
    const full = await prisma.marketingCampaign.findUnique({
      where: { id: c.id },
      include: { segment: true },
    })
    if (full) {
      try {
        await enqueueRun(full)
      } catch (e) {
        console.error('[marketing-worker] enqueueRun failed for', c.id, e?.message || e)
      }
    }
  }
  // RECURRING / TRIGGER — deferred to Phase 2
}

// ──────────────────────────────────────────────────────────────────
// Housekeeping (Tick 3)
//
//   1. closeExpiredAttributionWindows — lock messages whose conversion
//      window has elapsed so attribution stops scanning them
//   2. finalizeCompletedRuns — when all messages of a run are terminal,
//      mark the run finished (and the campaign COMPLETED for ONE_SHOT)
//   3. autoPauseUnhealthyCampaigns — if a RUNNING campaign produces >5%
//      failures/opt-outs in 24h on ≥50 sends, auto-pause it
// ──────────────────────────────────────────────────────────────────

async function housekeeping() {
  await closeExpiredAttributionWindows()
  await finalizeCompletedRuns()
  await autoPauseUnhealthyCampaigns()
}

async function closeExpiredAttributionWindows() {
  await prisma.$executeRaw`
    UPDATE "MarketingMessage" mm
    SET "attributionLockedAt" = NOW()
    FROM "MarketingCampaign" mc
    WHERE mm."campaignId" = mc.id
      AND mm."attributionLockedAt" IS NULL
      AND mm."sentAt" IS NOT NULL
      AND mm."sentAt" + (mc."conversionWindowHours" || ' hours')::interval < NOW()
  `
}

async function finalizeCompletedRuns() {
  const runs = await prisma.marketingCampaignRun.findMany({
    where: { finishedAt: null },
    include: { messages: { select: { status: true } } },
  })
  for (const run of runs) {
    const pending = run.messages.filter(
      m => m.status === 'QUEUED' || m.status === 'SENDING',
    ).length
    if (pending === 0) {
      const sent = run.messages.filter(m =>
        ['SENT', 'DELIVERED', 'READ'].includes(m.status),
      ).length
      const failed = run.messages.filter(m => m.status === 'FAILED').length
      await prisma.marketingCampaignRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), totalSent: sent, totalFailed: failed },
      })
      const camp = await prisma.marketingCampaign.findUnique({
        where: { id: run.campaignId },
      })
      if (camp?.scheduleType === 'ONE_SHOT' && camp.status === 'RUNNING') {
        await prisma.marketingCampaign.update({
          where: { id: camp.id },
          data: { status: 'COMPLETED' },
        })
      }
    }
  }
}

async function autoPauseUnhealthyCampaigns() {
  const running = await prisma.marketingCampaign.findMany({
    where: { status: 'RUNNING' },
  })
  const dayAgo = new Date(Date.now() - 86400_000)
  for (const c of running) {
    const stats = await prisma.marketingMessage.groupBy({
      by: ['status'],
      where: { campaignId: c.id, sentAt: { gte: dayAgo } },
      _count: { id: true },
    })
    const total = stats.reduce((s, r) => s + r._count.id, 0)
    const failed = stats.find(r => r.status === 'FAILED')?._count.id || 0
    const optedOut = stats.find(r => r.status === 'OPTED_OUT')?._count.id || 0
    if (total >= 50 && (failed + optedOut) / total > 0.05) {
      await prisma.marketingCampaign.update({
        where: { id: c.id },
        data: { status: 'PAUSED' },
      })
      console.warn(
        '[marketing-worker] auto-paused', c.id,
        'block-rate', ((failed + optedOut) / total).toFixed(2),
      )
    }
  }
}

let started = false

export function startMarketingWorker() {
  if (started) return
  started = true
  console.log('[marketing-worker] starting, tick every', TICK_INTERVAL_MS, 'ms')
  setInterval(tick, TICK_INTERVAL_MS)
  setImmediate(tick)
}
