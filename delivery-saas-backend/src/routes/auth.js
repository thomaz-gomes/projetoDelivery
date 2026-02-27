import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { signToken, authMiddleware } from '../auth.js';
import fs from 'fs';
import path from 'path';
import { randomToken, sha256 } from '../utils.js';
import { rotateAgentToken } from '../agentTokenManager.js';
import { normalizePhone } from '../wa.js';
import { sendVerificationCode } from '../services/email.js';

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

// GET /auth/me — return current user from JWT (used by router guards)
authRouter.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, role: true, name: true, companyId: true, emailVerified: true } });
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    const rider = await prisma.rider.findFirst({ where: { userId: user.id }, select: { id: true } });
    return res.json({ user: { ...user, riderId: rider?.id ?? null, needsSetup: !user.companyId } });
  } catch (e) {
    return res.status(500).json({ message: 'Erro ao buscar usuário' });
  }
});

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

    // Check if user needs email verification or company setup
    // SUPER_ADMIN bypasses email verification requirement
    const needsVerification = user.emailVerified === false && user.role !== 'SUPER_ADMIN';
    const needsSetup = !user.companyId && user.role !== 'SUPER_ADMIN';

    const token = signToken({ id: user.id, role: user.role, companyId: user.companyId ?? null, riderId: user.rider?.id ?? null, name: user.name });
    const userPayload = { id: user.id, role: user.role, name: user.name, companyId: user.companyId, riderId: user.rider?.id ?? null, needsVerification, needsSetup };

    // generate a fresh agent token for this login, persist to DB and write dev files
    try {
      const { token: agentTokenPlain } = await rotateAgentToken(user.companyId, req.app);
      return res.json({ token, user: userPayload, agentToken: agentTokenPlain, needsVerification, needsSetup });
    } catch (e) {
      console.warn('Failed to rotate agent token at login (falling back to ensure-only):', e && e.message ? e.message : e);
      const agentTokenPlain = await ensureAgentTokenForCompany(user.companyId);
      return res.json({ token, user: userPayload, agentToken: agentTokenPlain || undefined, needsVerification, needsSetup });
    }
  }
});

