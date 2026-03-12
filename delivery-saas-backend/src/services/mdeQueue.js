/**
 * mdeQueue.js — Background job queue for MDe (NFeDistribuicaoDFe) sync.
 *
 * Features:
 * - In-memory job queue processed every 2 seconds
 * - Per-certificate rate limiting (10s between requests per store)
 * - Global rate limiting (2s between any SEFAZ request)
 * - Exponential backoff on 656 errors (5min, 10min, 20min... max 60min)
 * - Auto-sync every 30 minutes for all activated stores
 * - Real-time status via Socket.IO
 */

import { prisma } from '../prisma.js';
import { syncMde, fetchFullNFe } from './mdeService.js';

// ── Configuration ────────────────────────────────────────────────────────────
const GLOBAL_INTERVAL_MS = 2_000;       // min 2s between ANY SEFAZ request
const CERT_INTERVAL_MS = 10_000;        // min 10s between requests per store/cert
const BASE_BACKOFF_MS = 5 * 60 * 1000;  // 5 min initial backoff on 656
const MAX_BACKOFF_MS = 60 * 60 * 1000;  // 60 min max backoff
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 min auto-sync
const PROCESS_INTERVAL_MS = 2_000;      // queue processor tick

// ── State ────────────────────────────────────────────────────────────────────
const queue = [];                        // { id, type, storeId, companyId, importId?, addedAt }
const certLastRequest = new Map();       // storeId -> timestamp
let globalLastRequest = 0;               // timestamp
const backoffState = new Map();          // storeId -> { retryAfter, consecutiveErrors }
const storeStatus = new Map();           // storeId -> { status, lastSyncAt, lastError, newImports, ... }
let processing = false;
let appRef = null;
let processorInterval = null;
let schedulerInterval = null;
let idCounter = 0;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue an MDe sync job for a store.
 * Deduplicates: won't add if same storeId sync is already queued.
 */
export function enqueueSync(storeId, companyId) {
  // Check if already queued
  const existing = queue.find(j => j.type === 'sync' && j.storeId === storeId);
  if (existing) {
    return { queued: true, position: queue.indexOf(existing) + 1, reason: 'already_queued' };
  }

  // Check if in backoff
  const bo = backoffState.get(storeId);
  if (bo && bo.retryAfter > Date.now()) {
    const waitMin = Math.ceil((bo.retryAfter - Date.now()) / 60000);
    return { queued: false, reason: 'backoff', waitMinutes: waitMin };
  }

  const job = { id: ++idCounter, type: 'sync', storeId, companyId, addedAt: Date.now() };
  queue.push(job);

  updateStatus(storeId, { status: 'queued', queuePosition: queue.length });
  emitStatus(storeId);

  console.log(`[MDeQueue] Enqueued sync for store ${storeId} (position ${queue.length})`);
  return { queued: true, position: queue.length };
}

/**
 * Enqueue a fetchFullNFe job.
 */
export function enqueueFetchXml(importId, companyId, storeId) {
  const job = { id: ++idCounter, type: 'fetchXml', storeId, companyId, importId, addedAt: Date.now() };
  queue.push(job);

  updateStatus(storeId, { status: 'queued', queuePosition: queue.length });
  emitStatus(storeId);

  console.log(`[MDeQueue] Enqueued fetchXml for import ${importId} (position ${queue.length})`);
  return { queued: true, position: queue.length };
}

/**
 * Get queue status for a store.
 */
export function getQueueStatus(storeId) {
  const status = storeStatus.get(storeId) || { status: 'idle' };
  const bo = backoffState.get(storeId);
  if (bo && bo.retryAfter > Date.now()) {
    status.status = 'backoff';
    status.backoffUntil = new Date(bo.retryAfter).toISOString();
    status.backoffMinutes = Math.ceil((bo.retryAfter - Date.now()) / 60000);
  }
  // Check queue position
  const idx = queue.findIndex(j => j.storeId === storeId);
  if (idx >= 0) {
    status.queuePosition = idx + 1;
    if (status.status === 'idle') status.status = 'queued';
  }
  return status;
}

/**
 * Start the queue processor and auto-sync scheduler.
 */
