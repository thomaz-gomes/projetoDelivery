'use strict';
/**
 * Cliente Socket.IO — mantém conexão persistente com o backend.
 *
 * Melhorias:
 *  - Emite `agent-ready` após connect para o backend processar fila pendente
 *  - Erros de autenticação não geram retry (evita loop inútil)
 *  - Backoff exponencial com jitter (evita thundering herd)
 *  - Estado `authError` propagado para UI
 */
const { io } = require('socket.io-client');
const logger = require('./logger');

let socket        = null;
let handlers      = {};
let _connected    = false;
let _authError    = false;
let _currentCfg   = null;
let _reconnectTimer = null;

const BASE_DELAY = 3000;
const MAX_DELAY  = 60000;
let _currentDelay = BASE_DELAY;
let _attempt      = 0;

// Erros que indicam configuração inválida → não tentar reconectar
const AUTH_ERROR_MESSAGES = new Set([
  'invalid-agent-token',
  'agent-no-token-configured',
  'invalid-companyId',
  'agent-missing-companyId',
]);

/**
 * @param {object} cfg  - { serverUrl, token, companyId }
 * @param {object} cbs  - { onOrder, onTestPrint, onListPrinters, onStatusChange }
 */
function connect(cfg, cbs) {
  handlers      = cbs || {};
  _authError    = false;
  _currentCfg   = cfg;
  _currentDelay = BASE_DELAY;
  _attempt      = 0;

  _cancelReconnect();
  _destroySocket();

  if (!cfg.serverUrl || !cfg.token) {
    logger.warn('[socket] serverUrl ou token não configurados. Conexão suspensa.');
    _emitStatus(false, 'Não configurado');
    return;
  }

  _doConnect(cfg);
}

