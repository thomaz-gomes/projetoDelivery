'use strict';
/**
 * Cliente Socket.IO — mantém conexão persistente com o backend.
 * Implementa reconexão com backoff exponencial.
 */
const { io } = require('socket.io-client');
const logger = require('./logger');

let socket = null;
let handlers = {};
let _connected = false;
let _reconnectTimer = null;
let _baseDelay = 2000;
let _maxDelay = 60000;
let _currentDelay = _baseDelay;

/**
 * @param {object} cfg  - { serverUrl, token }
 * @param {object} cbs  - { onOrder, onTestPrint, onListPrinters, onStatusChange }
 */
function connect(cfg, cbs) {
  handlers = cbs || {};

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  if (!cfg.serverUrl || !cfg.token) {
    logger.warn('[socket] serverUrl ou token não configurados. Conexão adiada.');
    _emitStatus(false, 'Não configurado');
    return;
  }

  _doConnect(cfg);
}

function _doConnect(cfg) {
  logger.info(`[socket] Conectando a ${cfg.serverUrl} ...`);
  _emitStatus(false, 'Conectando...');

  socket = io(cfg.serverUrl, {
    auth: { token: cfg.token, companyId: cfg.companyId },
    // polling primeiro (mais compatível com proxies/nginx), depois upgrade para WebSocket
    transports: ['polling', 'websocket'],
    reconnection: false,      // Controle manual de reconexão
    timeout: 15000,
  });

  socket.on('connect', () => {
    _connected = true;
    _currentDelay = _baseDelay; // reset backoff
    logger.info(`[socket] Conectado! ID: ${socket.id}`);
    _emitStatus(true, 'Conectado');
  });

  socket.on('disconnect', (reason) => {
    _connected = false;
    logger.warn(`[socket] Desconectado: ${reason}`);
    _emitStatus(false, `Desconectado (${reason})`);
    _scheduleReconnect(cfg);
  });

  socket.on('connect_error', (err) => {
    _connected = false;
    logger.warn(`[socket] Erro de conexão: ${err.message}`);
    _emitStatus(false, `Erro: ${err.message}`);
    socket.disconnect();
    _scheduleReconnect(cfg);
  });

  // ── Eventos de negócio ─────────────────────────────────────────────────────
  socket.on('novo-pedido', (order) => {
    logger.info(`[socket] Novo pedido recebido: #${order.displayId || order.id}`);
    if (handlers.onOrder) handlers.onOrder(order);
  });

  socket.on('test-print', (data) => {
    logger.info('[socket] Impressão de teste solicitada.');
    if (handlers.onTestPrint) handlers.onTestPrint(data);
  });

  socket.on('list-printers', (cb) => {
    if (handlers.onListPrinters) {
      handlers.onListPrinters(cb);
    } else {
      cb([]);
    }
  });

  // Atualização de token (backend pode rodar token refresh)
  socket.on('token-updated', (newToken) => {
    logger.info('[socket] Token atualizado remotamente.');
    const config = require('./config');
    const cfg2 = config.load();
    cfg2.token = newToken;
    config.save(cfg2);
  });
}

function _scheduleReconnect(cfg) {
  if (_reconnectTimer) return; // já agendado
  logger.info(`[socket] Reconectando em ${_currentDelay / 1000}s...`);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _doConnect(cfg);
  }, _currentDelay);
  // Backoff exponencial com teto
  _currentDelay = Math.min(_currentDelay * 1.5, _maxDelay);
}

function _emitStatus(connected, label) {
  if (handlers.onStatusChange) {
    handlers.onStatusChange({ connected, label });
  }
}

function disconnect() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  _connected = false;
}

function isConnected() {
  return _connected;
}

module.exports = { connect, disconnect, isConnected };
