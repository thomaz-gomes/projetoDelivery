import express from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../auth.js';
import { prisma } from '../prisma.js';

export const cashRouter = express.Router();
cashRouter.use(authMiddleware);

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE_PATH = path.join(DATA_DIR, 'cashSessions.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) fs.writeFileSync(FILE_PATH, JSON.stringify({ sessions: [] }, null, 2));
}

function readAll() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    return JSON.parse(raw || '{"sessions":[]}') || { sessions: [] };
  } catch (e) {
    console.warn('Could not read cash sessions file, returning empty', e);
    return { sessions: [] };
  }
}

function writeAll(payload) {
  ensureDataDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(payload, null, 2));
}

// GET /cash/current - current open session for company
cashRouter.get('/current', async (req, res) => {
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });
  const all = readAll();
  const s = all.sessions.find(x => x.companyId === companyId && !x.closedAt);
  res.json(s || null);
});

// POST /cash/open { openingAmount, note }
cashRouter.post('/open', async (req, res) => {
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });
  let { openingAmount, note } = req.body || {};
  const all = readAll();
  // ensure no open session exists
  const existing = all.sessions.find(x => x.companyId === companyId && !x.closedAt);
  if (existing) return res.status(400).json({ message: 'Já existe sessão de caixa aberta' });

  // If openingAmount not provided, try to initialize from last closed session counted cash
  if (openingAmount == null) {
    try {
      const closed = all.sessions.filter(x => x.companyId === companyId && x.closedAt).sort((a,b)=>new Date(b.closedAt)-new Date(a.closedAt))[0];
      if (closed && closed.closingSummary) {
        const cs = (typeof closed.closingSummary === 'string') ? (() => { try { return JSON.parse(closed.closingSummary); } catch (e) { return closed.closingSummary; } })() : closed.closingSummary;
        if (cs && cs.counted) {
          // try normalized keys: Dinheiro, CASH, dinheiro, cash
          const candidates = ['Dinheiro','dinheiro','CASH','cash','Cash','DINHEIRO'];
          let found = null;
          for (const k of Object.keys(cs.counted || {})) {
            const keyLower = String(k).toLowerCase();
            if (keyLower.includes('din') || keyLower.includes('cash') || keyLower.includes('money')) { found = cs.counted[k]; break; }
          }
          if (found == null) {
            // try explicit candidate names
            for (const c of candidates) { if (cs.counted[c] != null) { found = cs.counted[c]; break; } }
          }
          if (found != null) openingAmount = Number(found || 0);
        }
      }
    } catch (e) { /* ignore and keep openingAmount null */ }
  }

  const s = {
    id: uuidv4(),
    companyId,
    openedAt: new Date().toISOString(),
    openedBy: req.user.id,
    openingAmount: Number(openingAmount || 0),
    balance: Number(openingAmount || 0),
    note: note || null,
    movements: [],
    closedAt: null,
    closedBy: null,
    closingSummary: null
  };
  all.sessions.push(s);
  writeAll(all);
  res.status(201).json(s);
});

// POST /cash/movement { type, amount, account, note }
cashRouter.post('/movement', async (req, res) => {
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });
  const { type, amount, account, note } = req.body || {};
  if (!type || !amount) return res.status(400).json({ message: 'type e amount são obrigatórios' });
  const all = readAll();
  const s = all.sessions.find(x => x.companyId === companyId && !x.closedAt);
  if (!s) return res.status(400).json({ message: 'Nenhuma sessão de caixa aberta' });

  const mv = { id: uuidv4(), type, amount: Number(amount), account: account || null, note: note || null, at: new Date().toISOString(), by: req.user.id };
  // withdrawals decrease balance, reinforcements increase
  if (type === 'withdrawal' || type === 'retirada') s.balance = Number(s.balance) - Number(amount);
  else s.balance = Number(s.balance) + Number(amount);
  s.movements.push(mv);
  writeAll(all);
  res.json({ ok: true, session: s, movement: mv });
});

