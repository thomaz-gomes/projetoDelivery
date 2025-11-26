import express from 'express'
import { prisma } from '../prisma.js'
import { verifyQrSig } from '../utils.js'
import { emitirPedidoAtualizado } from '../index.js'

const router = express.Router()

// Public QR action endpoint (validates HMAC sig).
// GET /qr-action?orderId=...&action=assign&sig=...&riderId=...
// NOTE: this route is intentionally permissive for dev convenience; consider
// requiring authentication or additional validation in production.
router.get('/', async (req, res) => {
  try {
    const { orderId, action = 'assign', sig, riderId } = req.query || {}
    if (!orderId || !sig) return res.status(400).send('missing orderId or sig')

    if (!verifyQrSig(String(orderId), String(action), String(sig))) {
      return res.status(403).send('invalid signature')
    }

    if (action !== 'assign') return res.status(400).send('unsupported action')

    // If no riderId provided, return a simple confirmation page (developer-friendly)
    if (!riderId) {
      return res.send(`<html><body><h3>Confirmar Atribuição</h3><p>Pedido ${orderId} - ação: ${action}</p><p>Para confirmar, abra este link com parâmetro <code>?riderId=ID</code></p></body></html>`)
    }

    // Mark the order as assigned to this rider and change status to SAIU_PARA_ENTREGA
    const existing = await prisma.order.findUnique({ where: { id: String(orderId) } })
    if (!existing) return res.status(404).send('order not found')

    const updated = await prisma.order.update({
      where: { id: String(orderId) },
      data: {
        riderId: String(riderId),
        status: 'SAIU_PARA_ENTREGA',
        histories: { create: { from: existing.status, to: 'SAIU_PARA_ENTREGA', byUserId: null, byRiderId: String(riderId), reason: 'Atribuído via QR' } }
      }
    })

    // notify rider/customer and emit socket update
    try { emitirPedidoAtualizado(updated) } catch (e) { console.warn('Emitir pedido atualizado falhou:', e?.message || e) }

    // Ideally we'd call notifyRiderAssigned here, but that function expects auth context; caller can rely on socket events.
    return res.json({ ok: true, order: updated })
  } catch (e) {
    console.error('GET /qr-action failed', e)
    return res.status(500).send('internal error')
  }
})

export default router
