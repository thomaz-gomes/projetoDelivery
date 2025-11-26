import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { signToken } from '../auth.js';
import fs from 'fs';
import path from 'path';
import { randomToken, sha256 } from '../utils.js';
import { rotateAgentToken } from '../agentTokenManager.js';

export const authRouter = express.Router();

async function ensureAgentTokenForCompany(companyId) {
  if (!companyId) return null;
  try {
    const setting = await prisma.printerSetting.findUnique({ where: { companyId } });
    if (setting && setting.agentTokenHash) return null; // already present

    const token = randomToken(24);
    const tokenHash = sha256(token);

    if (setting) {
      await prisma.printerSetting.update({ where: { companyId }, data: { agentTokenHash: tokenHash, agentTokenCreatedAt: new Date() } });
    } else {
      await prisma.printerSetting.create({ data: { companyId, agentTokenHash: tokenHash, agentTokenCreatedAt: new Date() } });
    }

    // In development, write plaintext token files to project root to ease agent startup (start-all.ps1 reads these)
    try {
      if (process.env.NODE_ENV !== 'production') {
        const root = process.cwd();
        fs.writeFileSync(path.join(root, '.print-agent-token'), token, { encoding: 'utf8' });
        fs.writeFileSync(path.join(root, '.print-agent-company'), companyId, { encoding: 'utf8' });
        console.log('Wrote .print-agent-token and .print-agent-company for company', companyId);
      }
    } catch (e) {
      console.warn('Failed to write .print-agent-token files:', e && e.message);
    }

    return token;
  } catch (e) {
    console.error('ensureAgentTokenForCompany failed', e && e.message);
    return null;
  }
}

// Original email/password login (kept as before)
authRouter.post('/login', async (req, res) => {
  const { email, password, whatsapp, login } = req.body || {};
  if (!password) return res.status(400).json({ message: 'Informe senha' });

  // Prefer explicit email login. If not provided, accept whatsapp/login as numeric identifier.
  if (email) {
    const user = await prisma.user.findUnique({ where: { email }, include: { rider: true } });
    if (!user) return res.status(401).json({ message: 'Credenciais inválidas' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: 'Credenciais inválidas' });
    const token = signToken({ id: user.id, role: user.role, companyId: user.companyId ?? null, riderId: user.rider?.id ?? null, name: user.name });
    // generate a fresh agent token for this login, persist to DB and write dev files
    try {
      const { token: agentTokenPlain } = await rotateAgentToken(user.companyId, req.app);
      return res.json({ token, user: { id: user.id, role: user.role, name: user.name, companyId: user.companyId, riderId: user.rider?.id ?? null }, agentToken: agentTokenPlain });
    } catch (e) {
      console.warn('Failed to rotate agent token at login (falling back to ensure-only):', e && e.message ? e.message : e);
      const agentTokenPlain = await ensureAgentTokenForCompany(user.companyId);
      return res.json({ token, user: { id: user.id, role: user.role, name: user.name, companyId: user.companyId, riderId: user.rider?.id ?? null }, agentToken: agentTokenPlain || undefined });
    }
  }

  // no email: try whatsapp/login
  const raw = login || whatsapp || '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return res.status(400).json({ message: 'Informe email ou whatsapp e senha' });

  const user = await prisma.user.findFirst({ where: { OR: [ { rider: { whatsapp: digits } }, { rider: { whatsapp: { endsWith: digits } } }, { rider: { whatsapp: '55' + digits } } ] }, include: { rider: true } });
  if (!user) return res.status(401).json({ message: 'Credenciais inválidas' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ message: 'Credenciais inválidas' });
  const token = signToken({ id: user.id, role: user.role, companyId: user.companyId ?? null, riderId: user.rider?.id ?? null, name: user.name });
  const agentTokenPlain = await ensureAgentTokenForCompany(user.companyId);
  return res.json({ token, user: { id: user.id, role: user.role, name: user.name, companyId: user.companyId, riderId: user.rider?.id ?? null }, agentToken: agentTokenPlain || undefined });
});

// New endpoint: login by WhatsApp (motoboy / afiliado)
// Accepts { whatsapp, password } or { login, password } where whatsapp/login may be masked
authRouter.post('/login-whatsapp', async (req, res) => {
  const { whatsapp, login, password } = req.body || {};
  const raw = whatsapp || login || '';
  if (!raw || !password) return res.status(400).json({ message: 'Informe whatsapp e senha' });

  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return res.status(400).json({ message: 'WhatsApp inválido' });

  // Try to find user by rider.whatsapp (exact / endsWith / with leading 55)
  try {
    console.debug('[auth] login-whatsapp payload received (raw):', raw);
    console.debug('[auth] login-whatsapp normalized digits:', digits);
  } catch (e) { /* ignore logging errors */ }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { rider: { whatsapp: digits } },
        { rider: { whatsapp: { endsWith: digits } } },
        { rider: { whatsapp: '55' + digits } }
      ]
    },
    include: { rider: true }
  });

  if (!user) {
    console.warn('[auth] login-whatsapp: no user found for digits=', digits);
    return res.status(401).json({ message: 'Credenciais inválidas', reason: 'user-not-found' });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    console.warn('[auth] login-whatsapp: invalid password for userId=', user.id);
    return res.status(401).json({ message: 'Credenciais inválidas', reason: 'invalid-password' });
  }

  const token = signToken({
    id: user.id,
    role: user.role,
    companyId: user.companyId ?? null,
    riderId: user.rider?.id ?? null,
    name: user.name
  });
  // generate a fresh agent token for this login
  try {
    const { token: agentTokenPlain } = await rotateAgentToken(user.companyId, req.app);
    res.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        name: user.name,
        companyId: user.companyId,
        riderId: user.rider?.id ?? null
      },
      agentToken: agentTokenPlain
    });
    return;
  } catch (e) {
    console.warn('Failed to rotate agent token at login-whatsapp (falling back to ensure-only):', e && e.message ? e.message : e);
    const agentTokenPlain = await ensureAgentTokenForCompany(user.companyId);
    res.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        name: user.name,
        companyId: user.companyId,
        riderId: user.rider?.id ?? null
      },
      agentToken: agentTokenPlain || undefined
    });
    return;
  }
});