// POST /cash/close { closingSummary }
cashRouter.post('/close', async (req, res) => {
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });
  const { closingSummary } = req.body || {};
  const all = readAll();
  const s = all.sessions.find(x => x.companyId === companyId && !x.closedAt);
  if (!s) return res.status(400).json({ message: 'Nenhuma sessão de caixa aberta' });
  s.closedAt = new Date().toISOString();
  s.closedBy = req.user.id;
  s.closingSummary = closingSummary || null;
  writeAll(all);
  res.json({ ok: true, session: s });
});

// GET /cash/sessions - list sessions
cashRouter.get('/sessions', async (req, res) => {
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });
  const all = readAll();
  const sessions = all.sessions.filter(x => x.companyId === companyId).sort((a,b)=>new Date(b.openedAt)-new Date(a.openedAt));

  // For each session, compute a summary: totals per payment method (from confirmed payments),
  // totals for movements, and expected balance. Also normalize/parse closingSummary if needed.
  const enriched = await Promise.all(sessions.map(async (s) => {
    const sessionCopy = Object.assign({}, s);

    // normalize closingSummary if it is a JSON string
    try {
      if (sessionCopy.closingSummary && typeof sessionCopy.closingSummary === 'string') {
        try { sessionCopy.closingSummary = JSON.parse(sessionCopy.closingSummary); } catch (e) { /* keep as string */ }
      }
    } catch (e) { /* ignore */ }

    // aggregate movements
    const movements = Array.isArray(sessionCopy.movements) ? sessionCopy.movements : [];
    let totalWithdrawals = 0;
    let totalReinforcements = 0;
    for (const mv of movements) {
      const t = String(mv.type || '').toLowerCase();
      const a = Number(mv.amount || 0);
      if (t.includes('retir') || t.includes('withdraw')) totalWithdrawals += a;
      else if (t.includes('refor') || t.includes('reinfor') || t.includes('refo')) totalReinforcements += a;
      else { if (a < 0) totalWithdrawals += Math.abs(a); else totalReinforcements += a; }
    }

    // compute payments per method from orders finalized during the session
    const paymentsByMethod = {};
    try {
      const where = { companyId: sessionCopy.companyId, status: 'CONCLUIDO' };
      const gte = sessionCopy.openedAt ? new Date(sessionCopy.openedAt) : null;
      const lte = sessionCopy.closedAt ? new Date(sessionCopy.closedAt) : null;
      if (gte || lte) where.updatedAt = {};
      if (gte) where.updatedAt.gte = gte;
      if (lte) where.updatedAt.lte = lte;

      const orders = await prisma.order.findMany({ where, select: { id: true, payload: true, total: true, updatedAt: true, createdAt: true } });
      const byMethodCents = {};
      for (const o of orders) {
        try {
          const payload = o.payload || {};
          let confirmed = null;
          if (Array.isArray(payload.paymentConfirmed)) confirmed = payload.paymentConfirmed;
          else if (payload.payment) confirmed = [payload.payment];
          else if (typeof payload.paymentConfirmed === 'string') {
            try { confirmed = JSON.parse(payload.paymentConfirmed); } catch (e) { confirmed = null; }
          }
          if (Array.isArray(confirmed)) {
            for (const p of confirmed) {
              const raw = (p && (p.method || p.methodCode || p.name)) ? (p.method || p.methodCode || p.name) : 'Outros';
              const method = (function normalizeMethod(name) {
                if (!name) return 'Outros';
                const s = String(name).toLowerCase();
                if (s.includes('din') || s.includes('cash') || s.includes('money') || s.includes('dinheiro')) return 'Dinheiro';
                if (s.includes('pix')) return 'PIX';
                if (s.includes('card') || s.includes('cartao') || s.includes('credito') || s.includes('cred')) return 'Cartão';
                return String(name).trim();
              })(raw);
              const amt = (p && (p.amount != null)) ? Number(p.amount) : (o.total != null ? Number(o.total) : 0);
              const cents = Math.round((Number(amt) || 0) * 100);
              byMethodCents[method] = (byMethodCents[method] || 0) + cents;
            }
          }
        } catch (e) { /* per-order parse error */ }
      }
      for (const [m, cents] of Object.entries(byMethodCents)) paymentsByMethod[m] = (cents || 0) / 100;
    } catch (e) {
      console.warn('Failed to aggregate payments for session', sessionCopy.id, e && e.message);
    }

    // expected balance: openingAmount + cash payments + reforcos - retiradas
    const opening = Number(sessionCopy.openingAmount || 0);
    const cashPayments = Number(paymentsByMethod['Dinheiro'] || 0);
    const expected = opening + cashPayments + Number(totalReinforcements || 0) - Number(totalWithdrawals || 0);

    // compute per-method in-register totals: for 'Dinheiro' start from opening and add/subtract movements,
    // for other methods the in-register amount is the total payments (no physical movements tracked)
    const inRegisterByMethod = {};
    for (const [m, v] of Object.entries(paymentsByMethod)) {
      if (String(m).toLowerCase().includes('din') || String(m).toLowerCase().includes('cash')) {
        inRegisterByMethod[m] = Number(opening || 0) + Number(v || 0) + Number(totalReinforcements || 0) - Number(totalWithdrawals || 0);
      } else {
        inRegisterByMethod[m] = Number(v || 0);
      }
    }
    // ensure Dinheiro exists as a key even if there were no payments
    if (!Object.keys(inRegisterByMethod).some(k => String(k).toLowerCase().includes('din') || String(k).toLowerCase().includes('cash'))) {
      inRegisterByMethod['Dinheiro'] = Number(opening || 0) + Number(totalReinforcements || 0) - Number(totalWithdrawals || 0);
    }

    sessionCopy.summary = {
      paymentsByMethod,
      inRegisterByMethod,
      totalPayments: Object.values(paymentsByMethod).reduce((s,v)=>s+Number(v||0),0),
      totalWithdrawals: Number(totalWithdrawals || 0),
      totalReinforcements: Number(totalReinforcements || 0),
      expectedBalance: Number(expected || 0)
    };

    return sessionCopy;
  }));

  res.json(enriched);
});

