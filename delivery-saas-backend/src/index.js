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
import { integrationsRouter, aiqfomeCallbackRouter } from "./routes/integrations.js";
import { fileSourcesRouter } from "./routes/fileSources.js";
import { ifoodRouter } from "./routes/ifood.js";
import { ridersRouter } from "./routes/riders.js";
import { customersRouter } from "./routes/customers.js";
import { neighborhoodsRouter } from "./routes/neighborhoods.js";
import { waRouter } from "./routes/whatsapp/wa.js";
import { affiliatesRouter } from "./routes/affiliates/affiliates.js";
import { couponsRouter } from "./routes/coupons/coupons.js";
import publicMenuRouter from './routes/publicMenu.js'
import publicCartRouter from './routes/publicCart.js'
import { publicTrackingRouter } from './routes/publicTracking.js'
import menuAdminRouter from './routes/menu.js'
import menuOptionsRouter from './routes/menuOptions.js'
import menuImportRouter from './routes/menuImport.js'
import menuIntegrationRouter from './routes/menuIntegration.js'
import { nfeRouter } from './routes/nfe.js'
import companiesRouter from './routes/companies.js'
import storesRouter from './routes/stores.js'
import storePricingDefaultsRouter from './routes/storePricingDefaults.js'
import usersRouter from './routes/users.js'
import rolesRouter from './routes/rolePermissions.js'
import ingredientGroupsRouter from './routes/stock/ingredientGroups.js'
import ingredientsRouter from './routes/stock/ingredients.js'
import technicalSheetsRouter from './routes/stock/technicalSheets.js'
import technicalSheetImportRouter from './routes/stock/technicalSheetImport.js'
import ingredientImportRouter from './routes/stock/ingredientImport.js'
import stockMovementsRouter from './routes/stock/stockMovements.js'
import purchaseImportRouter from './routes/stock/purchaseImport.js'
import agentSetupRouter, { agentPairRouter } from './routes/agentSetup.js'
import agentPrintRouter from './routes/agentPrint.js'
import qrActionRouter from './routes/qrAction.js'
import rasterizeRouter from './routes/rasterize.js'
import printerSettingRouter from './routes/printerSetting.js'
import cashRouter from './routes/cash.js'
import customerGroupsRouter from './routes/customerGroups.js'
import cashbackRouter from './routes/cashback/cashback.js'
import checkoutRouter from './routes/checkout.js'
import events from './utils/events.js'
import printQueue from './printQueue.js'
import { prisma } from './prisma.js'
import { sha256 } from './utils.js'
import { rotateAgentToken } from './agentTokenManager.js'
import path from 'path';
import startReportsCleanup from './cleanupReports.js';
import startForceOpenCleanup from './cleanupForceOpen.js';
import saasRouter from './routes/saas.js'
import { requireModule } from './modules.js'
import financialRouter from './routes/financial/index.js'
import metaPixelRouter from './routes/metaPixel.js'
import mediaRouter from './routes/media.js'
import dadosFiscaisRouter from './routes/dadosFiscais.js'
import productReportsRouter from './routes/reports/products.js'
import menuPerformanceRouter from './routes/reports/menuPerformance.js'
import ridersDashboardRouter from './routes/reports/ridersDashboard.js'
import aiCreditsRouter from './routes/aiCredits.js'
import aiStudioRouter from './routes/aiStudio.js'
import { paymentRouter } from './routes/payment.js'
import leadsRouter from './routes/leads.js'
import customDomainRouter from './routes/customDomain.js'
import webhookEvolutionRouter from './routes/webhookEvolution.js'
import inboxRouter from './routes/inbox.js'
import ifoodChatRouter from './routes/ifoodChat.js'
import { customDomainResolver } from './middleware/customDomainResolver.js'
import './cron.js'

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
  // Cache of verified custom domain origins: origin -> { allowed: bool, ts: number }
  const _corsCustomDomainCache = new Map();
  const CORS_CACHE_TTL = 5 * 60 * 1000; // 5 min

  app.use(
    cors({
      origin: async (origin, cb) => {
        // DEV convenience: allow any origin when not in production to avoid frequent CORS pain
        if (process.env.NODE_ENV !== 'production') {
          try { console.log('CORS check (dev) - incoming Origin:', origin); } catch(_){ }
          return cb(null, true);
        }
        // allow requests with no origin (mobile apps, curl) or if origin is in the list
        if (!origin || allowedOrigins.indexOf(origin) !== -1) return cb(null, true);

        // Check if origin is a custom domain (e.g. https://www.almocaidelivery.com.br)
        try {
          const now = Date.now();
          const cached = _corsCustomDomainCache.get(origin);
          if (cached && (now - cached.ts) < CORS_CACHE_TTL) {
            return cached.allowed ? cb(null, true) : cb(new Error('CORS not allowed for origin: ' + origin));
          }

          const hostname = new URL(origin).hostname.toLowerCase();
          // Try exact match, then www variant
          let record = await prisma.customDomain.findUnique({ where: { domain: hostname }, select: { status: true } });
          if (!record) {
            const alt = hostname.startsWith('www.') ? hostname.slice(4) : `www.${hostname}`;
            record = await prisma.customDomain.findUnique({ where: { domain: alt }, select: { status: true } });
          }

          // Allow CORS for any known custom domain (regardless of status)
          // so the SPA can make API calls even during provisioning
          const allowed = !!record;
          _corsCustomDomainCache.set(origin, { allowed, ts: now });

          if (allowed) return cb(null, true);
        } catch (e) {
          console.error('CORS custom domain check error:', e?.message);
        }

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
      // In production, only allow configured origins and active custom domains.
      if (origin && allowedOrigins.indexOf(origin) !== -1) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
      } else if (origin) {
        // Check if this origin was already validated as a custom domain by the cors() middleware
        // The cors() middleware sets the header on success; if missing here, trust its cache
        const existing = res.getHeader('Access-Control-Allow-Origin');
        if (existing) {
          // Already set by cors() — keep it
        }
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
app.use(bodyParser.json({ limit: "50mb", verify: (req, _res, buf) => { try { req.rawBody = buf && buf.toString ? buf.toString() : null } catch(_) { req.rawBody = null } } }));

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

// Custom domain resolver — must be before routes
app.use(customDomainResolver());

// ==============================
// 🔗 Public webhooks (no JWT auth)
// ==============================
app.use('/webhook/evolution', webhookEvolutionRouter);

// ==============================
// 🚏 Rotas principais
// ==============================
app.use("/auth", authRouter);
app.use("/webhooks", webhooksRouter);
app.use("/orders", ordersRouter);
app.use("/tickets", ticketsRouter);
app.use("/integrations", aiqfomeCallbackRouter); // aiqfome OAuth callback (no auth)
app.use("/integrations", integrationsRouter);
app.use('/file-sources', fileSourcesRouter);
app.use("/ifood", requireModule('ifood'), ifoodRouter);
app.use("/riders", ridersRouter);
app.use("/customers", customersRouter);
app.use("/neighborhoods", neighborhoodsRouter);
app.use("/wa", requireModule('WHATSAPP'), waRouter);
app.use('/inbox', requireModule('WHATSAPP'), inboxRouter);
app.use("/affiliates", affiliatesRouter);
app.use('/coupons', requireModule('COUPONS'), couponsRouter);
app.use('/public', publicMenuRouter);
app.use('/public', leadsRouter);
// Public cart endpoints (evaluations) for a given companyId
app.use('/public/:companyId/cart', publicCartRouter);
app.use('/public/tracking', publicTrackingRouter);
app.use('/menu', menuAdminRouter);
app.use('/menu/options', menuOptionsRouter);
app.use('/menu', menuImportRouter);
app.use('/menu/integration', menuIntegrationRouter);
app.use('/nfe', requireModule('nfe'), nfeRouter);
app.use('/settings', companiesRouter);
// Mount menu admin router also under /settings to provide backward-compatible
// API paths such as /settings/payment-methods for external consumers that
// expect the payment-methods resource to live under settings. This keeps the
// same handlers available at both /menu/* and /settings/*.
app.use('/settings', menuAdminRouter);
app.use('/stores', storesRouter);
app.use('/stores', storePricingDefaultsRouter);
app.use('/users', usersRouter);
app.use('/roles', rolesRouter);
app.use('/ingredient-groups', requireModule('STOCK'), ingredientGroupsRouter);
app.use('/ingredients', requireModule('STOCK'), ingredientsRouter);
app.use('/ingredients', requireModule('STOCK'), ingredientImportRouter);
app.use('/technical-sheets', requireModule('STOCK'), technicalSheetsRouter);
app.use('/technical-sheets', requireModule('STOCK'), technicalSheetImportRouter);
app.use('/stock-movements', requireModule('STOCK'), stockMovementsRouter);
app.use('/purchase-imports', requireModule('STOCK'), purchaseImportRouter);
// Agent pairing endpoint (unauthenticated - agent has no token yet)
app.use('/agent-setup', agentPairRouter);
// Agent setup endpoint: returns socket URL and store IDs for the authenticated user's company
app.use('/agent-setup', agentSetupRouter);
app.use('/agent-print', requireModule('printing'), agentPrintRouter);
// SaaS management (plans, modules, subscriptions, invoices)
app.use('/saas', saasRouter);
// AI Credits: saldo, histórico e gestão de créditos de IA por empresa
app.use('/ai-credits', aiCreditsRouter);
app.use('/ai-studio', aiStudioRouter);
// Payment webhook (gateway-agnostic, no auth — validated by paymentId)
app.use('/payment', paymentRouter);
app.use('/custom-domains', customDomainRouter);
// Simple admin endpoint to view/update printer settings for a company or store
app.use('/settings/printer-setting', printerSettingRouter);
app.use('/cash', cashRouter);
app.use('/customer-groups', customerGroupsRouter);
app.use('/qr-action', qrActionRouter);
app.use('/cashback', requireModule('CASHBACK'), cashbackRouter);
app.use('/financial', requireModule('FINANCIAL'), financialRouter);
app.use('/reports/products', productReportsRouter);
app.use('/reports/menu-performance', menuPerformanceRouter);
app.use('/reports/riders-dashboard', ridersDashboardRouter);
app.use('/meta-pixel', metaPixelRouter);
app.use('/media', mediaRouter);
app.use('/settings', dadosFiscaisRouter);
app.use('/fiscal', dadosFiscaisRouter);
app.use('/checkout', checkoutRouter);
app.use('/ifood-chat', ifoodChatRouter);
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
  try {
    const debugEmitStoreRouter = await import('./routes/debugEmitStoreUpdate.js');
    app.use('/debug/emit-store-update', debugEmitStoreRouter.default || debugEmitStoreRouter);
    console.log('Mounted /debug/emit-store-update (dev only)');
  } catch (e) {
    console.warn('Failed to mount debug emit-store-update route', e && e.message);
  }
}

// Serve public files (e.g., generated reports)
const publicDir = path.join(process.cwd(), 'public');
app.use('/public', express.static(publicDir));

// Serve downloads (e.g., delivery-print-agent-setup.exe)
const downloadsDir = path.join(process.cwd(), 'downloads');
app.use('/downloads', express.static(downloadsDir, { dotfiles: 'deny' }));

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

// Emit functions are extracted to ./socketEmitters.js so they can be unit-tested
// in isolation from the rest of the server. Re-exports below preserve the
// existing public surface (callers still import from ./index.js).
import {
  setIo as _setEmitterIo,
  emitirNovoPedido as _emitirNovoPedido,
  emitirPedidoAtualizado as _emitirPedidoAtualizado,
  emitirPosicaoEntregador as _emitirPosicaoEntregador,
  emitirEntregadorOffline as _emitirEntregadorOffline,
  emitirIfoodChat as _emitirIfoodChat,
} from './socketEmitters.js';

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

  // Socket.IO CORS: aceitar origens do frontend E o próprio servidor (para agentes Electron).
  // O socket.io-client em Node.js envia Origin: <serverUrl> que não está em allowedOrigins,
  // causando rejeição 403 → "server error" no cliente. A segurança real é feita pelo
  // middleware de auth (token hash), não pelo CORS — por isso aceitamos qualquer origem aqui.
  const sioCors = {
    origin: (origin, callback) => {
      // Sem Origin (clientes Node.js puros) → permitir
      if (!origin) return callback(null, true);
      // Origens do frontend configuradas → permitir
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Qualquer origem HTTPS → permitir (inclui o próprio servidor, agentes, apps mobile)
      // A autenticação real é feita pelo token no handshake, não pelo CORS
      if (origin.startsWith('https://')) return callback(null, true);
      // Extensões Chrome → permitir (extensão iFood Chat)
      if (origin.startsWith('chrome-extension://')) return callback(null, true);
      // Electron/apps locais: localhost em qualquer porta → permitir (agente de impressão Windows)
      if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      // Em dev: aceitar tudo
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      // HTTP externo em produção → rejeitar
      callback(new Error('CORS: origem não permitida: ' + origin), false);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  };

  io = new Server(server, {
    cors: sioCors,
    // keep regular heartbeat but allow longer timeout for dev environments / slow proxies
    // increase pingTimeout to tolerate slow networks / proxies and avoid premature transport close
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // Inject io instance into socketEmitters module so emit functions can use it.
  _setEmitterIo(io);

  // Expose io to Express routes (e.g. webhook handlers) via app.set
  app.set('io', io);

  // Socket-level auth for print agents: if the client provides an auth token
  // we validate it against the per-company hashed token stored in PrinterSetting.
  // Regular frontend clients that do not provide `handshake.auth.token` are allowed.
  io.use(async (socket, next) => {
    try {
      const auth = (socket.handshake && socket.handshake.auth) || {};
      const token = auth.token;

      // Debug: log every agent handshake attempt
      if (token) {
        console.log(`[agent-auth] Handshake recebido | ip=${socket.handshake.address} | companyId=${auth.companyId || '—'} | hasStoreIds=${Array.isArray(auth.storeIds) && auth.storeIds.length > 0} | tokenPrefix=${token.slice(0, 8)}…`);
      }

      if (!token) return next(); // not an agent, allow

      // Resolve companyId from auth. Preferred: auth.companyId (sent directly).
      // Legacy fallback: auth.storeIds[0] which may be a storeId or companyId.
      let companyId = null;

      if (auth.companyId) {
        // New preferred method: agent sends companyId directly
        const maybeCompany = await prisma.company.findUnique({ where: { id: auth.companyId }, select: { id: true } });
        if (maybeCompany) {
          companyId = maybeCompany.id;
          console.log(`[agent-auth] companyId resolvido diretamente: ${companyId}`);
        } else {
          console.warn(`[agent-auth] companyId "${auth.companyId}" não encontrado no banco`);
        }
      } else {
        // Legacy: resolve from storeIds array
        const storeIds = Array.isArray(auth.storeIds) ? auth.storeIds : (auth.storeId ? [auth.storeId] : []);
        console.log(`[agent-auth] fallback legacy — storeIds recebidos: ${JSON.stringify(storeIds)}`);
        if (!storeIds.length) {
          console.warn('[agent-auth] rejeitado: sem companyId nem storeIds');
          return next(new Error('agent-missing-companyId'));
        }

        const candidate = storeIds[0];
        const store = await prisma.store.findUnique({ where: { id: candidate }, select: { companyId: true } });
        if (store && store.companyId) {
          companyId = store.companyId;
          console.log(`[agent-auth] companyId resolvido via storeId: ${companyId}`);
        } else {
          // candidate might itself be a companyId
          const maybeCompany = await prisma.company.findUnique({ where: { id: candidate }, select: { id: true } });
          if (maybeCompany) {
            companyId = maybeCompany.id;
            console.log(`[agent-auth] companyId resolvido via candidate-como-company: ${companyId}`);
          } else {
            console.warn(`[agent-auth] candidate "${candidate}" não é storeId nem companyId`);
          }
        }
      }

      if (!companyId) {
        console.warn(`[agent-auth] rejeitado: companyId não resolvido`);
        return next(new Error('invalid-companyId'));
      }

      const setting = await prisma.printerSetting.findUnique({ where: { companyId }, select: { agentTokenHash: true } });
      if (!setting || !setting.agentTokenHash) {
        console.warn(`[agent-auth] rejeitado: PrinterSetting sem agentTokenHash para companyId=${companyId}`);
        return next(new Error('agent-no-token-configured'));
      }

      const incomingHash = sha256(token);
      if (incomingHash !== setting.agentTokenHash) {
        console.warn(`[agent-auth] rejeitado: token hash não confere para companyId=${companyId}`);
        return next(new Error('invalid-agent-token'));
      }

      // Fetch all storeIds for this company so routing (e.g. print-test) works correctly
      const stores = await prisma.store.findMany({ where: { companyId }, select: { id: true } });
      socket.agent = { companyId, storeIds: stores.map(s => s.id) };
      console.log(`[agent-auth] ✅ Agente autenticado | companyId=${companyId} | storeIds=${JSON.stringify(socket.agent.storeIds)}`);
      return next();
    } catch (e) {
      console.error('[agent-auth] Exceção no middleware:', e && e.stack ? e.stack : e);
      return next(new Error('internal'));
    }
  });

  // Extension authentication (similar to agent auth)
  io.use(async (socket, next) => {
    const extensionToken = socket.handshake.auth.extensionToken;
    if (extensionToken) {
      try {
        const companyId = socket.handshake.auth.companyId;
        if (!companyId) return next(new Error('extension-missing-companyId'));
        const setting = await prisma.printerSetting.findUnique({
          where: { companyId },
          select: { extensionTokenHash: true },
        });
        if (!setting || !setting.extensionTokenHash) return next(new Error('extension-not-configured'));
        const incomingHash = sha256(extensionToken);
        if (incomingHash !== setting.extensionTokenHash) return next(new Error('invalid-extension-token'));
        socket.extension = { companyId };
        socket.companyId = companyId;
        console.log(`🧩 Extensão iFood autenticada — company: ${companyId}`);
      } catch (e) {
        return next(new Error('extension-auth-error'));
      }
      return next();
    }
    return next();
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
    // This attaches `socket.user` and joins the company room so the socket can
    // receive scoped events like inbox:new-message after authenticating.
    socket.on('identify', (rawToken) => {
      try {
        const JWT_SECRET = process.env.JWT_SECRET;
        // Be defensive: accept either a raw token string or { token } object
        const token = typeof rawToken === 'string' ? rawToken : (rawToken && rawToken.token);
        if (!token || !JWT_SECRET) return;
        const user = jwt.verify(token, JWT_SECRET);
        if (user && user.companyId) {
          socket.user = user;
          try {
            socket.join(`company_${user.companyId}`);
            console.log('Socket identified and joined room', socket.id, `company_${user.companyId}`);
          } catch (e) {
            console.warn('Failed to join company room after identify', e && e.message);
          }
        }
      } catch (e) {
        console.warn('[identify] token verification failed:', e && e.message);
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

    // Join company-specific room when possible so we can emit scoped events.
    try {
      // 1) agent sockets carry companyId
      if (socket.agent && socket.agent.companyId) {
        try { socket.join(`company_${socket.agent.companyId}`); console.log('Socket joined company room', `company_${socket.agent.companyId}`) } catch (e) {}
      }
      // 2) identified users via 'identify' will have socket.user set by the 'identify' handler above
      if (socket.user && socket.user.companyId) {
        try { socket.join(`company_${socket.user.companyId}`); console.log('Socket joined company room', `company_${socket.user.companyId}`) } catch (e) {}
      }
      // 3) allow clients to request joining by providing companyId in handshake.auth
      try {
        const hsAuth = socket.handshake && socket.handshake.auth ? socket.handshake.auth : null
        if (hsAuth && (hsAuth.companyId || hsAuth.company)) {
          const cid = hsAuth.companyId || hsAuth.company
          try { socket.join(`company_${cid}`); console.log('Socket joined company room from handshake', `company_${cid}`) } catch (e) {}
        }
      } catch (e) {}
    } catch (e) { /* non-fatal */ }

    // Allow agents to explicitly signal readiness after connect (agent may emit this)
    socket.on('agent-ready', (payload) => {
      try {
        // Prefer storeIds already resolved during auth (socket.agent) over payload
        let storeIds = socket.agent && Array.isArray(socket.agent.storeIds) && socket.agent.storeIds.length
          ? socket.agent.storeIds
          : null;

        // Fallback to payload (legacy agents send storeIds in payload)
        if (!storeIds) {
          storeIds = (payload && Array.isArray(payload.storeIds) && payload.storeIds.length)
            ? payload.storeIds
            : (payload && payload.storeId ? [payload.storeId] : null);
        }

        if (!storeIds || !storeIds.length) {
          console.log('[agent-ready] nenhum storeId resolvido — payload:', JSON.stringify(payload), '| socket.agent:', JSON.stringify(socket.agent));
          return;
        }
        console.log('[agent-ready] processando fila para lojas:', storeIds);
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

// Re-export emit helpers from ./socketEmitters.js for backward compatibility.
// Existing callers import these from './index.js' (direct or via dynamic import);
// keeping the surface identical avoids touching unrelated files.
export const emitirNovoPedido = _emitirNovoPedido;
export const emitirPedidoAtualizado = _emitirPedidoAtualizado;
export const emitirPosicaoEntregador = _emitirPosicaoEntregador;
export const emitirEntregadorOffline = _emitirEntregadorOffline;
export const emitirIfoodChat = _emitirIfoodChat;

export { app };