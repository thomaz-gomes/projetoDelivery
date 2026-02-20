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
  _emitStatus(false, label);

  socket = io(cfg.serverUrl, {
    auth:         { token: cfg.token, companyId: cfg.companyId },
    transports:   ['polling', 'websocket'],   // polling primeiro para compatibilidade com nginx
    reconnection: false,                       // controle manual
    timeout:      20000,
  });

  // ── Eventos de ciclo de vida ───────────────────────────────────────────────
  socket.on('connect', () => {
    _connected    = true;
    _attempt      = 0;
    _currentDelay = BASE_DELAY;
    logger.info(`[socket] Conectado! socket.id=${socket.id}`);
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
    const msg = (err && err.message) || '';
    logger.warn(`[socket] Erro de conexão: ${msg}`);
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
  socket.on('novo-pedido', (order) => {
    logger.info(`[socket] Novo pedido: #${order.displayId || order.id}`);
    if (handlers.onOrder) handlers.onOrder(order);
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
