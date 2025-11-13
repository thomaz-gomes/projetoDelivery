// src/index.js
import express from "express";
// note: server creation moved to server.js so Socket.IO can attach to the real HTTPS server
import { Server } from "socket.io";
import cors from "cors";
import bodyParser from "body-parser";

// ✅ importe as rotas
import { webhooksRouter } from "./routes/webhooks.js";
import { authRouter } from "./routes/auth.js";
import { ordersRouter } from "./routes/orders.js";
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
import events from './utils/events.js'
import path from 'path';
import startReportsCleanup from './cleanupReports.js';

const app = express();

// ==============================
// 🌐 Middleware global
// ==============================
app.use(
  cors({
    origin: ["https://localhost:5173"], // front Vue local
    credentials: true,
  })
);
app.use(bodyParser.json({ limit: "10mb" }));

// ==============================
// 🚏 Rotas principais
// ==============================
app.use("/auth", authRouter);
app.use("/webhooks", webhooksRouter);
app.use("/orders", ordersRouter);
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

// Serve public files (e.g., generated reports)
const publicDir = path.join(process.cwd(), 'public');
app.use('/public', express.static(publicDir));

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

  io = new Server(server, {
    cors: {
      origin: ["https://localhost:5173"],
      methods: ["GET", "POST"],
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  io.on("connection", (socket) => {
    console.log(`📡 Painel conectado: ${socket.id}`);

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