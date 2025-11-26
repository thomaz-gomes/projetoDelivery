import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import { randomToken, sha256 } from '../utils.js'
import { rotateAgentToken } from '../agentTokenManager.js'
import fs from 'fs';
import path from 'path';

const agentSetupRouter = express.Router()
agentSetupRouter.use(authMiddleware)

// GET /agent-setup
// Returns socket URL and the list of store IDs for the authenticated user's company
agentSetupRouter.get('/', async (req, res) => {
  try {
    const companyId = req.user && req.user.companyId
    if (!companyId) return res.status(400).json({ message: 'companyId ausente no token' })

    const stores = await prisma.store.findMany({ where: { companyId }, select: { id: true } })
    const storeIds = (stores || []).map(s => s.id)

    // Prefer an explicit env var for socket URL, otherwise derive from request host
    const socketUrl = process.env.SOCKET_URL || `${req.protocol}://${req.get('host')}`

    // Check if an agent token has been issued for this company (we only have the hash)
    const setting = await prisma.printerSetting.findUnique({ where: { companyId } })
    const tokenHint = setting && setting.agentTokenCreatedAt ? `issued:${setting.agentTokenCreatedAt.toISOString()}` : ''

    // also include printer settings (safe subset) so frontend can pre-fill modal
    const printerSetting = setting ? {
      interface: setting.interface,
      type: setting.type,
      width: setting.width,
      headerName: setting.headerName,
      headerCity: setting.headerCity,
      agentTokenCreatedAt: setting.agentTokenCreatedAt
    } : null

    res.json({ socketUrl, storeIds, tokenHint, printerSetting })
  } catch (e) {
    console.error('GET /agent-setup failed', e)
    res.status(500).json({ message: 'Erro ao buscar configuração do agente', error: e?.message || String(e) })
  }
})

export default agentSetupRouter

// POST /agent-setup/token - generate/rotate per-company agent token (ADMIN only)
// Returns the plaintext token once. Caller must store it securely.
agentSetupRouter.post('/token', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user && req.user.companyId
    if (!companyId) return res.status(400).json({ message: 'companyId ausente no token' })

    // Use centralized manager to rotate token, write files and broadcast
    try {
      const { token } = await rotateAgentToken(companyId, req.app);
      return res.json({ token });
    } catch (e) {
      console.error('POST /agent-setup/token rotateAgentToken failed', e && e.message ? e.message : e);
      return res.status(500).json({ message: 'Falha ao gerar token do agente', error: e && e.message ? e.message : String(e) });
    }
  } catch (e) {
    console.error('POST /agent-setup/token failed', e)
    res.status(500).json({ message: 'Falha ao gerar token do agente', error: e?.message || String(e) })
  }
})

// POST /agent-setup/settings - persist printer settings for this company (ADMIN only)
agentSetupRouter.post('/settings', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user && req.user.companyId
    if (!companyId) return res.status(400).json({ message: 'companyId ausente no token' })

    const { interface: iface, type, width, headerName, headerCity } = req.body || {}
    const data = {}
    if (iface !== undefined) data.interface = iface
    if (type !== undefined) data.type = type
    if (width !== undefined) data.width = Number(width) || undefined
    if (headerName !== undefined) data.headerName = headerName
    if (headerCity !== undefined) data.headerCity = headerCity

    const existing = await prisma.printerSetting.findUnique({ where: { companyId } })
    let updated
    if (existing) {
      updated = await prisma.printerSetting.update({ where: { companyId }, data })
    } else {
      updated = await prisma.printerSetting.create({ data: Object.assign({ companyId }, data) })
    }

    res.json({ ok: true, setting: {
      interface: updated.interface,
      type: updated.type,
      width: updated.width,
      headerName: updated.headerName,
      headerCity: updated.headerCity,
      agentTokenCreatedAt: updated.agentTokenCreatedAt
    }})
  } catch (e) {
    console.error('POST /agent-setup/settings failed', e)
    res.status(500).json({ message: 'Falha ao salvar configuração de impressão', error: e?.message || String(e) })
  }
})

// POST /agent-setup/print-test - ask a connected agent to print a small test
agentSetupRouter.post('/print-test', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user && req.user.companyId
    if (!companyId) return res.status(400).json({ message: 'companyId ausente no token' })

    const { storeId, printerName, text, printerType, dryRun, printerInterface, printerCodepage } = req.body || {}
    if (!storeId) return res.status(400).json({ message: 'storeId é obrigatório' })

    const io = req.app && req.app.locals && req.app.locals.io
    if (!io) return res.status(500).json({ message: 'Socket.IO não inicializado' })

    // find connected agent sockets that service this storeId, prefer newest first
    const sockets = Array.from(io.sockets.sockets.values()).slice().reverse().filter(s => s.agent && Array.isArray(s.agent.storeIds) && s.agent.storeIds.includes(storeId))
    if (!sockets || sockets.length === 0) return res.status(404).json({ message: 'Nenhum agente conectado para esse storeId' })

    const payload = {
      printerName: printerName || null,
      printerInterface: printerInterface || null,
      printerType: printerType || null,
      printerCodepage: printerCodepage || null,
      dryRun: typeof dryRun === 'boolean' ? dryRun : undefined,
      text: text || 'Teste de impressão — Delivery'
    }

    // Try each candidate socket in order (newest first) until one responds successfully
    for (const candidate of sockets) {
      try {
        // use socket.timeout to wait for ack
        const ack = await candidate.timeout(10000).emitWithAck ? await candidate.timeout(10000).emitWithAck('test-print', payload) : await new Promise((resolve, reject) => {
          candidate.timeout(10000).emit('test-print', payload, (err, result) => {
            if (err) return reject(err)
            return resolve(result)
          })
        })

        // If agent responded with ok true, return success
        if (ack && (ack.ok === true || ack.ok === 'true')) {
          return res.json({ ok: true, result: ack })
        }
        // otherwise continue to next candidate
      } catch (e) {
        // log and try next socket
        console.warn('Agent candidate failed to respond, trying next:', e && e.message)
        continue
      }
    }

    // If we reach here none of the agents responded successfully
    return res.status(504).json({ message: 'Nenhum agente respondeu ao teste de impressão' })
  } catch (e) {
    console.error('POST /agent-setup/print-test failed', e)
    res.status(500).json({ message: 'Falha ao solicitar teste de impressão', error: e?.message || String(e) })
  }
})
