/**
 * delivery-print-agent - Agente local de impressão para SaaS de delivery
 *
 * Conecta ao backend via Socket.IO, recebe pedidos novos e imprime
 * automaticamente na impressora térmica do cliente.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mkdirp = require('mkdirp');
const { io } = require('socket.io-client');
const printerService = require('./printerService');

// --- Configuração ---
const BACKEND_SOCKET_URL = process.env.BACKEND_SOCKET_URL || 'http://localhost:3000';
const STORE_ID = process.env.STORE_ID || process.env.STORE || 'unknown-store';
const STORE_IDS = (process.env.STORE_IDS || process.env.STORE_ID || process.env.STORE || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(__dirname, 'logs'));

mkdirp.sync(LOG_DIR);

// --- Token ---
let PRINT_AGENT_TOKEN = process.env.PRINT_AGENT_TOKEN || process.env.TOKEN || '';
const tokenPath = path.resolve(process.cwd(), '.print-agent-token');

if (!PRINT_AGENT_TOKEN) {
  try {
    if (fs.existsSync(tokenPath)) {
      const raw = fs.readFileSync(tokenPath, 'utf8').trim();
      if (raw) {
        PRINT_AGENT_TOKEN = raw;
        console.log('Loaded PRINT_AGENT_TOKEN from .print-agent-token file');
      }
    }
  } catch (e) { /* ignore */ }
}

console.log('Starting Delivery Print Agent');
console.log('Backend:', BACKEND_SOCKET_URL, 'StoreIds:', STORE_IDS);
console.log('Token:', PRINT_AGENT_TOKEN ? '****' : '(missing)');
if (DRY_RUN) console.log('DRY_RUN enabled');

// --- Socket.IO ---
let socket;
let _triedAnonymousReconnect = false;

