require('dotenv').config();
const path = require('path');
const mkdirp = require('mkdirp');
const { io } = require('socket.io-client');
const printerService = require('./printerService');

const BACKEND_SOCKET_URL = process.env.BACKEND_SOCKET_URL || 'http://localhost:3000';
const STORE_ID = process.env.STORE_ID || process.env.STORE || 'unknown-store';
// support multiple store ids for a single agent (comma-separated)
const STORE_IDS = (process.env.STORE_IDS || process.env.STORE_ID || process.env.STORE || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
let PRINT_AGENT_TOKEN = process.env.PRINT_AGENT_TOKEN || process.env.TOKEN || '';
const fs = require('fs');
// If not provided via env, try to read `.print-agent-token` from project root (dev convenience)
const tokenPath = path.resolve(process.cwd(), '.print-agent-token');
if (!PRINT_AGENT_TOKEN) {
  try {
    if (fs.existsSync(tokenPath)) {
      const raw = fs.readFileSync(tokenPath, { encoding: 'utf8' }).trim();
      if (raw) {
        PRINT_AGENT_TOKEN = raw;
        console.log('Loaded PRINT_AGENT_TOKEN from .print-agent-token file');
      }
    }
  } catch (e) {
    // ignore
  }
}
const NAMESPACE = process.env.SOCKET_NAMESPACE || '/';
const DRY_RUN = (String(process.env.DRY_RUN || 'false').toLowerCase() === 'true');

const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(__dirname, 'logs'));
mkdirp.sync(LOG_DIR);

console.log('Starting Delivery Print Agent');
console.log('Backend:', BACKEND_SOCKET_URL, 'Namespace:', NAMESPACE, 'StoreId:', STORE_ID, 'StoreIds:', STORE_IDS);
if (!PRINT_AGENT_TOKEN) {
  console.warn('Missing PRINT_AGENT_TOKEN at startup. The agent will watch for .print-agent-token and attempt to connect when it appears.');
}
console.log('PRINT_AGENT_TOKEN: **** (present)');
if (DRY_RUN) console.log('DRY_RUN enabled - will not send to physical printer');

// start local HTTP endpoint for receiving print requests (optional)
try {
  require('./print-endpoint');
} catch (e) {
  console.warn('Failed to start print-endpoint server:', e && e.message ? e.message : e);
}

let socket;
let reconnectAttempts = 0;

