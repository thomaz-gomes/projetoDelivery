// src/index.js
// Disable debug logs from dependencies (e.g., engine.io / socket.io) to keep server logs clean
import debug from 'debug';
try { debug.disable(); } catch (_) {}

import express from "express";
// note: server creation moved to server.js so Socket.IO can attach to the real HTTPS server
import { Server } from "socket.io";
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
import events from './utils/events.js'
import path from 'path';
import startReportsCleanup from './cleanupReports.js';

const app = express();

// ==============================
// 🌐 Middleware global
// ==============================
// Allow the frontend origin(s). Prefer explicit origins for CORS + credentials.
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN || 'https://localhost:5173',
  'https://dev.redemultilink.com.br:5173'
];

app.use(
  cors({
    origin: (origin, cb) => {
      // DEV convenience: allow any origin when not in production to avoid frequent CORS pain
      if (process.env.NODE_ENV !== 'production') {
        try { console.log('CORS check (dev) - incoming Origin:', origin); } catch(_){}
        return cb(null, true);
      }
      // allow requests with no origin (mobile apps, curl) or if origin is in the list
      if (!origin || allowedOrigins.indexOf(origin) !== -1) return cb(null, true);
      return cb(new Error('CORS not allowed for origin: ' + origin));
    },
    credentials: true,
  })
);
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

// ✅ Rota de teste
app.get("/", (req, res) => {
  res.send("✅ API Online e funcional");
});

// Socket.IO instance will be attached by server.js
let io = null;

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

  io.on("connection", (socket) => {
    const origin = socket.handshake && socket.handshake.headers && socket.handshake.headers.origin;
    console.log(`📡 Painel conectado: ${socket.id} (origin: ${origin})`);

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
  io.emit("novo-pedido", pedido);
  console.log("📢 Novo pedido emitido:", pedido.displayId || pedido.id);
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