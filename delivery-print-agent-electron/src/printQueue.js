'use strict';
/**
 * Fila de impressão FIFO com retry e deduplicação.
 *
 * Fluxo:
 *  enqueue(order) → deduplication check → add to queue → processNext()
 *  processNext()  → renderTemplate() → dispatchToPrinters() → markDone / retry
 */
const logger = require('./logger');
const templateEngine = require('./templateEngine');
const configManager  = require('./config');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const DEDUP_TTL_MS = 30_000; // ignorar mesmo orderId em 30s

let _printerManager = null;
const _queue = [];         // { job, retries, addedAt }
const _recentIds = new Map(); // orderId -> timestamp
let _processing = false;

function init(pm) {
  _printerManager = pm;
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────
function enqueue(order) {
  const id = _jobId(order);

  // Deduplicação
  const last = _recentIds.get(id);
  if (last && Date.now() - last < DEDUP_TTL_MS) {
    logger.warn(`[queue] Pedido duplicado ignorado: ${id}`);
    return;
  }
  _recentIds.set(id, Date.now());

  logger.info(`[queue] Enfileirando pedido: ${id}`);
  _queue.push({ order, retries: 0, addedAt: Date.now() });
  _processNext();
}

function enqueueTest(data) {
  const order = _buildTestOrder(data);
  _queue.push({ order, retries: 0, isTest: true, addedAt: Date.now() });
  _processNext();
  return { ok: true };
}

// ─── Processing ──────────────────────────────────────────────────────────────
async function _processNext() {
  if (_processing || _queue.length === 0) return;
  _processing = true;

  const item = _queue.shift();
  try {
    await _handleJob(item);
  } catch (err) {
    logger.error(`[queue] Erro ao processar job: ${err.message}`);
    if (item.retries < MAX_RETRIES) {
      item.retries++;
      logger.info(`[queue] Reagendando tentativa ${item.retries}/${MAX_RETRIES} em ${RETRY_DELAY_MS}ms`);
      setTimeout(() => {
        _queue.unshift(item); // reinsere na frente da fila
        _processing = false;
        _processNext();
      }, RETRY_DELAY_MS);
      return;
    } else {
      logger.error(`[queue] Job descartado após ${MAX_RETRIES} tentativas: ${_jobId(item.order)}`);
    }
  }

  _processing = false;
  // Processar próximo item sem espera
  setImmediate(_processNext);
}

async function _handleJob(item) {
  const { order, isTest } = item;
  if (!_printerManager) throw new Error('PrinterManager não inicializado');

  // Determinar quais impressoras recebem esse pedido
  const targets = isTest && item.order._printerId
    ? _printerManager.getPrinterById(item.order._printerId)
      ? [_printerManager.getPrinterById(item.order._printerId)]
      : []
    : _printerManager.getTargetPrinters(order);

  if (targets.length === 0) {
    logger.warn(`[queue] Nenhuma impressora encontrada para o pedido ${_jobId(order)}`);
    return;
  }

  // Ler config local uma vez por job (para injetar template e cabeçalho locais)
  const cfg = configManager.load();

  for (const printer of targets) {
    if (!printer.enabled) continue;

    try {
      // Injetar template local (aba Comanda) se a impressora não tiver template próprio
      const p = printer.template
        ? printer
        : { ...printer, template: cfg.receiptTemplate || printer.template };

      // Injetar cabeçalho local se o pedido não trouxe do backend
      const o = { ...order };
      if (!o.headerName && cfg.headerName) o.headerName = cfg.headerName;
      if (!o.headerCity && cfg.headerCity) o.headerCity = cfg.headerCity;

      // Renderizar template em bytes ESC/POS
      const bytes = templateEngine.render(o, p);

      // Enviar para a impressora (uma via por vez; copies em loop)
      const copies = Math.max(1, printer.copies || 1);
      for (let i = 0; i < copies; i++) {
        await _printerManager.print(printer, bytes);
      }
      logger.info(`[queue] Impresso em "${printer.alias}" (${copies}x)`);
    } catch (err) {
      logger.error(`[queue] Falha ao imprimir em "${printer.alias}": ${err.message}`);
      throw err; // propaga para retry
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _jobId(order) {
  return order.id || order.displayId || String(order.timestamp || Date.now());
}

function _buildTestOrder(data) {
  const cfg = configManager.load();
  const loja = cfg.headerName || 'Delivery SaaS';
  return {
    _printerId: data.printerId,
    id: `TEST-${Date.now()}`,
    displayId: 'TESTE',
    headerName: loja,              // usado como loja_nome pelo templateEngine
    storeName:  loja,
    createdAt: new Date().toISOString(),
    customerName: 'Cliente Teste',
    customerPhone: '(71) 99999-9999',
    orderType: 'delivery',          // campo do DB Order
    type: 'delivery',               // compatibilidade
    deliveryAddress: { street: 'Rua Exemplo', number: '123', neighborhood: 'Centro', city: 'Salvador' },
    items: [
      { name: 'X-Burguer', quantity: 1, price: 25.00, notes: 'Sem cebola' },
      { name: 'Coca-Cola 350ml', quantity: 2, price: 6.00 },
    ],
    payments: [{ method: 'Dinheiro', value: 42.00 }],
    subtotal: 37.00,
    deliveryFee: 5.00,
    discount: 0,
    total: 42.00,
    notes: 'Pedido de teste — ignore',
    qrText: 'https://app.deliverywl.com.br/orders/test',
  };
}

function size() {
  return _queue.length;
}

function shutdown() {
  _queue.length = 0;
  _processing = false;
}

module.exports = { init, enqueue, enqueueTest, size, shutdown };