function connect() {
  const opts = {
    path: undefined,
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    auth: { storeId: STORE_ID, storeIds: STORE_IDS, token: PRINT_AGENT_TOKEN }
  };
  // if namespace is root slash, use base url, else attach namespace
  const url = BACKEND_SOCKET_URL + (NAMESPACE && NAMESPACE !== '/' ? NAMESPACE : '');
  console.log('Connecting to socket ->', url);
  socket = io(url, opts);

  socket.on('connect', () => {
    reconnectAttempts = 0;
    console.log('Socket connected. id:', socket.id);
  });

  // allow server to request a test print via 'test-print'
  socket.on('test-print', async (payload, cb) => {
    try {
      console.log('Received test-print request', payload && payload.printerName ? `(printer: ${payload.printerName})` : '')
      const order = {
        displayId: 'TEST',
        customerName: 'TEST PRINT',
        items: [{ quantity: 1, name: payload && payload.text ? String(payload.text).slice(0,40) : 'TEST', price: 0 }],
        total: 0
      }

      // Allow payload to override dryRun/printerInterface/printerType for this single request.
      const opts = {
        printerInterface: payload && (payload.printerInterface || payload.printerName) ? (payload.printerInterface || payload.printerName) : undefined,
        printerType: payload && payload.printerType ? payload.printerType : undefined,
        printerCodepage: payload && payload.printerCodepage ? payload.printerCodepage : undefined,
        // if payload.dryRun explicitly provided, use it; otherwise undefined so printOrder will fall back to env
        dryRun: payload && typeof payload.dryRun === 'boolean' ? payload.dryRun : undefined
      }

      // If effective dryRun is true, the printerService may still log/format instead of physical printing
      await printerService.printOrder(order, opts)
      if (cb) cb(null, { ok: true })
    } catch (e) {
      console.error('test-print failed', e && e.message ? e.message : e)
      if (cb) cb({ ok: false, error: String(e && e.message) })
    }
  })

  socket.on('connect_error', (err) => {
    reconnectAttempts++;
    console.error('Socket connect_error:', err && err.message ? err.message : err);
  });

  socket.on('disconnect', (reason) => {
    console.warn('Socket disconnected:', reason);
  });

  // expect event name 'novo-pedido' as in frontend
  // Handle server-emitted 'novo-pedido' and call the provided ACK callback so the
  // backend can consider the job delivered. The backend emits with a callback
  // and waits for it (printQueue / agentPrint routes rely on this ACK semantics).
  socket.on('novo-pedido', async (order, cb) => {
    try {
      console.log('Received novo-pedido', order && order.id ? order.id : '(no id)');
      if (DRY_RUN) {
        console.log('DRY_RUN: would print order:', order && order.id);
        // reply via ACK callback
        try { if (typeof cb === 'function') cb(null, { ok: true, status: 'dry-run' }); } catch(e){}
        // also emit a secondary event for telemetry if desired
        try { socket.emit('pedido-impresso', { id: order && order.id, storeId: STORE_ID, status: 'dry-run', ts: Date.now() }); } catch(e){}
        return;
      }

      await printerService.printOrder(order);
      console.log('Printed order', order && order.id);

      // Acknowledge to the emitter via callback so backend knows the job succeeded
      try { if (typeof cb === 'function') cb(null, { ok: true, status: 'printed', ts: Date.now() }); } catch(e){}

      // also emit an event for telemetry/observability
      try { socket.emit('pedido-impresso', { id: order.id, storeId: order?.storeId || STORE_ID, storeIds: STORE_IDS, status: 'printed', ts: Date.now() }); } catch(e){}
    } catch (e) {
      console.error('Failed to print order', e);
      // Notify backend via ACK callback that printing failed
      try { if (typeof cb === 'function') cb({ ok: false, error: String(e && e.message) }); } catch(e){}
      try { socket.emit('pedido-erro-impressao', { id: order && order.id, error: String(e && e.message), ts: Date.now() }); } catch(e){}
    }
  });

  socket.on('connect_timeout', () => console.warn('Socket connect timeout'));

  // accept server-initiated token updates so backend can push new tokens directly
  socket.on('update-agent-token', (payload) => {
    try {
      const t = payload && payload.token;
      if (!t) return;
      if (t === PRINT_AGENT_TOKEN) return;
      PRINT_AGENT_TOKEN = t;
      try { process.env.PRINT_AGENT_TOKEN = PRINT_AGENT_TOKEN; } catch(e){}
      console.log('Received update-agent-token from server; applied new token and reconnecting...');
      try { if (socket) try { socket.close(); } catch(e){} } catch(e){}
      setTimeout(() => connect(), 200);
    } catch (e) {
      console.warn('Failed to apply update-agent-token', e && e.message ? e.message : e);
    }
  });
}

// Start
connect();

// Watch token file for changes so the agent can pick up a newly-generated token
try {
  if (fs.existsSync(tokenPath)) {
    fs.watchFile(tokenPath, { interval: 1000 }, (curr, prev) => {
      try {
        if (!curr || curr.mtimeMs === prev.mtimeMs) return;
        const raw = fs.readFileSync(tokenPath, { encoding: 'utf8' }).trim();
        if (raw && raw !== PRINT_AGENT_TOKEN) {
          PRINT_AGENT_TOKEN = raw;
          console.log('Detected updated .print-agent-token file; updating agent token and reconnecting...');
          // update env so other modules (e.g. print-endpoint) that read process.env
          // can pick up the new token immediately
          try { process.env.PRINT_AGENT_TOKEN = PRINT_AGENT_TOKEN; } catch(e) {}
          try {
            if (socket) {
              try { socket.close(); } catch(e){}
            }
          } catch(e){}
          // allow short delay before reconnect to avoid thundering reconnects
          setTimeout(() => connect(), 500);
        }
      } catch (e) {
        console.warn('Failed to reload .print-agent-token', e && e.message ? e.message : e);
      }
    });
  } else {
    // if file doesn't exist yet, watch parent directory and react when it appears
    const dir = path.dirname(tokenPath);
    fs.watch(dir, (ev, fname) => {
      try {
        if (!fname) return;
        if (fname === path.basename(tokenPath) && fs.existsSync(tokenPath)) {
          const raw = fs.readFileSync(tokenPath, { encoding: 'utf8' }).trim();
          if (raw && raw !== PRINT_AGENT_TOKEN) {
            PRINT_AGENT_TOKEN = raw;
            console.log('Detected new .print-agent-token file; updating agent token and reconnecting...');
            try { process.env.PRINT_AGENT_TOKEN = PRINT_AGENT_TOKEN; } catch(e) {}
            try { if (socket) try { socket.close(); } catch(e){} } catch(e){}
            setTimeout(() => connect(), 500);
          }
        }
      } catch (e) {}
    });
  }
} catch (e) {
  // non-fatal
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  try { socket && socket.close(); } catch(e){}
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection', err);
});
