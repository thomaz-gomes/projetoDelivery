import express from 'express'

const router = express.Router()

// Minimal QR action router used by the API. This provides a compatible
// placeholder so the server can start even if full business logic isn't
// implemented. Adjust or extend as needed.

// POST /qr-action/scan - accept a QR payload and return a basic result
router.post('/scan', async (req, res) => {
  try {
    const body = req.body || {}
    // For now, just echo back a safe summary for debugging
    return res.json({ ok: true, received: { keys: Object.keys(body).slice(0,10) } })
  } catch (e) {
    console.error('POST /qr-action/scan failed', e)
    return res.status(500).json({ ok: false, error: String(e && e.message) })
  }
})

// Health check
router.get('/', (_req, res) => res.json({ ok: true, name: 'qrAction (placeholder)' }))

export default router
