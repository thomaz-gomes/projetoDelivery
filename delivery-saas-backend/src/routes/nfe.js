import express from 'express'
import { saveNfeProtocol, getFiscalConfigForOrder } from '../services/nfe.js'

export const nfeRouter = express.Router()

// Persist SEFAZ authorization/protocol returned by SEFAZ
// Expected body: { companyId, orderId?, nProt?, cStat?, xMotivo?, rawXml? }
nfeRouter.post('/protocol', async (req, res) => {
  try {
    const { companyId, orderId, nProt, cStat, xMotivo, rawXml } = req.body
    if (!companyId) return res.status(400).json({ error: 'companyId required' })

    const rec = await saveNfeProtocol({ companyId, orderId, nProt, cStat, xMotivo, rawXml })
    return res.json({ success: true, record: rec })
  } catch (err) {
    console.error('Failed to save NFe protocol:', err?.message || err)
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

// Debug endpoint: resolve fiscal configuration for an order (prefers store overrides)
nfeRouter.get('/config/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params
    if (!orderId) return res.status(400).json({ error: 'orderId required' })
    const cfg = await getFiscalConfigForOrder(orderId)
    // do not leak sensitive data in production
    if (process.env.NODE_ENV === 'production') {
      delete cfg.certPasswordEnc
      // hide absolute cert path in production
      delete cfg.certPath
    }
    return res.json({ success: true, config: cfg })
  } catch (err) {
    console.error('Failed to resolve fiscal config:', err?.message || err)
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

export default nfeRouter
