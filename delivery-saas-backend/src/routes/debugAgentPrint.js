import express from 'express';

// Minimal dev-only debug route for agent printing.
// This is a safe stub so local dev environments that expect this
// route can start even if the original debug handler is missing.

const router = express.Router();

// Simple health endpoint
router.get('/', (req, res) => {
  res.json({ ok: true, message: 'debug/agent-print stub'});
});

// Optional: mirror agent-print POST to quickly test without auth
router.post('/', async (req, res) => {
  try {
    // simply echo back the payload for testing
    return res.json({ ok: true, received: req.body || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message) });
  }
});

export default router;
