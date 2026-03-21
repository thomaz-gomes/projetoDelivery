import api from '../api.js'
import { API_URL } from '../config.js'

let buffer = []
let flushTimer = null
let sessionId = null

function getSessionId() {
  if (sessionId) return sessionId
  sessionId = sessionStorage.getItem('mt_session')
  if (!sessionId) {
    sessionId = crypto.randomUUID()
    sessionStorage.setItem('mt_session', sessionId)
  }
  return sessionId
}

export function trackMenuEvent(companyId, menuId, eventType, { productId, customerId, metadata } = {}) {
  buffer.push({
    companyId,
    menuId,
    sessionId: getSessionId(),
    eventType,
    productId: productId || null,
    customerId: customerId || null,
    metadata: metadata || null,
  })

  if (!flushTimer) {
    flushTimer = setTimeout(flushEvents, 10000)
  }
}

export async function flushEvents() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (buffer.length === 0) return

  const events = buffer.splice(0)
  try {
    await api.post('/public/tracking/events', { events })
  } catch (e) {
    buffer.unshift(...events)
    console.warn('[MenuTracking] flush failed, will retry', e)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (buffer.length > 0) {
      const events = buffer.splice(0)
      const blob = new Blob([JSON.stringify({ events })], { type: 'application/json' })
      navigator.sendBeacon((API_URL || '') + '/public/tracking/events', blob)
    }
  })
}
