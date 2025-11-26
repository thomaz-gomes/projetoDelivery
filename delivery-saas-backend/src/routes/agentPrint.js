import express from 'express'
import { authMiddleware } from '../auth.js'
import printQueue from '../printQueue.js'
import { generateQrUrl } from '../utils.js'

const router = express.Router()
router.use(authMiddleware)

// POST /agent-print
// body: { order: {...}, storeId: '...' }
router.post('/', async (req, res) => {
  try {
    const { order } = req.body || {}
    const storeId = req.body.storeId || order && order.storeId || req.query.storeId
    if (!order) return res.status(400).json({ ok: false, error: 'missing order in body' })
    if (!storeId) return res.status(400).json({ ok: false, error: 'missing storeId (body or order.storeId)' })

    // If this looks like a delivery order, inject a signed QR action URL so
    // the agent can print a QR that allows assignment/acceptance by a rider.
    try {
      const oid = order.id || order.orderId || order.externalOrderId || order.displayId || null;
      const isDelivery = !!(order.orderType && String(order.orderType).toUpperCase() === 'DELIVERY') || !!(order.delivery) || !!order.address || (order.type && /delivery/i.test(String(order.type)));
      if (isDelivery && oid && !order.qr) {
        order.qr = generateQrUrl(oid, 'assign');
      }
    } catch (e) { /* ignore QR generation errors */ }

    const io = req.app && req.app.locals && req.app.locals.io
    if (!io) return res.status(500).json({ ok: false, error: 'Socket.IO not initialized on server' })

    // find connected agent sockets serving this storeId
    const candidates = Array.from(io.sockets.sockets.values()).filter(s => s.agent && Array.isArray(s.agent.storeIds) && s.agent.storeIds.includes(storeId))
    if (!candidates || candidates.length === 0) {
      // enqueue for later processing when an agent reconnects
      const queued = printQueue.enqueue({ order, storeId })
      return res.status(202).json({ ok: true, queued: true, queuedId: queued.id, message: 'No agent connected; job queued' })
    }

    // Prioritize the most-recently connected agents for this storeId
    const sorted = candidates.slice().sort((a, b) => {
      const ta = (a.agent && a.agent.connectedAt) ? a.agent.connectedAt : 0
      const tb = (b.agent && b.agent.connectedAt) ? b.agent.connectedAt : 0
      return tb - ta
    })

    const ACK_TIMEOUT_MS = 10000
    const results = []
    let success = null

    // Try each agent sequentially until one acknowledges (ok === true)
    for (const s of sorted) {
      const attempt = await new Promise(resolve => {
        let resolved = false
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true
            resolve({ socketId: s.id, ok: false, error: 'ack_timeout' })
          }
        }, ACK_TIMEOUT_MS + 1000)

        try {
          s.timeout(ACK_TIMEOUT_MS).emit('novo-pedido', order, (...args) => {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            resolve({ socketId: s.id, ok: true, ack: args })
          })
        } catch (e) {
          if (!resolved) {
            resolved = true
            clearTimeout(timer)
            resolve({ socketId: s.id, ok: false, error: String(e && e.message) })
          }
        }
      })

      results.push(attempt)
      if (attempt && attempt.ok) {
        success = attempt
        break
      }
      // otherwise continue to next candidate
    }

    // Emit print result to frontend so UI can show toast/status
    try {
      const io = req.app && req.app.locals && req.app.locals.io
      if (io) {
        if (success) {
          io.emit('print-result', { orderId: order && order.id, status: 'printed', socketId: success.socketId, ack: success.ack })
        } else {
          // no agent acknowledged — queued earlier or will be queued by caller
          io.emit('print-result', { orderId: order && order.id, status: 'queued' })
        }
      }
    } catch (e) { /* ignore */ }

    return res.json({ ok: true, sentTo: candidates.length, attempted: results.length, success: !!success, results, successResult: success })
  } catch (e) {
    console.error('POST /agent-print failed', e)
    return res.status(500).json({ ok: false, error: String(e && e.message) })
  }
})

export default router
