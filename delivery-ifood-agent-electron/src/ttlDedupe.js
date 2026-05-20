'use strict'
const fs = require('fs')
const path = require('path')

const KIND_TTL_MS = {
  CONFIRMED: 10 * 60 * 1000,
  DISPATCHED: 30 * 60 * 1000,
  DELIVERED: 2 * 60 * 60 * 1000,
  MANUAL: 2 * 60 * 60 * 1000,
}
const DEFAULT_TTL_MS = 30 * 60 * 1000
const RETENTION_MS = 24 * 60 * 60 * 1000

function isStale(payload) {
  if (!payload || typeof payload.createdAt !== 'number') return false
  const ttl = (payload.kind && KIND_TTL_MS[payload.kind]) || DEFAULT_TTL_MS
  return (Date.now() - payload.createdAt) > ttl
}

function dedupKey(payload) {
  if (!payload) return null
  const id = payload.orderId || payload.orderNumber
  const kind = payload.kind || 'manual'
  if (!id) return null
  return `${id}:${kind}`
}

// Disk persistence helpers (used by main process)
function loadSent(storagePath) {
  try {
    const raw = fs.readFileSync(storagePath, 'utf8')
    const map = JSON.parse(raw)
    const now = Date.now()
    const cleaned = {}
    for (const [k, ts] of Object.entries(map)) {
      if (typeof ts === 'number' && (now - ts) < RETENTION_MS) cleaned[k] = ts
    }
    return cleaned
  } catch (e) { return {} }
}

function saveSent(storagePath, map) {
  const dir = path.dirname(storagePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(storagePath, JSON.stringify(map), 'utf8')
}

module.exports = { isStale, dedupKey, loadSent, saveSent, KIND_TTL_MS, DEFAULT_TTL_MS, RETENTION_MS }
