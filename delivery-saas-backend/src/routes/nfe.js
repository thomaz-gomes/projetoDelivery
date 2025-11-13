import express from 'express'
import { saveNfeProtocol } from '../services/nfe.js'

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

export default nfeRouter
