import express from 'express'
import axios from 'axios'
import { authMiddleware, requireRole } from '../auth.js'
import {
  getMetaConfig,
  getMetaConfigMasked,
  setMetaConfig,
  regenerateVerifyToken,
} from '../services/metaConfig.js'

// ─── ARCHITECTURE NOTE — channel-per-Meta-App split (pending) ──────────────
// Today this single endpoint stores the credentials of ONE Meta App. While we
// only operate WhatsApp Cloud, that's fine — the App ID/Secret/Verify Token
// here belong to the WhatsApp-dedicated Meta App.
//
// Decision (confirmed by product 2026-05-23): each future channel — Facebook
// Messenger and Instagram Direct — will be a SEPARATE Meta App with its own
// credentials, NOT a shared App with channel-specific scopes. When those
// channels enter scope, the migration looks like:
//
//   (a) Rename this file/route → /admin/whatsapp-cloud-config (data migration:
//       SaasSetting.key 'meta_config' → 'whatsapp_cloud_config'), AND
//   (b) Add sibling routes /admin/messenger-config and /admin/instagram-config
//       backed by their own storage rows.
//
// Frontend route /saas/meta-config already redirects to /saas/whatsapp-config
// and the WhatsAppPlatformConfig.vue page is WhatsApp-labelled. Backend
// endpoint rename is deferred to keep the migration small until the second
// channel actually enters scope.
// ───────────────────────────────────────────────────────────────────────────

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