export function startScheduler(app) {
  appRef = app;

  // Process queue every 2s
  processorInterval = setInterval(processQueue, PROCESS_INTERVAL_MS);

  // Auto-sync every 30 min (first run after 60s startup delay)
  setTimeout(() => {
    autoSyncAll();
    schedulerInterval = setInterval(autoSyncAll, AUTO_SYNC_INTERVAL_MS);
  }, 60_000);

  console.log('[MDeQueue] Scheduler started (process every 2s, auto-sync every 30min)');
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
export function stopScheduler() {
  if (processorInterval) { clearInterval(processorInterval); processorInterval = null; }
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
}

// ── Queue Processor ──────────────────────────────────────────────────────────

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  try {
    const now = Date.now();

    // Global rate limit
    if (now - globalLastRequest < GLOBAL_INTERVAL_MS) return;

    // Find first eligible job
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];

      // Per-cert rate limit
      const lastCert = certLastRequest.get(job.storeId) || 0;
      if (now - lastCert < CERT_INTERVAL_MS) continue;

      // Backoff check
      const bo = backoffState.get(job.storeId);
      if (bo && bo.retryAfter > now) continue;

      // Remove from queue and execute
      queue.splice(i, 1);
      await executeJob(job);
      return;
    }
  } catch (e) {
    console.error('[MDeQueue] processQueue error:', e?.message || e);
  } finally {
    processing = false;
  }
}

async function executeJob(job) {
  const { type, storeId, companyId, importId } = job;

  updateStatus(storeId, { status: 'syncing' });
  emitStatus(storeId);

  // Update timestamps BEFORE the call to enforce rate limit even on errors
  globalLastRequest = Date.now();
  certLastRequest.set(storeId, Date.now());

  try {
    let result;
    if (type === 'sync') {
      result = await syncMde(storeId, companyId);

      // cStat 137 = no documents found — SEFAZ requires 1 hour wait
      if (result.cStat === '137') {
        const oneHourMs = 60 * 60 * 1000;
        backoffState.set(storeId, { retryAfter: Date.now() + oneHourMs, consecutiveErrors: 0 });
        console.log(`[MDeQueue] Store ${storeId} in 1h cooldown (cStat=137, no documents)`);
      } else {
        // Clear backoff on success with documents
        backoffState.delete(storeId);
      }

      updateStatus(storeId, {
        status: 'idle',
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        newImports: result.newImports || 0,
        fetched: result.fetched || 0,
        cStat: result.cStat,
      });
    } else if (type === 'fetchXml') {
      result = await fetchFullNFe(importId, companyId);
      backoffState.delete(storeId);

      updateStatus(storeId, {
        status: 'idle',
        lastError: null,
        fetchXmlResult: { importId, itemCount: result.itemCount },
      });
    }

    console.log(`[MDeQueue] Job ${type} completed for store ${storeId}:`, JSON.stringify(result));
    emitStatus(storeId);
  } catch (e) {
    const errorMsg = e?.message || 'Erro desconhecido';
    console.error(`[MDeQueue] Job ${type} failed for store ${storeId}:`, errorMsg);

    if (is656Error(e)) {
      handle656Backoff(storeId);
    }

    updateStatus(storeId, {
      status: is656Error(e) ? 'backoff' : 'idle',
      lastError: errorMsg,
    });
    emitStatus(storeId);
  }
}

// ── 656 Backoff ──────────────────────────────────────────────────────────────

function is656Error(err) {
  const msg = err?.message || '';
  return msg.includes('656') || msg.includes('657') || msg.includes('Consumo indevido');
}

function handle656Backoff(storeId) {
  const current = backoffState.get(storeId) || { consecutiveErrors: 0 };
  current.consecutiveErrors++;
  const delayMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, current.consecutiveErrors - 1), MAX_BACKOFF_MS);
  current.retryAfter = Date.now() + delayMs;
  backoffState.set(storeId, current);

  const mins = Math.ceil(delayMs / 60000);
  console.log(`[MDeQueue] Store ${storeId} in backoff for ${mins}min (${current.consecutiveErrors} consecutive 656 errors)`);
}

// ── Auto-Sync ────────────────────────────────────────────────────────────────

async function autoSyncAll() {
  try {
    // Find all stores with MDe activated (have at least one MDE activation marker)
    const activatedStores = await prisma.purchaseImport.findMany({
      where: {
        source: 'MDE',
        parsedItems: { path: ['_mdeActivation'], equals: true },
      },
      select: { storeId: true, companyId: true },
      distinct: ['storeId'],
    });

    let enqueued = 0;
    for (const { storeId, companyId } of activatedStores) {
      const result = enqueueSync(storeId, companyId);
      if (result.queued && result.reason !== 'already_queued') enqueued++;
    }

    if (activatedStores.length > 0) {
      console.log(`[MDeQueue] Auto-sync: ${enqueued} of ${activatedStores.length} store(s) enqueued`);
    }
  } catch (e) {
    console.error('[MDeQueue] Auto-sync error:', e?.message || e);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function updateStatus(storeId, data) {
  const current = storeStatus.get(storeId) || {};
  storeStatus.set(storeId, { ...current, ...data });
}

function emitStatus(storeId) {
  try {
    const io = appRef?.locals?.io;
    if (!io || typeof io.emit !== 'function') return;

    const status = getQueueStatus(storeId);
    io.emit('mde-status', { storeId, ...status });
  } catch { /* ignore */ }
}
