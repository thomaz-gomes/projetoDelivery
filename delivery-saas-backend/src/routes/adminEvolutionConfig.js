import express from 'express'
import { authMiddleware, requireRole } from '../auth.js'
import { prisma } from '../prisma.js'
import {
  getEvolutionConfigMasked,
  setEvolutionConfig,
  testEvolutionConnection,
} from '../services/evolutionConfig.js'

const router = express.Router()

router.use(authMiddleware, requireRole('SUPER_ADMIN'))

// GET /admin/evolution-config — masked view; campos vazios = não configurado
router.get('/evolution-config', async (_req, res) => {
  try {
    const cfg = await getEvolutionConfigMasked()
    return res.json(cfg)
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao ler configuração Evolution', error: e?.message })
  }
})

// PUT /admin/evolution-config — sparse update
router.put('/evolution-config', async (req, res) => {
  try {
    const updatedBy = req.user?.id || req.user?.userId || null
    const result = await setEvolutionConfig({ ...(req.body || {}), updatedBy })
    return res.json({ ok: true, ...result })
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao salvar configuração Evolution', error: e?.message })
  }
})

// POST /admin/evolution-config/test — GET / na Evolution para validar credenciais
router.post('/evolution-config/test', async (_req, res) => {
  try {
    const r = await testEvolutionConnection()
    return res.status(r.ok ? 200 : 400).json(r)
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// GET /admin/evolution-config/logs?limit=50 — últimas N chamadas registradas
router.get('/evolution-config/logs', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const rows = await prisma.evolutionRequestLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    // BigInt → string para serialização JSON segura
    const items = rows.map((r) => ({ ...r, id: String(r.id) }))
    return res.json({ items })
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao ler logs', error: e?.message })
  }
})

export default router
