import express from 'express'

const router = express.Router()

// POST /debug/emit-store-update
// body: { companyId, storeId, changedKeys?, meta? }
router.post('/', (req, res) => {
  try {
    const io = req && req.app && req.app.locals && req.app.locals.io ? req.app.locals.io : null
    if (!io) return res.status(500).json({ message: 'Socket.IO not initialized' })
    const { companyId, storeId, changedKeys, meta } = req.body || {}
    if (!companyId || !storeId) return res.status(400).json({ message: 'companyId and storeId are required' })
    const payload = { storeId: String(storeId), companyId: String(companyId), changedKeys: Array.isArray(changedKeys) ? changedKeys : [], meta: meta || null }
    try {
      io.to(`company_${companyId}`).emit('store-settings-updated', payload)
      console.log('[debug] emitted store-settings-updated', payload)
    } catch (e) {
      console.warn('[debug] failed to emit store-settings-updated', e)
    }
    return res.json({ ok: true, payload })
  } catch (e) {
    console.error('POST /debug/emit-store-update failed', e)
    return res.status(500).json({ message: 'internal error' })
  }
})

export default router
