// src/index.js
// Disable debug logs from dependencies (e.g., engine.io / socket.io) to keep server logs clean
import debug from 'debug';
try { debug.disable(); } catch (_) {}

import express from "express";
// note: server creation moved to server.js so Socket.IO can attach to the real HTTPS server
import { Server } from "socket.io";
import jwt from 'jsonwebtoken';
import cors from "cors";
import bodyParser from "body-parser";

// ✅ importe as rotas
import { webhooksRouter } from "./routes/webhooks.js";
import { authRouter } from "./routes/auth.js";
import { ordersRouter } from "./routes/orders.js";
import { ticketsRouter } from "./routes/tickets.js";
import { integrationsRouter } from "./routes/integrations.js";
import { fileSourcesRouter } from "./routes/fileSources.js";
import { ifoodRouter } from "./routes/ifood.js";
import { ridersRouter } from "./routes/riders.js";
import { customersRouter } from "./routes/customers.js";
import { neighborhoodsRouter } from "./routes/neighborhoods.js";
import { waRouter } from "./routes/wa.js";
import { affiliatesRouter } from "./routes/affiliates.js";
import { couponsRouter } from "./routes/coupons.js";
import publicMenuRouter from './routes/publicMenu.js'
import menuAdminRouter from './routes/menu.js'
import menuOptionsRouter from './routes/menuOptions.js'
import { nfeRouter } from './routes/nfe.js'
import companiesRouter from './routes/companies.js'
import storesRouter from './routes/stores.js'
import usersRouter from './routes/users.js'
import rolesRouter from './routes/rolePermissions.js'
import agentSetupRouter from './routes/agentSetup.js'
import agentPrintRouter from './routes/agentPrint.js'
import qzPrintRouter from './routes/qzPrint.js'
import qrActionRouter from './routes/qrAction.js'
import rasterizeRouter from './routes/rasterize.js'
import printerSettingRouter from './routes/printerSetting.js'
import cashRouter from './routes/cash.js'
import events from './utils/events.js'
import printQueue from './printQueue.js'
import { prisma } from './prisma.js'
import { sha256 } from './utils.js'
import { rotateAgentToken } from './agentTokenManager.js'
import path from 'path';
import startReportsCleanup from './cleanupReports.js';
import startForceOpenCleanup from './cleanupForceOpen.js';

const app = express();
// When running behind a reverse proxy (EasyPanel / nginx / Cloudflare), enable
// `trust proxy` so Express can correctly detect `req.secure` and the original
// client IP. This ensures cookies marked `secure` and other proxy-sensitive
// behaviors work as expected when TLS is terminated upstream.
app.set('trust proxy', true);

// ==============================
// 🌐 Middleware global
// ==============================
// Allow the frontend origin(s). Prefer explicit origins for CORS + credentials.
// You can set FRONTEND_ORIGIN for a single origin or FRONTEND_ORIGINS as a
// comma-separated list (useful for CI/staging/prod variations).
const defaultOrigins = ['http://localhost:5173', 'http://dev.redemultilink.com.br:5173'];
const allowedOrigins = (process.env.FRONTEND_ORIGINS
  ? process.env.FRONTEND_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : (process.env.FRONTEND_ORIGIN ? [process.env.FRONTEND_ORIGIN] : defaultOrigins)
);
console.log('CORS allowed origins:', allowedOrigins.join(', '));

// CORS configuration
const ALLOW_ALL_CORS = String(process.env.ALLOW_ALL_CORS || '').toLowerCase() === '1' || String(process.env.ALLOW_ALL_CORS || '').toLowerCase() === 'true';

