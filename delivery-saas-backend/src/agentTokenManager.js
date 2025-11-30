import { prisma } from './prisma.js'
import { randomToken, sha256 } from './utils.js'
import fs from 'fs'
import path from 'path'

export async function rotateAgentToken(companyId, app = null) {
  if (!companyId) throw new Error('companyId required')
  const token = randomToken(24)
  const tokenHash = sha256(token)

  // upsert PrinterSetting
  try {
    const existing = await prisma.printerSetting.findUnique({ where: { companyId } })
    if (existing) {
      await prisma.printerSetting.update({ where: { companyId }, data: { agentTokenHash: tokenHash, agentTokenCreatedAt: new Date() } })
    } else {
      await prisma.printerSetting.create({ data: { companyId, agentTokenHash: tokenHash, agentTokenCreatedAt: new Date() } })
    }
  } catch (e) {
    console.error('rotateAgentToken: prisma upsert failed', e && e.message)
    throw e
  }

  // Write dev convenience files when not in production
  try {
    if (process.env.NODE_ENV !== 'production') {
      const root = process.cwd()
      try { fs.writeFileSync(path.join(root, '.print-agent-token'), token, { encoding: 'utf8' }) } catch (e) { /* ignore */ }
      try { fs.writeFileSync(path.join(root, '.print-agent-company'), companyId, { encoding: 'utf8' }) } catch (e) { /* ignore */ }
      console.log('rotateAgentToken: wrote .print-agent-token and .print-agent-company for company', companyId)
    }
  } catch (e) {
    console.warn('rotateAgentToken: failed to write token files', e && e.message)
  }

  // Notify connected sockets (if app provided)
  try {
    const io = app && app.locals && app.locals.io
    if (io && typeof io.emit === 'function') {
      io.emit('agent-token-rotated', { companyId, token })
      console.log('rotateAgentToken: emitted agent-token-rotated via Socket.IO')
    }
  } catch (e) {
    console.warn('rotateAgentToken: failed to emit socket event', e && e.message)
  }

  return { token }
}

export default { rotateAgentToken }
