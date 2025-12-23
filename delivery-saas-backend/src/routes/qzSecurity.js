import express from 'express'
import crypto from 'crypto'

const router = express.Router()

// Returns the QZ Tray certificate as plain text.
// Set QZ_CERT in environment (PEM format or raw string as required by QZ).
router.get('/cert', async (req, res) => {
  try {
    const cert = process.env.QZ_CERT || ''
    if (!cert) return res.status(404).send('')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.send(cert)
  } catch (e) {
    return res.status(500).send('')
  }
})

// Signs a QZ Tray challenge. Body: { toSign: string }
// Requires QZ_PRIVATE_KEY in environment (PEM format).
router.post('/sign', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const toSign = (req.body && (req.body.toSign || req.body.data || req.body.payload)) || ''
    if (!toSign || typeof toSign !== 'string') {
      return res.status(400).send('')
    }
    const key = process.env.QZ_PRIVATE_KEY
    if (!key) return res.status(404).send('')

    const signer = crypto.createSign('RSA-SHA256')
    signer.update(toSign)
    signer.end()
    const signature = signer.sign(key, 'base64')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.send(signature)
  } catch (e) {
    return res.status(500).send('')
  }
})

export default router