if (ALLOW_ALL_CORS) {
  console.warn('⚠️ ALLOW_ALL_CORS is enabled — allowing all origins (for debugging only).');
  app.use(cors({ origin: true, credentials: true }));
} else {
  app.use(
    cors({
      origin: (origin, cb) => {
        // DEV convenience: allow any origin when not in production to avoid frequent CORS pain
        if (process.env.NODE_ENV !== 'production') {
          try { console.log('CORS check (dev) - incoming Origin:', origin); } catch(_){ }
          return cb(null, true);
        }
        // allow requests with no origin (mobile apps, curl) or if origin is in the list
        if (!origin || allowedOrigins.indexOf(origin) !== -1) return cb(null, true);
        return cb(new Error('CORS not allowed for origin: ' + origin));
      },
      credentials: true,
    })
  );
}
// Ensure CORS headers are present on all responses (including 404s) and
// explicitly handle OPTIONS preflight requests. Some reverse-proxies or
// error handlers may return responses without CORS headers; this middleware
// guarantees the browser sees the expected headers.
app.use((req, res, next) => {
  try {
    const origin = req.headers.origin;
    // If ALLOW_ALL_CORS is enabled, reflect the incoming origin (or use '*').
    if (ALLOW_ALL_CORS) {
      res.header('Access-Control-Allow-Origin', origin || '*');
      res.header('Access-Control-Allow-Credentials', 'true');
    } else {
      // In production, only allow configured origins. If request has no
      // Origin (curl, server-to-server), do not set Access-Control-Allow-Origin.
      if (origin && allowedOrigins.indexOf(origin) !== -1) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
      }
    }

    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    // Respond to preflight immediately
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  } catch (e) {
    // if anything goes wrong here, don't block the request
  }
  return next();
});
// capture raw body for debugging parsing errors (verify is called before parsing)
app.use(bodyParser.json({ limit: "10mb", verify: (req, _res, buf) => { try { req.rawBody = buf && buf.toString ? buf.toString() : null } catch(_) { req.rawBody = null } } }));

// Error handler specifically for JSON parse errors produced by body-parser.
// This will log the request path, headers and a snippet of the raw body to help
// identify external actors sending malformed payloads (e.g., FileWatcher output)
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    try {
      console.error('JSON parse error on path', req.originalUrl || req.url, '-', err.message);
      console.error('Request headers:', JSON.stringify(req.headers || {}, null, 2));
      const snippet = req.rawBody ? String(req.rawBody).slice(0, 2000) : '<no raw body captured>';
      console.error('Raw body snippet (first 2000 chars):', snippet.replace(/\n/g, '\\n'));
    } catch (_e) {}
    return res.status(400).json({ error: 'Invalid JSON payload', message: err.message });
  }
  return next(err);
});

// ==============================
// 🚏 Rotas principais
// ==============================
app.use("/auth", authRouter);
app.use("/webhooks", webhooksRouter);
app.use("/orders", ordersRouter);
app.use("/tickets", ticketsRouter);
app.use("/integrations", integrationsRouter);
app.use('/file-sources', fileSourcesRouter);
app.use("/ifood", ifoodRouter);
app.use("/riders", ridersRouter);
app.use("/customers", customersRouter);
app.use("/neighborhoods", neighborhoodsRouter);
app.use("/wa", waRouter);
app.use("/affiliates", affiliatesRouter);
app.use('/coupons', couponsRouter);
app.use('/public', publicMenuRouter);
app.use('/menu', menuAdminRouter);
app.use('/menu/options', menuOptionsRouter);
app.use('/nfe', nfeRouter);
app.use('/settings', companiesRouter);
// Mount menu admin router also under /settings to provide backward-compatible
// API paths such as /settings/payment-methods for external consumers that
// expect the payment-methods resource to live under settings. This keeps the
// same handlers available at both /menu/* and /settings/*.
app.use('/settings', menuAdminRouter);
app.use('/stores', storesRouter);
app.use('/users', usersRouter);
app.use('/roles', rolesRouter);
// Agent setup endpoint: returns socket URL and store IDs for the authenticated user's company
app.use('/agent-setup', agentSetupRouter);
app.use('/agent-print', agentPrintRouter);
app.use('/qz-print', qzPrintRouter);
// Simple admin endpoint to view/update printer settings for a company or store
app.use('/settings/printer-setting', printerSettingRouter);
app.use('/cash', cashRouter);
app.use('/qr-action', qrActionRouter);
// Server-side rasterization endpoint (returns PNG data URL)
app.use('/rasterize', rasterizeRouter);
// Dev-only debug agent print route (bypass auth for local development convenience)
if (process.env.NODE_ENV !== 'production') {
  try {
    const debugAgentPrintRouter = await import('./routes/debugAgentPrint.js');
    app.use('/debug/agent-print', debugAgentPrintRouter.default || debugAgentPrintRouter);
    console.log('Mounted /debug/agent-print (dev only)');
  } catch (e) {
    console.warn('Failed to mount debug/agent-print route', e && e.message);
  }
  try {
    const debugEmitRouter = await import('./routes/debugEmitOrder.js');
    app.use('/debug', debugEmitRouter.default || debugEmitRouter);
    console.log('Mounted /debug/emit-test-order (dev only)');
  } catch (e) {
    console.warn('Failed to mount debug emit route', e && e.message);
  }
}

