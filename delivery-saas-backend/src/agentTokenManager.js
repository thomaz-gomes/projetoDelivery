import { prisma } from './prisma.js';
import { randomToken, sha256 } from './utils.js';
import fs from 'fs';
import path from 'path';

// rotateAgentToken: generate a new plaintext token, store its hash in DB,
// write dev convenience files (.print-agent-token/.print-agent-company) and
// broadcast the plaintext token to identified frontend sockets (dev convenience).
export async function rotateAgentToken(companyId, app) {
  if (!companyId) throw new Error('companyId required');
  const token = randomToken(24);
  const tokenHash = sha256(token);

  // upsert the PrinterSetting record
  try {
    const existing = await prisma.printerSetting.findUnique({ where: { companyId } });
    if (existing) {
      await prisma.printerSetting.update({ where: { companyId }, data: { agentTokenHash: tokenHash, agentTokenCreatedAt: new Date() } });
    } else {
      await prisma.printerSetting.create({ data: { companyId, agentTokenHash: tokenHash, agentTokenCreatedAt: new Date() } });
    }
  } catch (e) {
    console.error('rotateAgentToken: failed upsert PrinterSetting', e && e.message ? e.message : e);
    throw e;
  }

  // write dev-friendly plaintext files so local agent can pick up token
  try {
    if (process.env.NODE_ENV !== 'production') {
      // Write token file in project root
      const tokenPathRoot = path.resolve(process.cwd(), '.print-agent-token');
      const companyPathRoot = path.resolve(process.cwd(), '.print-agent-company');
      await fs.promises.writeFile(tokenPathRoot, token, 'utf8');
      await fs.promises.writeFile(companyPathRoot, companyId, 'utf8');

      // Also write token files inside the delivery-print-agent folder so the
      // agent process (which may be started with a different cwd) will pick it up.
      try {
        const agentDir = path.resolve(process.cwd(), 'delivery-print-agent');
        const tokenPathAgent = path.join(agentDir, '.print-agent-token');
        const companyPathAgent = path.join(agentDir, '.print-agent-company');
        // ensure agent dir exists before writing
        if (fs.existsSync(agentDir)) {
          await fs.promises.writeFile(tokenPathAgent, token, 'utf8');
          await fs.promises.writeFile(companyPathAgent, companyId, 'utf8');
        }
      } catch (e) {
        // non-fatal
      }

      console.log('rotateAgentToken: wrote .print-agent-token and .print-agent-company (root + agent folder)');
    }
  } catch (e) {
    console.warn('rotateAgentToken: failed to write token files (non-fatal)', e && e.message ? e.message : e);
  }

  // broadcast plaintext token to connected frontend sockets of the same company
  try {
    const io = app && app.locals && app.locals.io;
    if (io) {
      const sockets = Array.from(io.sockets.sockets.values());
      // send to frontends (not agent sockets)
      sockets.filter(s => (!s.agent) && s.user && s.user.companyId === companyId).forEach(s => {
        try { s.emit('agent-token-rotated', { token, companyId }); } catch (e) {}
      });
      // also notify connected agent sockets directly so running agents can update token without file changes
      sockets.filter(s => s.agent && s.agent.companyId === companyId).forEach(s => {
        try { s.emit('update-agent-token', { token, companyId }); } catch (e) {}
      });
    }
  } catch (e) {
    console.warn('rotateAgentToken: failed to broadcast agent-token-rotated', e && e.message ? e.message : e);
  }

  return { token };
}

export default { rotateAgentToken };
