'use strict'
const { io } = require('socket.io-client')

let socket = null

function connect(cfg, { onStatus, onChat } = {}) {
  if (socket) {
    try {
      socket.disconnect()
    } catch (_e) {
      // ignore
    }
    socket = null
  }

  if (!cfg || !cfg.backendUrl || !cfg.ifoodAgentToken || !cfg.companyId) {
    if (typeof onStatus === 'function') {
      onStatus({ status: 'disconnected', reason: 'missing-config' })
    }
    return
  }

  socket = io(cfg.backendUrl, {
    transports: ['websocket', 'polling'],
    auth: { ifoodAgentToken: cfg.ifoodAgentToken, companyId: cfg.companyId },
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000,
  })

  socket.on('connect', () => {
    if (typeof onStatus === 'function') onStatus({ status: 'connected' })
  })

  socket.on('disconnect', () => {
    if (typeof onStatus === 'function') {
      onStatus({ status: 'disconnected', reason: 'transport-closed' })
    }
  })

  socket.on('connect_error', (err) => {
    if (typeof onStatus === 'function') {
      onStatus({ status: 'error', error: err && err.message ? err.message : String(err) })
    }
  })

  socket.on('ifood:chat', (payload) => {
    if (typeof onChat === 'function') onChat(payload)
  })
}

function disconnect() {
  if (socket) {
    try {
      socket.disconnect()
    } catch (_e) {
      // ignore
    }
    socket = null
  }
}

module.exports = { connect, disconnect }