function connect(forceAnonymous = false) {
  const authPayload = { storeId: STORE_ID, storeIds: STORE_IDS };
  if (!forceAnonymous && PRINT_AGENT_TOKEN) authPayload.token = PRINT_AGENT_TOKEN;

  socket = io(BACKEND_SOCKET_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    auth: authPayload
  });

  // --- Conectado ---
  socket.on('connect', () => {
    console.log('Socket connected. id:', socket.id);

    // Se não temos token, pedir ao server
    if (!PRINT_AGENT_TOKEN) {
      try {
        socket.timeout(5000).emit('request-agent-token', { storeIds: STORE_IDS, storeId: STORE_ID }, (err, result) => {
          if (!err && result && result.token) {
            PRINT_AGENT_TOKEN = result.token;
            try { fs.writeFileSync(tokenPath, PRINT_AGENT_TOKEN, 'utf8'); } catch (e) {}
            console.log('Received agent token from server; reconnecting...');
            try { socket.close(); } catch (e) {}
            setTimeout(() => connect(), 300);
          }
        });
      } catch (e) { /* ignore */ }
    }

    // Sinalizar que estamos prontos
    try {
      socket.emit('agent-ready', { storeIds: STORE_IDS, storeId: STORE_ID });
    } catch (e) { /* ignore */ }
  });

  // --- Novo pedido (impressão automática) ---
  socket.on('novo-pedido', async (order, cb) => {
    try {
      let incoming = order || {};
      // O backend pode enviar { order: {...}, text, storeId, ... } ou o pedido diretamente.
      // Preservar campos importantes do wrapper antes de extrair .order
      const wrapper = incoming;
      if (incoming.order) {
        // Copiar campos do wrapper para dentro do order se não existirem lá
        const fieldsToPreserve = ['qrText', 'qrDataUrl', 'address', 'receiptTemplate', 'copies',
          'printerName', 'headerName', 'headerCity', 'printerInterface', 'printerType', 'paperWidth'];
        for (const f of fieldsToPreserve) {
          if (wrapper[f] && !incoming.order[f]) incoming.order[f] = wrapper[f];
        }
        incoming = incoming.order;
      }
      if (!incoming.id) incoming.id = incoming.orderId || incoming.externalId || `noid-${Date.now()}`;

      // Resolver qrText de payload.qrText se não estiver no top-level
      if (!incoming.qrText && incoming.payload) {
        incoming.qrText = incoming.payload.qrText || incoming.payload.qr_text || null;
      }

      // Resolver address de payload se ausente
      if (!incoming.address || incoming.address === '-') {
        try {
          const p = incoming.payload || {};
          const da = (p.delivery && p.delivery.deliveryAddress) || p.deliveryAddress || null;
          if (da && typeof da === 'object') {
            if (da.formattedAddress) {
              incoming.address = da.formattedAddress;
            } else {
              const parts = [];
              if (da.streetName || da.street) parts.push(da.streetName || da.street);
              if (da.streetNumber || da.number) parts.push(da.streetNumber || da.number);
              if (da.complement) parts.push(da.complement);
              if (da.neighborhood || da.bairro) parts.push(da.neighborhood || da.bairro);
              if (da.city) parts.push(da.city);
              if (parts.length) incoming.address = parts.join(', ');
            }
          }
        } catch (e) { /* ignore */ }
      }

      console.log('Received novo-pedido', incoming.id);
      // Debug: log address and QR data available
      try {
        console.log('  address:', incoming.address || '(none)');
        console.log('  qrText:', incoming.qrText || '(none)');
        console.log('  payload.qrText:', (incoming.payload && incoming.payload.qrText) || '(none)');
      } catch(e) {}

      if (DRY_RUN) {
        console.log('DRY_RUN: would print order:', incoming.id);
        if (typeof cb === 'function') cb(null, { ok: true, status: 'dry-run' });
        try { socket.emit('pedido-impresso', { id: incoming.id, storeId: STORE_ID, status: 'dry-run', ts: Date.now() }); } catch (e) {}
        return;
      }

      const opts = {
        printerName: incoming.printerName || undefined,
        printerType: incoming.printerType || undefined,
        width: incoming.paperWidth || undefined,
        receiptTemplate: incoming.receiptTemplate || undefined,
        copies: incoming.copies || undefined,
        headerName: incoming.headerName || undefined,
        headerCity: incoming.headerCity || undefined
      };

      const result = await printerService.printOrder(incoming, opts);

      // ACK para o backend
      if (typeof cb === 'function') {
        const status = result === false ? 'skipped' : 'printed';
        cb(null, { ok: true, status, ts: Date.now() });
      }

      // Telemetria
      try {
        const status = result === false ? 'skipped' : 'printed';
        socket.emit('pedido-impresso', { id: incoming.id, storeId: incoming.storeId || STORE_ID, storeIds: STORE_IDS, status, ts: Date.now() });
      } catch (e) {}
    } catch (e) {
      console.error('Failed to print order', e.message);
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
      try { socket.emit('pedido-erro-impressao', { id: order && order.id, error: e.message, ts: Date.now() }); } catch (e2) {}
    }
  });

  // --- Test print ---
  socket.on('test-print', async (payload, cb) => {
    try {
      console.log('Received test-print request');
      const testOrder = {
        id: 'TEST-' + Date.now(),
        displaySimple: '00',
        customerName: 'TESTE DE IMPRESSAO',
        customerPhone: '(00) 0000-0000',
        address: 'Endereco de teste',
        items: [{ quantity: 1, name: payload && payload.text ? String(payload.text).slice(0, 40) : 'Item teste', price: 10.00 }],
        total: 10.00,
        createdAt: new Date().toISOString()
      };
      const opts = {
        printerName: payload && payload.printerName ? payload.printerName : undefined,
        copies: payload && payload.copies ? payload.copies : 1,
        receiptTemplate: payload && payload.receiptTemplate ? payload.receiptTemplate : undefined,
        headerName: payload && payload.headerName ? payload.headerName : undefined,
        headerCity: payload && payload.headerCity ? payload.headerCity : undefined,
        dryRun: payload && typeof payload.dryRun === 'boolean' ? payload.dryRun : undefined
      };
      await printerService.printOrder(testOrder, opts);
      if (cb) cb(null, { ok: true });
    } catch (e) {
      console.error('test-print failed', e.message);
      if (cb) cb({ ok: false, error: e.message });
    }
  });

  // --- Listar impressoras ---
  socket.on('list-printers', async (payload, cb) => {
    try {
      let list = [];
      // Tentar via PowerShell no Windows
      if (process.platform === 'win32') {
        try {
          const { spawnSync } = require('child_process');
          const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
            'Get-Printer | Select-Object Name, DriverName, PortName, Default | ConvertTo-Json'
          ], { timeout: 10000 });
          if (result.status === 0 && result.stdout) {
            const parsed = JSON.parse(result.stdout.toString());
            const printers = Array.isArray(parsed) ? parsed : [parsed];
            list = printers.map(p => p.Name || p.name).filter(Boolean);
          }
        } catch (e) { /* ignore */ }
      }
      if (typeof cb === 'function') cb(null, list);
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  // --- Erros de conexão ---
  socket.on('connect_error', (err) => {
    const msg = err && err.message ? err.message : String(err);
    console.error('Socket connect_error:', msg);

    if (!forceAnonymous && !_triedAnonymousReconnect && (msg === 'invalid-storeId' || msg === 'invalid-agent-token')) {
      _triedAnonymousReconnect = true;
      console.log('Auth rejected; attempting anonymous reconnect...');
      try { socket.close(); } catch (e) {}
      setTimeout(() => connect(true), 300);
    }
  });

  socket.on('disconnect', (reason) => {
    console.warn('Socket disconnected:', reason);
  });

  // --- Atualização de token ---
  socket.on('update-agent-token', (payload) => {
    try {
      const t = payload && payload.token;
      if (!t || t === PRINT_AGENT_TOKEN) return;
      PRINT_AGENT_TOKEN = t;
      try { fs.writeFileSync(tokenPath, PRINT_AGENT_TOKEN, 'utf8'); } catch (e) {}
      console.log('Received new token; reconnecting...');
      try { socket.close(); } catch (e) {}
      setTimeout(() => connect(), 200);
    } catch (e) {
      console.warn('Failed to apply update-agent-token', e.message);
    }
  });

  socket.on('agent-token-rotated', (payload) => {
    try {
      const t = payload && payload.token;
      if (!t || t === PRINT_AGENT_TOKEN) return;
      PRINT_AGENT_TOKEN = t;
      try { fs.writeFileSync(tokenPath, PRINT_AGENT_TOKEN, 'utf8'); } catch (e) {}
      console.log('Received rotated token; reconnecting...');
      try { socket.close(); } catch (e) {}
      setTimeout(() => connect(), 200);
    } catch (e) {
      console.warn('Failed to apply agent-token-rotated', e.message);
    }
  });
}

