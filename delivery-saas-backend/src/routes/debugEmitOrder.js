import express from 'express'
import crypto from 'crypto'

const router = express.Router()

// Dev-only endpoint to emit a synthetic novo-pedido for local testing.
// POST /debug/emit-test-order
// Body: optional { storeId, companyId, qrText }
router.post('/emit-test-order', async (req, res) => {
  try {
    const body = req.body || {}
    const id = crypto.randomUUID();
    const storeId = body.storeId || null
    const companyId = body.companyId || null
    const qrText = body.qrText || (`http://localhost:5173/orders/${id}`)
    const rasterDataUrl = body.rasterDataUrl || null

    const order = {
      id,
      displayId: null,
      status: 'EM_PREPARO',
      companyId,
      storeId,
      customerName: 'TESTE',
      items: [{ name: 'Produto Teste', quantity: 1, price: 10 }],
      total: 10,
      qrText,
      qrDataUrl: rasterDataUrl || null,
      rasterDataUrl: rasterDataUrl || null,
      payload: { debug: true }
    }

    // lazy import emitirNovoPedido to avoid cycles
    const { emitirNovoPedido } = await import('../index.js')
    emitirNovoPedido(order)
    return res.json({ ok: true, id })
  } catch (e) {
    console.error('debug emit test order failed', e)
    return res.status(500).json({ ok: false, error: String(e && e.message) })
  }
})

export default router
