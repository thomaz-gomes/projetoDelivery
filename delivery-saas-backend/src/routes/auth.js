import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { signToken } from '../auth.js';

export const authRouter = express.Router();

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
    return res.json({ token, user: { id: user.id, role: user.role, name: user.name, companyId: user.companyId, riderId: user.rider?.id ?? null } });
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
  return res.json({ token, user: { id: user.id, role: user.role, name: user.name, companyId: user.companyId, riderId: user.rider?.id ?? null } });
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

  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      companyId: user.companyId,
      riderId: user.rider?.id ?? null
    }
  });
});