// Serve public files (e.g., generated reports)
const publicDir = path.join(process.cwd(), 'public');
app.use('/public', express.static(publicDir));

// Serve centralized settings folder so images saved under settings/ are publicly available
const settingsDir = path.join(process.cwd(), 'settings');
app.use('/settings', express.static(settingsDir));

// start periodic cleanup of old generated reports
try {
  const cleanupHandle = startReportsCleanup({
    // defaults are used unless env overrides present
  });
  // store on app for diagnostics if needed
  app.locals.reportsCleanup = cleanupHandle;
  console.log('Reports cleanup scheduled (REPORTS_MAX_AGE_HOURS, REPORTS_CLEANUP_INTERVAL_MIN)');
} catch (e) {
  console.error('Failed to start reports cleanup:', e?.message || e);
}

// start periodic cleanup for expired forceOpen flags
try {
  const intervalMin = process.env.FORCEOPEN_CLEANUP_INTERVAL_MIN ? Number(process.env.FORCEOPEN_CLEANUP_INTERVAL_MIN) : undefined
  const forceCleanupHandle = startForceOpenCleanup({ intervalMinutes: intervalMin })
  app.locals.forceOpenCleanup = forceCleanupHandle
  console.log('ForceOpen cleanup scheduled (FORCEOPEN_CLEANUP_INTERVAL_MIN)')
} catch (e) {
  console.error('Failed to start ForceOpen cleanup:', e?.message || e)
}

// ✅ Rota de teste
app.get("/", (req, res) => {
  res.send("✅ API Online e funcional");
});

// Simple health endpoint used by Docker healthchecks and monitoring
app.get('/health', async (req, res) => {
  try {
    // lightweight DB check: simple count query (fast on Postgres)
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      console.error('Health DB check failed', e && e.message);
      return res.status(500).json({ ok: false, db: false });
    }
    return res.json({ ok: true, uptimeSec: Math.floor(process.uptime()) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message) });
  }
});