// --- Iniciar ---
connect();

// --- Monitorar arquivo de token ---
try {
  if (fs.existsSync(tokenPath)) {
    fs.watchFile(tokenPath, { interval: 1000 }, (curr, prev) => {
      try {
        if (!curr || curr.mtimeMs === prev.mtimeMs) return;
        const raw = fs.readFileSync(tokenPath, 'utf8').trim();
        if (raw && raw !== PRINT_AGENT_TOKEN) {
          PRINT_AGENT_TOKEN = raw;
          console.log('Detected updated .print-agent-token file; reconnecting...');
          try { socket.close(); } catch (e) {}
          setTimeout(() => connect(), 500);
        }
      } catch (e) { /* ignore */ }
    });
  } else {
    const dir = path.dirname(tokenPath);
    fs.watch(dir, (ev, fname) => {
      try {
        if (fname === path.basename(tokenPath) && fs.existsSync(tokenPath)) {
          const raw = fs.readFileSync(tokenPath, 'utf8').trim();
          if (raw && raw !== PRINT_AGENT_TOKEN) {
            PRINT_AGENT_TOKEN = raw;
            console.log('Detected new .print-agent-token file; reconnecting...');
            try { socket.close(); } catch (e) {}
            setTimeout(() => connect(), 500);
          }
        }
      } catch (e) {}
    });
  }
} catch (e) { /* non-fatal */ }

// --- Graceful shutdown ---
process.on('SIGINT', () => {
  console.log('Shutting down...');
  try { socket && socket.close(); } catch (e) {}
  process.exit(0);
});
process.on('uncaughtException', (err) => console.error('Uncaught exception', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection', err));
