import express from 'express'

const router = express.Router()

// Minimal rasterize endpoint - placeholder to allow server startup.
// The real implementation should convert HTML/SVG to PNG or return a data URL.
router.post('/', async (req, res) => {
  try {
    // Accepts { html: '<html>...</html>' } and returns a simple stub response
    const body = req.body || {}
    if (!body.html) return res.status(400).json({ ok: false, message: 'html is required' })
    // For now, return a fake PNG data URL placeholder
    return res.json({ ok: true, dataUrl: 'data:image/png;base64,' })
  } catch (e) {
    console.error('POST /rasterize failed', e)
    return res.status(500).json({ ok: false, error: String(e && e.message) })
  }
})

export default router