// GET /cash/summary/current - summary for current open session
cashRouter.get('/summary/current', async (req, res) => {
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });
  const all = readAll();
  const s = all.sessions.find(x => x.companyId === companyId && !x.closedAt);
  if (!s) return res.json(null);

  const sessionCopy = Object.assign({}, s);
  // normalize closingSummary if string
  try { if (sessionCopy.closingSummary && typeof sessionCopy.closingSummary === 'string') { try { sessionCopy.closingSummary = JSON.parse(sessionCopy.closingSummary); } catch (e) {} } } catch (e) {}

  // aggregate movements
  const movements = Array.isArray(sessionCopy.movements) ? sessionCopy.movements : [];
  let totalWithdrawals = 0;
  let totalReinforcements = 0;
  for (const mv of movements) {
    const t = String(mv.type || '').toLowerCase();
    const a = Number(mv.amount || 0);
    if (t.includes('retir') || t.includes('withdraw')) totalWithdrawals += a;
    else if (t.includes('refor') || t.includes('reinfor') || t.includes('refo')) totalReinforcements += a;
    else { if (a < 0) totalWithdrawals += Math.abs(a); else totalReinforcements += a; }
  }

  // compute payments per method from orders finalized during the session
  const paymentsByMethod = {};
  try {
    const where = { companyId: sessionCopy.companyId, status: 'CONCLUIDO' };
    const gte = sessionCopy.openedAt ? new Date(sessionCopy.openedAt) : null;
    const lte = sessionCopy.closedAt ? new Date(sessionCopy.closedAt) : null;
    if (gte || lte) where.updatedAt = {};
    if (gte) where.updatedAt.gte = gte;
    if (lte) where.updatedAt.lte = lte;

    const orders = await prisma.order.findMany({ where, select: { id: true, payload: true, total: true, updatedAt: true, createdAt: true } });
    const byMethodCents = {};
    for (const o of orders) {
      try {
        const payload = o.payload || {};
        let confirmed = null;
        if (Array.isArray(payload.paymentConfirmed)) confirmed = payload.paymentConfirmed;
        else if (payload.payment) confirmed = [payload.payment];
        else if (typeof payload.paymentConfirmed === 'string') {
          try { confirmed = JSON.parse(payload.paymentConfirmed); } catch (e) { confirmed = null; }
        }
        if (Array.isArray(confirmed)) {
          for (const p of confirmed) {
            const raw = (p && (p.method || p.methodCode || p.name)) ? (p.method || p.methodCode || p.name) : 'Outros';
            const method = (function normalizeMethod(name) {
              if (!name) return 'Outros';
              const s = String(name).toLowerCase();
              if (s.includes('din') || s.includes('cash') || s.includes('money') || s.includes('dinheiro')) return 'Dinheiro';
              if (s.includes('pix')) return 'PIX';
              if (s.includes('card') || s.includes('cartao') || s.includes('credito') || s.includes('cred')) return 'Cartão';
              return String(name).trim();
            })(raw);
            const amt = (p && (p.amount != null)) ? Number(p.amount) : (o.total != null ? Number(o.total) : 0);
            const cents = Math.round((Number(amt) || 0) * 100);
            byMethodCents[method] = (byMethodCents[method] || 0) + cents;
          }
        }
      } catch (e) { /* per-order parse error */ }
    }
    for (const [m, cents] of Object.entries(byMethodCents)) paymentsByMethod[m] = (cents || 0) / 100;
  } catch (e) {
    console.warn('Failed to aggregate payments for session', sessionCopy.id, e && e.message);
  }

  // expected balance: openingAmount + cash payments + reforcos - retiradas
  const opening = Number(sessionCopy.openingAmount || 0);
  const cashPayments = Number(paymentsByMethod['Dinheiro'] || 0);
  const expected = opening + cashPayments + Number(totalReinforcements || 0) - Number(totalWithdrawals || 0);

  // compute per-method in-register totals: for 'Dinheiro' start from opening and add/subtract movements,
  // for other methods the in-register amount is the total payments (no physical movements tracked)
  const inRegisterByMethod = {};
  for (const [m, v] of Object.entries(paymentsByMethod)) {
    if (String(m).toLowerCase().includes('din') || String(m).toLowerCase().includes('cash')) {
      inRegisterByMethod[m] = Number(opening || 0) + Number(v || 0) + Number(totalReinforcements || 0) - Number(totalWithdrawals || 0);
    } else {
      inRegisterByMethod[m] = Number(v || 0);
    }
  }
  // ensure Dinheiro exists as a key even if there were no payments
  if (!Object.keys(inRegisterByMethod).some(k => String(k).toLowerCase().includes('din') || String(k).toLowerCase().includes('cash'))) {
    inRegisterByMethod['Dinheiro'] = Number(opening || 0) + Number(totalReinforcements || 0) - Number(totalWithdrawals || 0);
  }

  sessionCopy.summary = {
    paymentsByMethod,
    inRegisterByMethod,
    totalPayments: Object.values(paymentsByMethod).reduce((s,v)=>s+Number(v||0),0),
    totalWithdrawals: Number(totalWithdrawals || 0),
    totalReinforcements: Number(totalReinforcements || 0),
    expectedBalance: Number(expected || 0)
  };

  res.json(sessionCopy.summary);
});

export default cashRouter;