function _doConnect(cfg) {
  _attempt++;
  const label = _attempt > 1 ? `Reconectando… (tentativa ${_attempt})` : 'Conectando…';
  logger.info(`[socket] ${label} → ${cfg.serverUrl}`);
  logger.info(`[socket] Auth: companyId=${cfg.companyId || 'NULL'} | token=${cfg.token ? cfg.token.slice(0, 8) + '…' : 'VAZIO'}`);
  _emitStatus(false, label);

  // Extrai a URL base sem path para o Socket.IO (ex: https://app.exemplo.com)
  const baseUrl = (() => {
    try { const u = new URL(cfg.serverUrl); return `${u.protocol}//${u.host}`; }
    catch (_) { return cfg.serverUrl; }
  })();

  socket = io(baseUrl, {
    auth:         { token: cfg.token, companyId: cfg.companyId },
    // Não enviamos Origin explícito: em Node.js o header Origin não é enviado por padrão,
    // e o cors do servidor aceita requisições sem Origin. Enviar Origin explícito pode
    // causar rejeição CORS em servidores com lista restrita de origens.
    transports:   ['websocket', 'polling'],   // WebSocket primeiro; polling como fallback
    path:         '/socket.io',               // path explícito evita ambiguidade
    reconnection: false,                       // controle manual
    timeout:      20000,
  });

  // ── Debug: erros no nível engine.io (abaixo do Socket.IO) ─────────────────
  try {
    socket.io.on('error', (engineErr) => {
      logger.warn(`[socket] engine error: ${engineErr && engineErr.message}`);
    });
    socket.io.engine && socket.io.engine.on && socket.io.engine.on('error', (engineErr) => {
      logger.warn(`[socket] transport error: ${engineErr && engineErr.message}`);
    });
  } catch (_) { /* não-fatal */ }

  // ── Eventos de ciclo de vida ───────────────────────────────────────────────
  socket.on('connect', () => {
    _connected    = true;
    _attempt      = 0;
    _currentDelay = BASE_DELAY;
    const transport = socket.io && socket.io.engine && socket.io.engine.transport && socket.io.engine.transport.name;
    logger.info(`[socket] Conectado! id=${socket.id} | transport=${transport || '?'}`);
    _emitStatus(true, 'Conectado');

    // Sinaliza ao backend que o agente está pronto → backend processa fila pendente
    socket.emit('agent-ready', { companyId: cfg.companyId });
  });

  socket.on('disconnect', (reason) => {
    _connected = false;
    logger.warn(`[socket] Desconectado: ${reason}`);

    // 'io client disconnect' = chamamos disconnect() intencionalmente → não reconectar
    if (reason === 'io client disconnect') {
      _emitStatus(false, 'Desconectado');
      return;
    }

    _emitStatus(false, 'Offline — reconectando…');
    if (!_authError) _scheduleReconnect(cfg);
  });

  socket.on('connect_error', (err) => {
    _connected = false;

    // ── Log detalhado para diagnóstico ────────────────────────────────────
    const msg        = (err && err.message) || '';
    const errType    = (err && err.type)    || '';
    // err.code is set by engine.io-client for PacketType.ERROR packets ("server error")
    // err.data is the socket.io namespace error data; err.description is transport error status
    const errData    = err && (err.data || err.code || err.description) ? JSON.stringify(err.data || err.code || err.description) : '';
    const ctx        = err && err.context;
    const httpStatus = ctx && (ctx.status || ctx.statusCode);
    const httpBody   = ctx && ctx.responseText ? ctx.responseText.slice(0, 300) : '';
    const transport  = socket && socket.io && socket.io.engine && socket.io.engine.transport
                       ? socket.io.engine.transport.name : '?';

    logger.warn(
      `[socket] connect_error:\n` +
      `  message   : "${msg}"\n` +
      `  type      : "${errType}"\n` +
      `  data      : ${errData || '—'}\n` +
      `  transport : ${transport}\n` +
      `  httpStatus: ${httpStatus || '—'}\n` +
      `  httpBody  : ${httpBody || '—'}`
    );

    _destroySocket();

    if (AUTH_ERROR_MESSAGES.has(msg)) {
      _authError = true;
      logger.error(`[socket] Erro de autenticação (${msg}) — pareamento necessário.`);
      _emitStatus(false, 'Token inválido — clique em "Resetar / Reconectar"', true);
      return; // não reagendar reconexão
    }

    _emitStatus(false, `Offline (${msg || 'sem resposta'})`);
    _scheduleReconnect(cfg);
  });

  // ── Eventos de negócio ────────────────────────────────────────────────────
  socket.on('novo-pedido', (rawOrder, ack) => {
    let order = rawOrder || {};
    // agentPrint.js envia wrapper { order: dbRecord, text, printerInterface, ... }
    // Desempacotar para que o templateEngine receba o pedido completo do DB
    if (order.order && typeof order.order === 'object') {
      const wrapper = order;
      order = { ...order.order };
      // Preservar campos do wrapper que podem não estar no registro do DB
      const preserve = ['printerInterface', 'printerType', 'paperWidth', 'receiptTemplate',
                        'copies', 'printerName', 'headerName', 'headerCity', 'qrText'];
      for (const f of preserve) {
        if (wrapper[f] != null && !order[f]) order[f] = wrapper[f];
      }
    }
    logger.info(`[socket] Novo pedido: #${order.displayId || order.id}`);
    if (handlers.onOrder) handlers.onOrder(order);
    if (typeof ack === 'function') ack(null, { ok: true });
  });

  socket.on('test-print', (data) => {
    logger.info('[socket] Impressão de teste solicitada.');
    if (handlers.onTestPrint) handlers.onTestPrint(data);
  });

  // Backend emite: emit('list-printers', { storeId }, ackFn)
  // Recebemos (data, ack) — segundo argumento é a função de acknowledgement
  socket.on('list-printers', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : (typeof data === 'function' ? data : null);
    if (handlers.onListPrinters) {
      handlers.onListPrinters(reply);
    } else if (reply) {
      reply([]);
    }
  });

  // Backend pode rotacionar o token; salvar e reconectar com o novo
  socket.on('token-updated', (newToken) => {
    logger.info('[socket] Token atualizado remotamente — reconectando.');
    const config = require('./config');
    const saved  = config.load();
    saved.token  = newToken;
    config.save(saved);
    connect({ ...cfg, token: newToken }, handlers);
  });
}

function _scheduleReconnect(cfg) {
  if (_reconnectTimer || _authError) return;

  // Jitter de ±20% para evitar thundering herd em múltiplos agentes
  const jitter = _currentDelay * 0.2 * (Math.random() * 2 - 1);
  const delay  = Math.round(Math.min(Math.max(BASE_DELAY, _currentDelay + jitter), MAX_DELAY));

  logger.info(`[socket] Próxima tentativa em ${(delay / 1000).toFixed(1)}s`);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _doConnect(cfg);
  }, delay);

  // Backoff exponencial (×2 a cada falha)
  _currentDelay = Math.min(_currentDelay * 2, MAX_DELAY);
}

function _cancelReconnect() {
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
}

function _destroySocket() {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
}

function _emitStatus(connected, label, authError = false) {
  if (handlers.onStatusChange) {
    handlers.onStatusChange({ connected, label, authError });
  }
}

function disconnect() {
  _cancelReconnect();
  _destroySocket();
  _connected = false;
}

function isConnected() { return _connected; }

module.exports = { connect, disconnect, isConnected };
