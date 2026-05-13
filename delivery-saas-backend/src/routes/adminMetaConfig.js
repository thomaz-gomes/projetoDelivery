import express from 'express'
import axios from 'axios'
import { authMiddleware, requireRole } from '../auth.js'
import {
  getMetaConfig,
  getMetaConfigMasked,
  setMetaConfig,
  regenerateVerifyToken,
} from '../services/metaConfig.js'

const router = express.Router()

// All admin Meta config routes require an authenticated SUPER_ADMIN (MASTER inherits).
router.use(authMiddleware, requireRole('SUPER_ADMIN'))

// GET /admin/meta-config — masked view (appSecret = ***<last4>); returns { configured:false } when unset.
router.get('/meta-config', async (_req, res) => {
  try {
    const cfg = await getMetaConfigMasked()
    if (!cfg) return res.json({ configured: false })
    return res.json({ configured: true, ...cfg })
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao ler configuração Meta', error: e?.message })
  }
})

// PUT /admin/meta-config — sparse update; only fields present in body are persisted.
router.put('/meta-config', async (req, res) => {
  try {
    const updatedBy = req.user?.id || req.user?.userId || null
    const result = await setMetaConfig({ ...(req.body || {}), updatedBy })
    return res.json({ ok: true, ...result })
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao salvar configuração Meta', error: e?.message })
  }
})

// POST /admin/meta-config/test — sanity check against Graph API using App access token (appId|appSecret).
router.post('/meta-config/test', async (_req, res) => {
  try {
    const { appId, appSecret, graphVersion } = await getMetaConfig()
    const token = `${appId}|${appSecret}`
    const r = await axios.get(`https://graph.facebook.com/${graphVersion}/${appId}`, {
      params: { access_token: token },
      timeout: 10_000,
    })
    return res.json({ ok: true, app: r.data })
  } catch (e) {
    return res.status(400).json({ ok: false, error: e?.response?.data || e?.message || String(e) })
  }
})

// POST /admin/meta-config/regenerate-verify-token — generates and persists a fresh 32-byte hex token.
router.post('/meta-config/regenerate-verify-token', async (req, res) => {
  try {
    const updatedBy = req.user?.id || req.user?.userId || null
    const token = await regenerateVerifyToken(updatedBy)
    return res.json({ token })
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao regenerar verify token', error: e?.message })
  }
})

export default router