// New endpoint: login by WhatsApp (motoboy / afiliado)
// Accepts { whatsapp, password } or { login, password } where whatsapp/login may be masked
authRouter.post('/login-whatsapp', async (req, res) => {
  const { whatsapp, login, password } = req.body || {};
  const raw = whatsapp || login || '';
  if (!raw || !password) return res.status(400).json({ message: 'Informe whatsapp e senha' });

  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return res.status(400).json({ message: 'WhatsApp inválido' });
    const phoneClean = normalizePhone(digits);

  try {
    console.debug('[auth] login-whatsapp payload received (raw):', raw);
    console.debug('[auth] login-whatsapp normalized digits:', digits);
  } catch (e) { /* ignore logging errors */ }

  // Try to find user by rider.whatsapp using both raw digits and normalized (55-prefixed) form
  let finalUser = null;
  try {
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { rider: { whatsapp: phoneClean } },
            { rider: { whatsapp: digits } },
            { rider: { whatsapp: { endsWith: digits } } },
            { rider: { whatsapp: { contains: digits } } }
          ]
        },
        include: { rider: true }
      });
    if (user) finalUser = user;
  } catch (eFindUser) {
    console.warn('[auth] login-whatsapp: error searching user by rider relation:', eFindUser && eFindUser.message, eFindUser && eFindUser.code);
  }

  // Fallback: if no user was found, look for a Rider record and load its linked user (rider.userId)
  if (!finalUser) {
    try {
        const rider = await prisma.rider.findFirst({
          where: {
            OR: [
              { whatsapp: phoneClean },
              { whatsapp: digits },
              { whatsapp: { endsWith: digits } },
              { whatsapp: { contains: digits } }
            ]
          }
        });
      if (rider) {
        if (rider.userId) {
          const u = await prisma.user.findUnique({ where: { id: rider.userId }, include: { rider: true } });
          if (u) {
            finalUser = u;
            console.warn('[auth] login-whatsapp: located user via rider.userId for digits=', digits, 'userId=', u.id);
          }
        } else {
          console.warn('[auth] login-whatsapp: rider found for digits but no linked user (riderId=' + rider.id + ').');
        }
      } else {
        try {
          const sample = await prisma.rider.findMany({ where: { whatsapp: { not: null } }, take: 10, select: { id: true, whatsapp: true, name: true } });
          console.warn('[auth] login-whatsapp: no user found for digits=', digits, 'nearby rider samples:', sample);
        } catch (eSample) {
          console.warn('[auth] login-whatsapp: no user found for digits=', digits);
        }
      }
    } catch (eFind) {
      console.warn('[auth] login-whatsapp: error trying fallback rider lookup for digits=', digits, eFind && eFind.message);
    }
  }

  // Fallback 2: raw SQL lookup stripping non-digit characters from stored whatsapp
  // This handles cases where whatsapp was saved with formatting (e.g., "(73) 98128-7040")
  if (!finalUser) {
    try {
      const isPostgres = (process.env.DATABASE_URL || '').startsWith('postgres');
      let riderRows = [];
      if (isPostgres) {
        riderRows = await prisma.$queryRaw`
          SELECT r.* FROM "Rider" r
          WHERE regexp_replace(r."whatsapp", '[^0-9]', '', 'g') LIKE ${'%' + digits}
             OR regexp_replace(r."whatsapp", '[^0-9]', '', 'g') LIKE ${'%' + digits + '%'}
          LIMIT 1
        `;
      } else {
        riderRows = await prisma.$queryRaw`
          SELECT r.* FROM "Rider" r
          WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(r."whatsapp", ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE ${'%' + digits}
             OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(r."whatsapp", ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE ${'%' + digits + '%'}
          LIMIT 1
        `;
      }
      if (riderRows && riderRows.length > 0) {
        const rider = riderRows[0];
        console.warn('[auth] login-whatsapp: found rider via raw SQL digit-strip for digits=', digits, 'riderId=', rider.id, 'stored whatsapp=', rider.whatsapp);
        if (rider.userId) {
          const u = await prisma.user.findUnique({ where: { id: rider.userId }, include: { rider: true } });
          if (u) finalUser = u;
        } else {
          console.warn('[auth] login-whatsapp: rider found via raw SQL but no linked user (riderId=' + rider.id + ')');
        }
      }
    } catch (eRaw) {
      console.warn('[auth] login-whatsapp: raw SQL fallback error:', eRaw && eRaw.message);
    }
  }

  if (!finalUser) return res.status(401).json({ message: 'Credenciais inválidas', reason: 'user-not-found' });

  // Verify password: accept bcrypt hash or (legacy) plaintext and upgrade
  try {
    const okBcrypt = await bcrypt.compare(password, finalUser.password);
    if (!okBcrypt) {
      // compatibility: if stored password is plaintext, upgrade to bcrypt
      if (typeof finalUser.password === 'string' && finalUser.password === String(password)) {
        console.warn('[auth] login-whatsapp: detected plaintext password match for userId=' + finalUser.id + '; upgrading to bcrypt hash');
        try {
          const newHash = await bcrypt.hash(String(password), 10);
          await prisma.user.update({ where: { id: finalUser.id }, data: { password: newHash } });
        } catch (eUpd) {
          console.warn('[auth] login-whatsapp: failed to upgrade plaintext password for userId=', finalUser.id, eUpd && eUpd.message);
          return res.status(401).json({ message: 'Credenciais inválidas', reason: 'invalid-password' });
        }
      } else {
        console.warn('[auth] login-whatsapp: invalid password for userId=', finalUser.id);
        return res.status(401).json({ message: 'Credenciais inválidas', reason: 'invalid-password' });
      }
    }
  } catch (eCheck) {
    console.warn('[auth] login-whatsapp: password check error for userId=', finalUser.id, eCheck && eCheck.message);
    return res.status(401).json({ message: 'Credenciais inválidas', reason: 'invalid-password' });
  }

  // Successful auth: issue JWT and agent token
  const token = signToken({ id: finalUser.id, role: finalUser.role, companyId: finalUser.companyId ?? null, riderId: finalUser.rider?.id ?? null, name: finalUser.name });
  try {
    const { token: agentTokenPlain } = await rotateAgentToken(finalUser.companyId, req.app);
    res.json({
      token,
      user: { id: finalUser.id, role: finalUser.role, name: finalUser.name, companyId: finalUser.companyId, riderId: finalUser.rider?.id ?? null },
      agentToken: agentTokenPlain
    });
    return;
  } catch (e) {
    console.warn('Failed to rotate agent token at login-whatsapp (falling back to ensure-only):', e && e.message ? e.message : e);
    const agentTokenPlain = await ensureAgentTokenForCompany(finalUser.companyId);
    res.json({ token, user: { id: finalUser.id, role: finalUser.role, name: finalUser.name, companyId: finalUser.companyId, riderId: finalUser.rider?.id ?? null }, agentToken: agentTokenPlain || undefined });
    return;
  }
});

