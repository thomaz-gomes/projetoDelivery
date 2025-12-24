import express from 'express'
import crypto from 'crypto'
import fs from 'fs'

const router = express.Router()

function readEnvText(keyBase) {
  try {
    const direct = process.env[keyBase]
    if (direct && String(direct).trim()) return String(direct)

    const b64 = process.env[`${keyBase}_BASE64`]
    if (b64 && String(b64).trim()) {
      try { return Buffer.from(String(b64), 'base64').toString('utf8') } catch (_) {}
    }

    const file = process.env[`${keyBase}_FILE`]
    if (file && String(file).trim()) {
      try { return fs.readFileSync(String(file), 'utf8') } catch (_) {}
    }
  } catch (_) {}
  return ''
}

// Returns the QZ Tray certificate as plain text.
// Provide via one of: QZ_CERT, QZ_CERT_BASE64, QZ_CERT_FILE
router.get('/cert', async (req, res) => {
  try {
    const cert = readEnvText('QZ_CERT')
    if (!cert) return res.status(404).send('')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.send(cert)
  } catch (e) {
    return res.status(500).send('')
  }
})

// Signs a QZ Tray challenge. Body: { toSign: string }
// Requires private key provided via one of: QZ_PRIVATE_KEY, QZ_PRIVATE_KEY_BASE64, QZ_PRIVATE_KEY_FILE (PEM format).
router.post('/sign', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const toSign = (req.body && (req.body.toSign || req.body.data || req.body.payload)) || ''
    if (!toSign || typeof toSign !== 'string') {
      return res.status(400).send('')
    }
    const key = readEnvText('QZ_PRIVATE_KEY')
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
