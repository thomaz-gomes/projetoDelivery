'use strict'

const path = require('path')
const ttlDedupe = require('./ttlDedupe')
const failures = require('./failures')

// Resolve storage path lazily. In the main process Electron is available; in
// tests (plain node --test) it isn't, so we fall back to an in-memory-only
// mode by leaving the path null and skipping disk persistence.
function resolveStoragePath() {
  try {
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'sent-keys.json')
    }
  } catch (_e) { /* electron not available */ }
  return null
}

const storagePath = resolveStoragePath()

function safeLoad() {
  if (!storagePath) return {}
  try { return ttlDedupe.loadSent(storagePath) } catch (_e) { return {} }
}

function safeSave(map) {
  if (!storagePath) return
  try { ttlDedupe.saveSent(storagePath, map) } catch (_e) { /* swallow */ }
}

let sent = safeLoad()

function handleIncomingChat(payload, { forwardToRenderer } = {}) {
  if (!payload) return { action: 'drop', reason: 'no-payload' }

  if (ttlDedupe.isStale(payload)) {
    failures.record({
      orderNumber: payload.orderNumber || null,
      kind: payload.kind || null,
      error: 'stale-ttl',
      at: Date.now(),
    })
    return { action: 'drop', reason: 'stale' }
  }

  const key = ttlDedupe.dedupKey(payload)
  if (key && sent[key]) {
    return { action: 'drop', reason: 'already-sent' }
  }

  if (typeof forwardToRenderer === 'function') {
    forwardToRenderer(payload)
  }
  return { action: 'forward', key }
}

function handleSendResult(result) {
  if (!result || typeof result !== 'object') {
    return { recorded: false, reason: 'invalid-result' }
  }
  if (result.success === true && result.key) {
    sent[result.key] = Date.now()
    safeSave(sent)
    return { recorded: true }
  }
  if (result.success === false) {
    failures.record({
      orderNumber: result.orderNumber || null,
      kind: result.kind || null,
      error: result.error || 'send-failed',
      at: Date.now(),
    })
    return { recorded: false }
  }
  return { recorded: false, reason: 'invalid-result' }
}

function getFailures() {
  return failures.list()
}

function clearFailures() {
  failures.clear()
  return true
}

function _resetSentForTests() {
  sent = {}
  safeSave({})
}

module.exports = {
  handleIncomingChat,
  handleSendResult,
  getFailures,
  clearFailures,
  _resetSentForTests,
}