// fallback: allow affiliate login by whatsapp+password
authRouter.post('/login-whatsapp-affiliate', async (req, res) => {
  const { whatsapp, login, password } = req.body || {};
  const raw = whatsapp || login || '';
  if (!raw || !password) return res.status(400).json({ message: 'Informe whatsapp e senha' });
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return res.status(400).json({ message: 'WhatsApp inválido' });

  try {
    const affiliate = await prisma.affiliate.findFirst({ where: { whatsapp: { contains: digits } } });
    if (!affiliate || !affiliate.password) return res.status(401).json({ message: 'Credenciais inválidas' });
    const ok = await bcrypt.compare(String(password), affiliate.password);
    if (!ok) return res.status(401).json({ message: 'Credenciais inválidas' });

    // Sign token for affiliate. Use role 'ATTENDANT' so permission checks can be scoped.
    const token = signToken({ id: affiliate.id, role: 'ATTENDANT', companyId: affiliate.companyId, affiliateId: affiliate.id, name: affiliate.name });
    // ensure agent token exists for company
    try {
      const { token: agentTokenPlain } = await rotateAgentToken(affiliate.companyId, req.app);
      return res.json({ token, user: { id: affiliate.id, role: 'ATTENDANT', name: affiliate.name, companyId: affiliate.companyId, affiliateId: affiliate.id }, agentToken: agentTokenPlain });
    } catch (e) {
      const agentTokenPlain = await ensureAgentTokenForCompany(affiliate.companyId);
      return res.json({ token, user: { id: affiliate.id, role: 'ATTENDANT', name: affiliate.name, companyId: affiliate.companyId, affiliateId: affiliate.id }, agentToken: agentTokenPlain || undefined });
    }
  } catch (e) {
    console.error('affiliate login error', e);
    return res.status(500).json({ message: 'Erro ao autenticar' });
  }
});

// ============================================================
// Public registration: create account + email verification
// ============================================================

function generateCode() {
  return String(crypto.randomInt(100000, 999999));
}

// POST /auth/register — create a new ADMIN user (no company yet)
authRouter.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Nome, email e senha são obrigatórios' });
  }
  const emailLower = String(email).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return res.status(400).json({ message: 'Email inválido' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Senha deve ter no mínimo 6 caracteres' });
  }

  try {
    // Check for existing email
    const existing = await prisma.user.findUnique({ where: { email: emailLower } });
    if (existing) {
      return res.status(409).json({ message: 'Este email já está cadastrado' });
    }

    // Create user
    const hash = await bcrypt.hash(String(password), 10);
    const user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: emailLower,
        password: hash,
        role: 'ADMIN',
        companyId: null,
        emailVerified: false,
      },
    });

    // Generate verification code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await prisma.emailVerification.create({
      data: { email: emailLower, code, expiresAt },
    });

    // Send code via email
    try {
      await sendVerificationCode(emailLower, code);
    } catch (emailErr) {
      console.error('[auth] Failed to send verification email:', emailErr?.message || emailErr);
    }

    return res.status(201).json({ message: 'Conta criada. Verifique seu email.', userId: user.id, email: emailLower });
  } catch (e) {
    console.error('[auth] register error', e);
    return res.status(500).json({ message: 'Erro ao criar conta' });
  }
});

// POST /auth/verify-email — validate 6-digit code and activate account
authRouter.post('/verify-email', async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) {
    return res.status(400).json({ message: 'Email e código são obrigatórios' });
  }
  const emailLower = String(email).toLowerCase().trim();

  try {
    const record = await prisma.emailVerification.findFirst({
      where: { email: emailLower, code: String(code).trim(), used: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      return res.status(400).json({ message: 'Código inválido' });
    }
    if (new Date() > record.expiresAt) {
      return res.status(400).json({ message: 'Código expirado. Solicite um novo.' });
    }

    // Mark code as used
    await prisma.emailVerification.update({
      where: { id: record.id },
      data: { used: true },
    });

    // Mark user as verified
    const user = await prisma.user.update({
      where: { email: emailLower },
      data: { emailVerified: true },
    });

    // Issue JWT so user can proceed to company setup
    const token = signToken({
      id: user.id,
      role: user.role,
      companyId: user.companyId ?? null,
      riderId: null,
      name: user.name,
    });

    const needsSetup = !user.companyId && user.role !== 'SUPER_ADMIN';
    return res.json({
      token,
      user: { id: user.id, role: user.role, name: user.name, companyId: user.companyId, needsSetup },
      needsSetup,
    });
  } catch (e) {
    console.error('[auth] verify-email error', e);
    return res.status(500).json({ message: 'Erro ao verificar código' });
  }
});

