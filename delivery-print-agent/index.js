/**
 * delivery-print-agent - Agente local de impressão para SaaS de delivery
 *
 * Conecta ao backend via Socket.IO, recebe pedidos novos e imprime
 * automaticamente na impressora térmica do cliente.
 *
 * Setup simplificado: na primeira execução, solicita URL do servidor e
 * código de pareamento. Após pareamento, salva config em agent-config.json.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const mkdirp = require('mkdirp');
const { io } = require('socket.io-client');
const printerService = require('./printerService');

// --- Paths ---
const CONFIG_PATH = path.resolve(process.cwd(), 'agent-config.json');
const TOKEN_PATH = path.resolve(process.cwd(), '.print-agent-token');
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
const FORCE_SETUP = process.argv.includes('--setup');
const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(__dirname, 'logs'));

mkdirp.sync(LOG_DIR);

// Converte largura do papel em mm para colunas ESC/POS
function mmToColumns(mm) {
  const v = Number(mm);
  if (v >= 70) return 48;  // 80mm -> 48 colunas
  if (v >= 50) return 32;  // 58mm -> 32 colunas
  return 48; // default
}

// --- Config persistence ---
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// --- Interactive prompt ---
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

// --- HTTP pairing call ---
function _httpPost(targetUrl, body) {
  const mod = targetUrl.protocol === 'https:' ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = mod.request(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            return reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error('Resposta invalida do servidor: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

async function httpPair(backendUrl, code) {
  const body = JSON.stringify({ code: code.toUpperCase() });
  const url = new URL('/agent-setup/pair', backendUrl);

  try {
    return await _httpPost(url, body);
  } catch (e) {
    // If https failed with SSL error, auto-retry with http
    if (url.protocol === 'https:' && (e.code === 'EPROTO' || e.code === 'ERR_SSL_WRONG_VERSION_NUMBER' || (e.message && e.message.includes('SSL')))) {
      console.log('HTTPS falhou, tentando HTTP...');
      const httpUrl = new URL(url.toString());
      httpUrl.protocol = 'http:';
      return await _httpPost(httpUrl, body);
    }
    throw new Error('Erro de conexao: ' + e.message);
  }
}

// --- Interactive setup ---
async function interactiveSetup() {
  console.log('');
  console.log('========================================');
  console.log('  Delivery Print Agent - Setup Inicial');
  console.log('========================================');
  console.log('');

  let backendUrl = await prompt('URL do servidor (ex: https://api.seudelivery.com.br): ');
  if (!backendUrl) {
    console.error('URL do servidor e obrigatoria.');
    process.exit(1);
  }
  // Add http:// if no protocol specified
  if (!/^https?:\/\//i.test(backendUrl)) {
    backendUrl = 'http://' + backendUrl;
  }

  const code = await prompt('Codigo de pareamento (6 caracteres): ');
  if (!code) {
    console.error('Codigo de pareamento e obrigatorio.');
    process.exit(1);
  }

  console.log('');
  console.log('Pareando com o servidor...');

  try {
    const result = await httpPair(backendUrl.replace(/\/$/, ''), code);

    const config = {
      backendUrl: backendUrl.replace(/\/$/, ''),
      socketUrl: result.socketUrl || backendUrl.replace(/\/$/, ''),
      token: result.token,
      storeIds: result.storeIds || [],
      companyId: result.companyId,
      pairedAt: new Date().toISOString(),
    };
    saveConfig(config);

    console.log('');
    console.log('Pareamento realizado com sucesso!');
    console.log('Configuracao salva em agent-config.json');
    console.log('');

    return config;
  } catch (e) {
    console.error('Erro: ' + e.message);
    process.exit(1);
  }
}

// --- Resolve config from multiple sources ---
async function resolveConfig() {
  // --setup flag forces interactive pairing (ignores existing config)
  if (FORCE_SETUP) {
    console.log('Flag --setup detectado, iniciando pareamento...');
    const config = await interactiveSetup();
    return {
      backendUrl: config.socketUrl || config.backendUrl,
      token: config.token,
      storeIds: config.storeIds || [],
    };
  }

  const envUrl = process.env.BACKEND_SOCKET_URL;
  const envToken = process.env.PRINT_AGENT_TOKEN || process.env.TOKEN || '';
  const envStoreIds = process.env.STORE_IDS || process.env.STORE_ID || process.env.STORE || '';

  // 1. Explicit .env with URL + token (backward compat)
  if (envUrl && envToken) {
    const storeIds = envStoreIds.split(',').map(s => s.trim()).filter(Boolean);
    console.log('Usando configuracao do .env');
    return { backendUrl: envUrl, token: envToken, storeIds };
  }

  // 2. Saved config from prior pairing
  const saved = loadConfig();
  if (saved && saved.token) {
    // Allow .env to override individual values
    const backendUrl = envUrl || saved.socketUrl || saved.backendUrl;
    const token = envToken || saved.token;
    const storeIds = envStoreIds
      ? envStoreIds.split(',').map(s => s.trim()).filter(Boolean)
      : (saved.storeIds || []);
    console.log('Usando configuracao salva (agent-config.json)');
    return { backendUrl, token, storeIds };
  }

  // 3. Legacy .print-agent-token file
  let legacyToken = '';
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      legacyToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    }
  } catch (e) { /* ignore */ }

  if (envUrl && legacyToken) {
    const storeIds = envStoreIds.split(',').map(s => s.trim()).filter(Boolean);
    console.log('Usando configuracao legada (.print-agent-token)');
    return { backendUrl: envUrl, token: legacyToken, storeIds };
  }

  // 4. Interactive setup
  const config = await interactiveSetup();
  return {
    backendUrl: config.socketUrl || config.backendUrl,
    token: config.token,
    storeIds: config.storeIds || [],
  };
}

