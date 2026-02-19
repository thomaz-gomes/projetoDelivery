'use strict';
/**
 * Gerenciador de impressoras.
 * Responsável por:
 *  - Manter a lista de impressoras configuradas
 *  - Rotear pedidos para a(s) impressora(s) correta(s) com base em categorias
 *  - Listar impressoras do sistema Windows (para seleção na UI)
 *  - Despachar bytes ESC/POS para o transporte correto
 */
const logger = require('./logger');
const { execFile } = require('child_process');
const printDispatch = require('./printing/index');

let _printers = [];

function init(printers) {
  _printers = Array.isArray(printers) ? printers : [];
  logger.info(`[printerManager] ${_printers.length} impressora(s) carregada(s).`);
}

// ─── Roteamento ──────────────────────────────────────────────────────────────
/**
 * Retorna as impressoras que devem receber o pedido.
 * Regras:
 *  - "all"  → recebe qualquer pedido
 *  - categorias do item → impressora recebe se tiver ao menos 1 categoria em comum
 *
 * @param {object} order
 * @returns {PrinterConfig[]}
 */
function getTargetPrinters(order) {
  const orderCategories = _extractCategories(order);

  return _printers.filter((p) => {
    if (!p.enabled) return false;
    if (!p.categories || p.categories.length === 0) return false;
    if (p.categories.includes('all')) return true;
    return p.categories.some((c) => orderCategories.includes(c));
  });
}

function _extractCategories(order) {
  const cats = new Set(['all']);
  if (Array.isArray(order.items)) {
    for (const item of order.items) {
      if (item.category) cats.add(String(item.category).toLowerCase());
      if (Array.isArray(item.categories)) {
        item.categories.forEach((c) => cats.add(String(c).toLowerCase()));
      }
    }
  }
  return [...cats];
}

function getPrinterById(id) {
  return _printers.find((p) => p.id === id) || null;
}

// ─── Envio ───────────────────────────────────────────────────────────────────
/**
 * @param {PrinterConfig} printer
 * @param {Buffer} escposBytes
 */
async function print(printer, escposBytes) {
  return printDispatch(printer, escposBytes);
}

// ─── Listagem do sistema ──────────────────────────────────────────────────────
/**
 * Lista impressoras instaladas no Windows via PowerShell.
 * Retorna [{ name, port, status }]
 */
function listSystemPrinters() {
  return new Promise((resolve) => {
    const ps = `Get-Printer | Select-Object Name,PortName,PrinterStatus | ConvertTo-Json -Compress`;
    execFile('powershell', ['-NonInteractive', '-NoProfile', '-Command', ps], { timeout: 8000 },
      (err, stdout, stderr) => {
        if (err) {
          logger.warn('[printerManager] Falha ao listar impressoras:', err.message);
          resolve([]);
          return;
        }
        try {
          let data = JSON.parse(stdout.trim());
          if (!Array.isArray(data)) data = [data]; // único resultado → objeto
          const list = data.map((p) => ({
            name: p.Name,
            port: p.PortName,
            status: p.PrinterStatus === 0 ? 'OK' : `Código ${p.PrinterStatus}`,
          }));
          resolve(list);
        } catch (e) {
          logger.warn('[printerManager] Erro ao parsear lista de impressoras:', e.message);
          resolve([]);
        }
      }
    );
  });
}

module.exports = { init, getTargetPrinters, getPrinterById, print, listSystemPrinters };