// POST /auth/resend-code — invalidate previous codes and send a new one
authRouter.post('/resend-code', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: 'Email é obrigatório' });
  const emailLower = String(email).toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email: emailLower } });
    if (!user) return res.status(404).json({ message: 'Email não encontrado' });
    if (user.emailVerified) return res.json({ message: 'Email já verificado' });

    // Invalidate previous codes
    await prisma.emailVerification.updateMany({
      where: { email: emailLower, used: false },
      data: { used: true },
    });

    // Generate new code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await prisma.emailVerification.create({
      data: { email: emailLower, code, expiresAt },
    });

    try {
      await sendVerificationCode(emailLower, code);
    } catch (emailErr) {
      console.error('[auth] Failed to resend verification email:', emailErr?.message || emailErr);
    }

    return res.json({ message: 'Código reenviado' });
  } catch (e) {
    console.error('[auth] resend-code error', e);
    return res.status(500).json({ message: 'Erro ao reenviar código' });
  }
});

// POST /auth/setup-company — first-time company setup (authenticated, no company yet)
authRouter.post('/setup-company', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    if (user.companyId) return res.status(400).json({ message: 'Você já possui uma empresa cadastrada' });

    const { name, slug, street, addressNumber, addressNeighborhood, city, state, postalCode } = req.body || {};
    if (!name) return res.status(400).json({ message: 'Nome da empresa é obrigatório' });
    if (!street || !city || !state) return res.status(400).json({ message: 'Endereço da empresa é obrigatório (rua, cidade, estado)' });

    // Create company with address
    const companyData = {
      name: String(name).trim(),
      slug: slug ? String(slug).trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : null,
      street: String(street).trim(),
      addressNumber: addressNumber ? String(addressNumber).trim() : null,
      addressNeighborhood: addressNeighborhood ? String(addressNeighborhood).trim() : null,
      city: String(city).trim(),
      state: String(state).trim().toUpperCase(),
      postalCode: postalCode ? String(postalCode).replace(/\D/g, '') : null,
    };

    const company = await prisma.company.create({ data: companyData });

    // Create default store
    const store = await prisma.store.create({
      data: {
        companyId: company.id,
        name: company.name,
        address: [companyData.street, companyData.addressNumber, companyData.addressNeighborhood, companyData.city, companyData.state].filter(Boolean).join(', '),
      },
    });

    // Create default payment methods
    const defaultPayments = [
      { companyId: company.id, name: 'Dinheiro', code: 'CASH' },
      { companyId: company.id, name: 'PIX', code: 'PIX' },
      { companyId: company.id, name: 'Cartão de Crédito', code: 'CREDIT_CARD' },
      { companyId: company.id, name: 'Cartão de Débito', code: 'DEBIT_CARD' },
    ];
    await prisma.paymentMethod.createMany({ data: defaultPayments });

    // Link user to company
    await prisma.user.update({
      where: { id: userId },
      data: { companyId: company.id },
    });

    // Issue new JWT with companyId
    const newToken = signToken({
      id: user.id,
      role: user.role,
      companyId: company.id,
      riderId: null,
      name: user.name,
    });

    return res.status(201).json({
      token: newToken,
      company: { id: company.id, name: company.name, slug: company.slug, city: company.city, state: company.state },
      store: { id: store.id, name: store.name },
      user: { id: user.id, role: user.role, name: user.name, companyId: company.id },
    });
  } catch (e) {
    console.error('[auth] setup-company error', e);
    if (e?.code === 'P2002' && String(e?.meta?.target || '').includes('slug')) {
      return res.status(409).json({ message: 'Este slug já está em uso. Escolha outro.' });
    }
    return res.status(500).json({ message: 'Erro ao criar empresa' });
  }
});