// Development-only: list connected Socket.IO agents and their metadata
if (process.env.NODE_ENV !== 'production') {
  app.get('/debug/agents', (req, res) => {
    try {
      const ioInstance = app.locals.io;
      if (!ioInstance) return res.status(500).json({ message: 'Socket.IO não inicializado' });

      const storeFilter = req.query.storeId;
      const sockets = Array.from(ioInstance.sockets.sockets.values())
        .map(s => ({ id: s.id, agent: s.agent || null, connected: s.connected, handshakeAuth: (s.handshake && s.handshake.auth) ? s.handshake.auth : null }))
        .filter(s => {
          if (!storeFilter) return true;
          const agentMatch = s.agent && Array.isArray(s.agent.storeIds) && s.agent.storeIds.includes(storeFilter);
          const hs = s.handshakeAuth;
          const hsMatch = hs && ((Array.isArray(hs.storeIds) && hs.storeIds.includes(storeFilter)) || (hs.storeId && String(hs.storeId) === String(storeFilter)));
          return agentMatch || hsMatch;
        });

      return res.json({ count: sockets.length, sockets });
    } catch (e) {
      console.error('GET /debug/agents failed', e);
      return res.status(500).json({ message: 'Erro ao listar agentes', error: String(e && e.message) });
    }
  });

  // Development-only: disconnect agent sockets for a given storeId (useful to remove stale agents)
  app.post('/debug/disconnect-agents', (req, res) => {
    try {
      if (process.env.NODE_ENV === 'production') return res.status(403).json({ message: 'Not allowed in production' });
      const ioInstance = app.locals.io;
      if (!ioInstance) return res.status(500).json({ message: 'Socket.IO não inicializado' });

      const storeId = (req.body && req.body.storeId) || req.query.storeId;
      if (!storeId) return res.status(400).json({ message: 'storeId é obrigatório' });

      const sockets = Array.from(ioInstance.sockets.sockets.values()).filter(s => s.agent && Array.isArray(s.agent.storeIds) && s.agent.storeIds.includes(storeId));
      let disconnected = 0;
      sockets.forEach(s => {
        try {
          s.disconnect(true);
          disconnected++;
          console.log('Disconnected agent socket', s.id, 'for storeId', storeId);
        } catch (e) {
          console.warn('Failed to disconnect socket', s.id, e && e.message);
        }
      });

      return res.json({ ok: true, storeId, disconnected });
    } catch (e) {
      console.error('POST /debug/disconnect-agents failed', e);
      return res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });
}

// Socket.IO instance will be attached by server.js
let io = null;

// Recent emits tracker to avoid broadcasting the same order id repeatedly
const RECENT_EMIT_TTL_MS = process.env.RECENT_EMIT_TTL_MS ? Number(process.env.RECENT_EMIT_TTL_MS) : 15000;
const recentEmits = new Map(); // orderId -> ts
function isRecentlyEmitted(orderId) {
  try {
    if (!orderId) return false;
    const ts = recentEmits.get(orderId);
    if (!ts) return false;
    if ((Date.now() - ts) <= RECENT_EMIT_TTL_MS) return true;
    recentEmits.delete(orderId);
    return false;
  } catch (e) { return false; }
}
function markEmitted(orderId) {
  try {
    if (!orderId) return;
    recentEmits.set(orderId, Date.now());
    setTimeout(() => { try { recentEmits.delete(orderId); } catch (e) {} }, RECENT_EMIT_TTL_MS + 5000);
  } catch (e) {}
}

// Prevent repeated immediate attempts to deliver print jobs for the same
// store(s). Agents may reconnect frequently; avoid reprocessing the same
// stores while a previous delivery attempt is still in progress.
const _processingStores = new Set();

async function processQueueForStoresThrottled(ioInstance, storeIds = []) {
  try {
    if (!Array.isArray(storeIds)) storeIds = [storeIds];
    const toProcess = storeIds.filter(s => !_processingStores.has(s));
    if (!toProcess.length) return { ok: true, results: [] };
    toProcess.forEach(s => _processingStores.add(s));
    const result = await printQueue.processForStores(ioInstance, toProcess);
    return result;
  } finally {
    try { (storeIds || []).forEach(s => _processingStores.delete(s)); } catch (e) { }
  }
}

export function attachSocket(server) {
  if (io) return io; // already attached

  // For development ease we'll allow any origin for Socket.IO when not in production
  // (the Express CORS middleware already allows any origin in dev). In production
  // we restrict Socket.IO to the configured allowedOrigins.
  const sioCors = (process.env.NODE_ENV !== 'production')
    ? { origin: true, methods: ["GET", "POST"] }
    : { origin: allowedOrigins, methods: ["GET", "POST"] };

  io = new Server(server, {
    cors: sioCors,
    // keep regular heartbeat but allow longer timeout for dev environments / slow proxies
    // increase pingTimeout to tolerate slow networks / proxies and avoid premature transport close
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // Socket-level auth for print agents: if the client provides an auth token
  // we validate it against the per-company hashed token stored in PrinterSetting.
  // Regular frontend clients that do not provide `handshake.auth.token` are allowed.
  io.use(async (socket, next) => {
    try {
      const auth = (socket.handshake && socket.handshake.auth) || {};
      const token = auth.token;
      if (!token) return next(); // not an agent, allow

      const storeIds = Array.isArray(auth.storeIds) ? auth.storeIds : (auth.storeId ? [auth.storeId] : []);
      if (!storeIds.length) return next(new Error('agent-missing-storeId'));

      // Resolve company from first storeId. If no store exists with that id,
      // as a developer convenience allow the client to send a company id
      // directly (i.e., the provided id belongs to `company.id`). This
      // enables dev setups where stores are not created but a company exists
      // (or was auto-created via .print-agent-company).
      let companyId = null;
      const storeIdCandidate = storeIds[0];
      const store = await prisma.store.findUnique({ where: { id: storeIdCandidate }, select: { companyId: true } });
      if (store && store.companyId) {
        companyId = store.companyId;
      } else {
        // try interpreting the provided id as a company id
        const maybeCompany = await prisma.company.findUnique({ where: { id: storeIdCandidate }, select: { id: true } });
        if (maybeCompany && maybeCompany.id) {
          companyId = maybeCompany.id;
        }
      }

      if (!companyId) return next(new Error('invalid-storeId'));

      const setting = await prisma.printerSetting.findUnique({ where: { companyId }, select: { agentTokenHash: true } });
      if (!setting || !setting.agentTokenHash) return next(new Error('agent-no-token-configured'));

      const incomingHash = sha256(token);
      if (incomingHash !== setting.agentTokenHash) return next(new Error('invalid-agent-token'));

      // attach agent metadata to socket for later use
      socket.agent = { companyId: store.companyId, storeIds };
      return next();
    } catch (e) {
      console.error('Socket auth error', e);
      return next(new Error('internal'));
    }
  });

  io.on("connection", (socket) => {
    const origin = socket.handshake && socket.handshake.headers && socket.handshake.headers.origin;
    console.log(`📡 Painel conectado: ${socket.id} (origin: ${origin})`);

    // Verbose debug: log handshake.auth and selected handshake fields to help
    // diagnose agents that connect anonymously or with a single storeId.
    try {
      const hs = socket.handshake || {};
      const hsAuth = hs.auth || null;
      const hsInfo = { auth: hsAuth, address: hs.address || null, time: new Date().toISOString() };
      console.log('Socket handshake info:', JSON.stringify(hsInfo, null, 2));
    } catch (e) {
      console.warn('Failed to log socket.handshake for debug', e && e.message);
    }

    // Allow agents to request a freshly generated agent token for their stores
    socket.on('request-agent-token', async (payload, cb) => {
      try {
        // payload may include storeId or storeIds; prefer storeId
        const storeId = payload && payload.storeId;
        let companyId = null;
        if (storeId) {
          try {
            const s = await prisma.store.findUnique({ where: { id: storeId }, select: { companyId: true } });
            if (s && s.companyId) companyId = s.companyId;
          } catch (e) { /* ignore */ }
        }
        if (!companyId && Array.isArray(payload && payload.storeIds) && payload.storeIds.length) {
          try {
            const s = await prisma.store.findUnique({ where: { id: payload.storeIds[0] }, select: { companyId: true } });
            if (s && s.companyId) companyId = s.companyId;
          } catch (e) { /* ignore */ }
        }
        if (!companyId) {
          if (cb) cb(new Error('company-not-resolved'));
          return;
        }
        const { token } = await rotateAgentToken(companyId, app);
        if (cb) cb(null, { token });
      } catch (e) {
        if (cb) cb(new Error(String(e && e.message)));
      }
    });

    // Allow frontend clients to identify themselves by sending a JWT via 'identify'.
    // This attaches `socket.user` so server-side code can target sockets by companyId.
    socket.on('identify', (token) => {
      try {
        const JWT_SECRET = process.env.JWT_SECRET;
        if (!token || !JWT_SECRET) return;
        const user = jwt.verify(token, JWT_SECRET);
        if (user && user.companyId) {
          socket.user = user;
          console.log('Socket identified as user', socket.id, 'companyId', user.companyId);
        }
      } catch (e) {
        // ignore invalid tokens from identify
      }
    });

    // If this socket authenticated as an agent, record connection timestamp
    try {
      if (socket.agent) {
        socket.agent.connectedAt = Date.now();
        console.log('Agent metadata on connect:', socket.id, socket.agent);
        // attempt to process queued print jobs for this agent's stores (fire-and-forget)
        try {
          processQueueForStoresThrottled(io, socket.agent.storeIds).then(r => {
            if (r && r.ok) console.log('Processed print queue for stores', socket.agent.storeIds, 'results:', r.results)
          }).catch(e => console.warn('printQueue.processForStores failed:', e && e.message))
        } catch (e) { /* ignore */ }
      } else {
        // If the socket did not authenticate as an agent but provided storeIds
        // in the handshake.auth, attempt to process the queue for those stores
        try {
          const hs = socket.handshake && socket.handshake.auth ? socket.handshake.auth : null;
          if (hs && Array.isArray(hs.storeIds) && hs.storeIds.length) {
            try {
              processQueueForStoresThrottled(io, hs.storeIds).then(r => {
                if (r && r.ok) console.log('Processed print queue for handshake storeIds', hs.storeIds, 'results:', r.results)
              }).catch(e => console.warn('printQueue.processForStores failed for handshake storeIds:', e && e.message))
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // ignore
    }

    // Allow agents to explicitly signal readiness after connect (agent may emit this)
    socket.on('agent-ready', (payload) => {
      try {
        const storeIds = (payload && Array.isArray(payload.storeIds) && payload.storeIds.length) ? payload.storeIds : (payload && payload.storeId ? [payload.storeId] : null);
        if (!storeIds || !storeIds.length) return;
        try {
          processQueueForStoresThrottled(io, storeIds).then(r => {
            if (r && r.ok) console.log('Processed print queue for agent-ready stores', storeIds, 'results:', r.results)
          }).catch(e => console.warn('printQueue.processForStores failed on agent-ready:', e && e.message))
        } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
    });

    socket.on("disconnect", (reason) => {
      console.warn(`⚠️ Painel desconectado (${reason}): ${socket.id}`);
    });
  });

  return io;
}

// forward nfe authorization events to socket layer so front-end is notified
events.on('nfe.authorized', (payload) => {
  try {
    emitirPedidoAtualizado(payload)
  } catch (e) {
    console.warn('Failed to forward nfe.authorized to socket:', e?.message || e)
  }
})

export function emitirNovoPedido(pedido) {
  if (!io) {
    console.warn("⚠️ Socket.IO ainda não inicializado — pedido não emitido ao painel.");
    return;
  }
  try {
    // Avoid re-emitting the same order id repeatedly in a short window
    const oid = pedido && (pedido.id || pedido.orderId || pedido.externalId) ? (pedido.id || pedido.orderId || pedido.externalId) : null;
    if (oid && isRecentlyEmitted(oid)) {
      console.log('emitirNovoPedido: skipping recent emit for', oid);
      return;
    }
    // Broadcast 'novo-pedido' only to non-agent sockets (dashboard/front-end clients).
    // Agents will receive targeted emits later in the auto-print flow to avoid
    // duplicate 'novo-pedido' deliveries (broadcast + targeted emit).
    const sockets = Array.from(io.sockets.sockets.values());
    let sent = 0;
    for (const s of sockets) {
      try {
        // If socket identifies as an agent (has s.agent), skip broadcast to avoid duplicates
        if (s && s.agent) continue;
        try { s.emit('novo-pedido', pedido); sent++; } catch (e) { /* ignore per-socket */ }
      } catch (e) { /* ignore */ }
    }
    console.log(`📢 Novo pedido emitido para painel (não-agentes): ${sent} sockets — ${pedido.displayId || pedido.id}`);
    try { if (oid) markEmitted(oid); } catch (e) {}
  } catch (e) {
    console.warn('emitirNovoPedido broadcast failed:', e && e.message);
  }
}

export function emitirPedidoAtualizado(pedido) {
  if (!io) {
    console.warn("⚠️ Socket.IO ainda não inicializado — atualização de pedido não emitida.");
    return;
  }
  try {
    const payload = { id: pedido.id, displayId: pedido.displayId, status: pedido.status };
    io.emit('order-updated', payload);
    console.log('📢 Atualização de pedido emitida:', payload);
  } catch (e) {
    console.warn('Falha ao emitir atualização de pedido:', e?.message || e);
  }
}

export { app };