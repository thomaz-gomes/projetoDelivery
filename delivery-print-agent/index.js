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
let _triedAnonymousReconnect = false;

function connect(forceAnonymous = false) {
  const authPayload = { storeId: STORE_ID, storeIds: STORE_IDS };
  if (!forceAnonymous && PRINT_AGENT_TOKEN) authPayload.token = PRINT_AGENT_TOKEN;

  const opts = {
    path: undefined,
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    auth: authPayload
  };
  // if namespace is root slash, use base url, else attach namespace
  const url = BACKEND_SOCKET_URL + (NAMESPACE && NAMESPACE !== '/' ? NAMESPACE : '');
  console.log('Connecting to socket ->', url);
  try {
    console.log('Socket auth payload:', JSON.stringify(authPayload));
  } catch (e) { /* ignore */ }
  socket = io(url, opts);

  socket.on('connect', () => {
    reconnectAttempts = 0;
    console.log('Socket connected. id:', socket.id);
    // If we don't have a token yet, request one from server (server may generate and return)
    try {
      if (!PRINT_AGENT_TOKEN) {
        try {
          socket.timeout(5000).emit('request-agent-token', { storeIds: STORE_IDS, storeId: STORE_ID }, (err, result) => {
            try {
              if (!err && result && result.token) {
                PRINT_AGENT_TOKEN = result.token;
                try { fs.writeFileSync(tokenPath, PRINT_AGENT_TOKEN, 'utf8'); } catch(e){}
                try { process.env.PRINT_AGENT_TOKEN = PRINT_AGENT_TOKEN; } catch(e){}
                console.log('Received agent token from server on connect; saved and reconnecting...');
                try { if (socket) try { socket.close(); } catch(e){} } catch(e){}
                setTimeout(() => connect(), 300);
              }
            } catch (e) { }
          });
        } catch (e) {}
      }
    } catch (e) {}

      // Notify server explicitly that this agent is ready to receive jobs.
      // This helps setups where agent connected anonymously (no token) but
      // already knows its storeIds — server can then process queued jobs.
      try {
        const readyPayload = { storeIds: STORE_IDS, storeId: STORE_ID };
        try { socket.emit('agent-ready', readyPayload); console.log('Emitted agent-ready', readyPayload); } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
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
    const msg = err && err.message ? err.message : String(err);
    console.error('Socket connect_error:', msg);
    // If server rejected the agent due to unknown storeId or invalid token,
    // attempt a one-time anonymous reconnect so we can request a token via
    // the `request-agent-token` event. This helps dev setups where stores
    // don't exist yet or token mismatches occur.
    if (!forceAnonymous && !_triedAnonymousReconnect && (msg === 'invalid-storeId' || msg === 'invalid-agent-token')) {
      _triedAnonymousReconnect = true;
      console.log('Auth rejected by server; attempting anonymous reconnect to request a token');
      try { if (socket) try { socket.close(); } catch(e){} } catch(e){}
      setTimeout(() => connect(true), 300);
      return;
    }
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
      // Normalize incoming payload: accept either order or { order: ... } shapes
      let incoming = order || {};
      if (incoming && incoming.order) incoming = incoming.order;
      // ensure we have some id to avoid undefined logs; prefer existing ids or fallback
      if (!incoming.id) incoming.id = incoming.orderId || incoming.externalId || (incoming.payload && (incoming.payload.id || incoming.payload.orderId)) || (`noid-${Date.now()}`);
      console.log('Received novo-pedido', incoming && incoming.id ? incoming.id : '(no id)');
      if (DRY_RUN) {
        console.log('DRY_RUN: would print order:', order && order.id);
        // reply via ACK callback
        try { if (typeof cb === 'function') cb(null, { ok: true, status: 'dry-run' }); } catch(e){}
        // also emit a secondary event for telemetry if desired
        try { socket.emit('pedido-impresso', { id: order && order.id, storeId: STORE_ID, status: 'dry-run', ts: Date.now() }); } catch(e){}
        return;
      }

      // If the incoming order payload included printer hints (attached by
      // server from PrinterSetting) pass them as opts so the agent uses the
      // configured printerInterface/type/width for this job.
      const opts = {
        printerInterface: incoming && (incoming.printerInterface || incoming.printerName) ? (incoming.printerInterface || incoming.printerName) : undefined,
        printerType: incoming && incoming.printerType ? incoming.printerType : undefined,
        paperWidth: incoming && incoming.paperWidth ? incoming.paperWidth : undefined,
        includeFullOrder: incoming && typeof incoming.includeFullOrder !== 'undefined' ? !!incoming.includeFullOrder : undefined,
        printerCodepage: incoming && incoming.printerCodepage ? incoming.printerCodepage : undefined
      };
      const printedResult = await printerService.printOrder(incoming, opts);
      console.log('Print result for order', incoming && incoming.id, printedResult);

      // Acknowledge to the emitter via callback so backend knows the job succeeded
      try {
        if (typeof cb === 'function') {
          if (printedResult === false) cb(null, { ok: true, status: 'skipped', ts: Date.now() });
          else cb(null, { ok: true, status: 'printed', ts: Date.now() });
        }
      } catch(e){}

      // also emit an event for telemetry/observability
      try {
        const status = (printedResult === false) ? 'skipped' : 'printed';
        socket.emit('pedido-impresso', { id: incoming.id, storeId: incoming?.storeId || STORE_ID, storeIds: STORE_IDS, status, ts: Date.now() });
      } catch(e){}
    } catch (e) {
      console.error('Failed to print order', e);
      // Notify backend via ACK callback that printing failed
      try { if (typeof cb === 'function') cb({ ok: false, error: String(e && e.message) }); } catch(e){}
      try { socket.emit('pedido-erro-impressao', { id: order && order.id, error: String(e && e.message), ts: Date.now() }); } catch(e){}
    }
  });

  socket.on('connect_timeout', () => console.warn('Socket connect timeout'));

  // Respond to printer discovery requests from backend: try local helper HTTP
  socket.on('list-printers', async (payload, cb) => {
    try {
      const port = process.env.PRINTER_HTTP_PORT || 4000;
      const url = `http://localhost:${port}/printers`;
      let list = [];
      try {
        const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : (await import('node-fetch')).default;
        const res = await fetchFn(url);
        if (res && res.ok) {
          list = await res.json();
          // normalize to simple array of names
          if (Array.isArray(list)) list = list.map(p => p && (p.name || p.Name) ? (p.name || p.Name) : String(p)).slice(0,50);
        }
      } catch (e) {
        // ignore fetch errors
        list = [];
      }
      try { if (typeof cb === 'function') cb(null, list); } catch(e){}
    } catch (e) {
      try { if (typeof cb === 'function') cb({ ok: false, error: String(e && e.message) }); } catch(e){}
    }
  });

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

  // Also accept agent-token-rotated events (backend may emit this name)
  socket.on('agent-token-rotated', (payload) => {
    try {
      const t = payload && payload.token;
      if (!t) return;
      if (t === PRINT_AGENT_TOKEN) return;
      PRINT_AGENT_TOKEN = t;
      try { process.env.PRINT_AGENT_TOKEN = PRINT_AGENT_TOKEN; } catch(e){}
      try { fs.writeFileSync(tokenPath, PRINT_AGENT_TOKEN, 'utf8'); } catch(e){}
      console.log('Received agent-token-rotated from server; applied new token and reconnecting...');
      try { if (socket) try { socket.close(); } catch(e){} } catch(e){}
      setTimeout(() => connect(), 200);
    } catch (e) {
      console.warn('Failed to apply agent-token-rotated', e && e.message ? e.message : e);
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