// --- Main ---
async function main() {
  console.log('Starting Delivery Print Agent');
  if (DRY_RUN) console.log('DRY_RUN enabled');

  const config = await resolveConfig();

  let BACKEND_SOCKET_URL = config.backendUrl;
  let PRINT_AGENT_TOKEN = config.token;
  let STORE_IDS = config.storeIds;
  const STORE_ID = STORE_IDS[0] || 'unknown-store';

  console.log('Backend:', BACKEND_SOCKET_URL);
  console.log('StoreIds:', STORE_IDS);
  console.log('Token:', PRINT_AGENT_TOKEN ? '****' : '(missing)');

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
              try { fs.writeFileSync(TOKEN_PATH, PRINT_AGENT_TOKEN, 'utf8'); } catch (e) {}
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
        const wrapper = incoming;
        if (incoming.order) {
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
        try {
          console.log('  address:', incoming.address || '(none)');
          console.log('  qrText:', incoming.qrText || '(none)');
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
          width: incoming.paperWidth ? mmToColumns(incoming.paperWidth) : undefined,
          receiptTemplate: incoming.receiptTemplate || undefined,
          copies: incoming.copies || undefined,
          headerName: incoming.headerName || undefined,
          headerCity: incoming.headerCity || undefined
        };

        const result = await printerService.printOrder(incoming, opts);

        if (typeof cb === 'function') {
          const status = result === false ? 'skipped' : 'printed';
          cb(null, { ok: true, status, ts: Date.now() });
        }

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
        try { fs.writeFileSync(TOKEN_PATH, PRINT_AGENT_TOKEN, 'utf8'); } catch (e) {}
        // Update saved config too
        try {
          const cfg = loadConfig();
          if (cfg) { cfg.token = t; saveConfig(cfg); }
        } catch (e) {}
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
        try { fs.writeFileSync(TOKEN_PATH, PRINT_AGENT_TOKEN, 'utf8'); } catch (e) {}
        try {
          const cfg = loadConfig();
          if (cfg) { cfg.token = t; saveConfig(cfg); }
        } catch (e) {}
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

  // --- Monitorar arquivo de token (legado) ---
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      fs.watchFile(TOKEN_PATH, { interval: 1000 }, (curr, prev) => {
        try {
          if (!curr || curr.mtimeMs === prev.mtimeMs) return;
          const raw = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
          if (raw && raw !== PRINT_AGENT_TOKEN) {
            PRINT_AGENT_TOKEN = raw;
            console.log('Detected updated .print-agent-token file; reconnecting...');
            try { socket.close(); } catch (e) {}
            setTimeout(() => connect(), 500);
          }
        } catch (e) { /* ignore */ }
      });
    } else {
      const dir = path.dirname(TOKEN_PATH);
      fs.watch(dir, (ev, fname) => {
        try {
          if (fname === path.basename(TOKEN_PATH) && fs.existsSync(TOKEN_PATH)) {
            const raw = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
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
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => console.error('Uncaught exception', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection', err));
