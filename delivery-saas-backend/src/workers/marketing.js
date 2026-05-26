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

const TICK_INTERVAL_MS = 30_000

async function tick() {
  try {
    await discoverWork()
    // Tick 2 (drainSendQueue) and Tick 3 (housekeeping) added in later tasks
  } catch (e) {
    console.error('[marketing-worker] tick error', e?.message || e)
  }
}

async function discoverWork() {
  const now = new Date()
  // ONE_SHOT campaigns SCHEDULED and due
  const oneShot = await prisma.marketingCampaign.findMany({
    where: {
      status: 'SCHEDULED',
      scheduleType: 'ONE_SHOT',
      scheduledFor: { lte: now },
    },
  })
  for (const c of oneShot) {
    console.log('[marketing-worker] discovered ONE_SHOT due:', c.id, c.name)
    // enqueueRun(c) — implemented in Task 1.10
  }
  // RECURRING / TRIGGER — deferred to Phase 2
}

let started = false

export function startMarketingWorker() {
  if (started) return
  started = true
  console.log('[marketing-worker] starting, tick every', TICK_INTERVAL_MS, 'ms')
  setInterval(tick, TICK_INTERVAL_MS)
  setImmediate(tick)
}
