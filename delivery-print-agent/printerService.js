/**
 * printerService.js - Serviço de impressão para comandas de delivery
 *
 * Arquitetura simplificada:
 *   1. Renderiza template via templateEngine
 *   2. Caminho primário: node-thermal-printer (ESC/POS)
 *   3. Fallback: PowerShell Out-Printer (Windows) ou lp (Linux)
 *   4. Salva em disco se tudo falhar
 *
 * Suporta dois formatos de template:
 *   - Texto plano (v1): {{placeholders}} + [QR:url]
 *   - JSON (v2): blocos com formatação (negrito, tamanho, alinhamento)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const { renderTemplate, buildContext, renderBlockContent, replacePlaceholders } = require('./templateEngine');
const DEFAULT_TEMPLATE = require('./defaultTemplate');
const { DEFAULT_TEMPLATE_V2 } = require('./defaultTemplate');

// --- Configuração ---
const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(__dirname, 'logs'));
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
const PRINTER_WIDTH = Number(process.env.PRINTER_WIDTH || 48);
const PRINTER_TYPE = (process.env.PRINTER_TYPE || 'EPSON').toUpperCase();
const PRINTER_NAME = process.env.PRINTER_NAME || '';
const DEFAULT_COPIES = Number(process.env.COPIES || 1);
const DEDUPE_TTL_MS = Number(process.env.PRINT_DEDUPE_TTL_MS || 15000);
const SPAWN_TIMEOUT_MS = Number(process.env.PRINT_HELPER_TIMEOUT_MS || 30000);

mkdirp.sync(LOG_DIR);
mkdirp.sync(path.join(__dirname, 'failed-print'));

// --- Logging ---
function logFile(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(path.join(LOG_DIR, 'agent.log'), line); } catch (e) { /* ignore */ }
}

// --- Deduplicação ---
const recentPrints = new Map();

function isRecentlyPrinted(orderId) {
  if (!orderId) return false;
  const entry = recentPrints.get(orderId);
  if (!entry) return false;
  if (entry.inProgress) return true;
  if ((Date.now() - entry.ts) <= DEDUPE_TTL_MS) return true;
  recentPrints.delete(orderId);
  return false;
}

function markPrintingStart(orderId) {
  if (!orderId) return;
  recentPrints.set(orderId, { ts: Date.now(), inProgress: true });
  setTimeout(() => { try { recentPrints.delete(orderId); } catch (e) {} }, DEDUPE_TTL_MS + 5000);
}

function markPrinted(orderId) {
  if (!orderId) return;
  recentPrints.set(orderId, { ts: Date.now(), inProgress: false });
  setTimeout(() => { try { recentPrints.delete(orderId); } catch (e) {} }, DEDUPE_TTL_MS + 5000);
}

function clearRecentPrint(orderId) {
  if (!orderId) return;
  recentPrints.delete(orderId);
}

// --- Inicialização da impressora (lazy) ---
const ntp = require('node-thermal-printer');

function initPrinter(opts = {}) {
  const printerName = opts.printerName || PRINTER_NAME;
  const iface = printerName ? `printer:${printerName}` : (process.env.PRINTER_INTERFACE || 'printer:default');
  const type = PRINTER_TYPE === 'STAR' ? ntp.printerTypes.STAR : ntp.printerTypes.EPSON;

  ntp.init({
    type,
    interface: iface,
    width: opts.width || PRINTER_WIDTH,
    characterSet: 'PC852_LATIN2',
    removeSpecialCharacters: false,
    options: { timeout: 5000 }
  });
}

// --- Formatação ESC/POS para blocos JSON ---
function applyBlockFormat(block) {
  // Alinhamento
  if (block.a === 'center') ntp.alignCenter();
  else if (block.a === 'right') ntp.alignRight();
  else ntp.alignLeft();

  // Negrito
  if (block.b) ntp.bold(true);

  // Tamanho
  if (block.s === 'sm') {
    try { ntp.setTypeFontB(); } catch (e) { /* some printers dont support font B */ }
  } else if (block.s === 'lg') {
    ntp.setTextDoubleHeight();
  } else if (block.s === 'xl') {
    ntp.setTextQuadArea();
  }
}

function resetBlockFormat() {
  ntp.setTextNormal();
  ntp.bold(false);
  ntp.alignLeft();
}

/**
 * Renderiza blocos JSON v2 diretamente na impressora com formatação ESC/POS.
 */
function renderJsonBlocks(blocks, context) {
  for (const block of blocks) {
    try {
      switch (block.t) {
        case 'sep':
          ntp.drawLine();
          break;

        case 'text': {
          const text = renderBlockContent(block.c || '', context);
          if (!text.trim() && !block.c) break;
          applyBlockFormat(block);
          ntp.println(text);
          resetBlockFormat();
          break;
        }

        case 'cond': {
          const val = context[block.key];
          if (!val || val === '0' || val === '0.00') break;
          const text = renderBlockContent(block.c || '', context);
          applyBlockFormat(block);
          ntp.println(text);
          resetBlockFormat();
          break;
        }

        case 'items': {
          const items = context.items;
          if (!Array.isArray(items) || items.length === 0) break;
          for (const item of items) {
            const merged = Object.assign({}, context, item);
            // Linha do item
            if (block.itemBold) ntp.bold(true);
            if (block.itemSize === 'lg') ntp.setTextDoubleHeight();
            else if (block.itemSize === 'xl') ntp.setTextQuadArea();
            ntp.println(replacePlaceholders('{{item_qty}}x  {{item_name}}  R$ {{item_price}}', merged));
            ntp.setTextNormal();
            ntp.bold(false);
            // Opções
            if (Array.isArray(item.item_options)) {
              for (const opt of item.item_options) {
                const optMerged = Object.assign({}, merged, opt);
                ntp.println(replacePlaceholders('  -- {{option_qty}}x {{option_name}}  R$ {{option_price}}', optMerged));
              }
            }
            // Observação do item
            if (item.notes) {
              ntp.println('  OBS: ' + item.notes);
            }
          }
          break;
        }

        case 'payments': {
          const pags = context.pagamentos;
          if (!Array.isArray(pags) || pags.length === 0) break;
          for (const p of pags) {
            const merged = Object.assign({}, context, p);
            applyBlockFormat(block);
            ntp.println(replacePlaceholders('{{payment_method}}   R$ {{payment_value}}', merged));
            resetBlockFormat();
          }
          break;
        }

        case 'qr': {
          const qrUrl = context.qr_url;
          if (!qrUrl) break;
          try {
            ntp.alignCenter();
            ntp.printQR(qrUrl, { cellSize: 6, correction: 'M', model: 2 });
            ntp.println('Escaneie para despachar');
            ntp.alignLeft();
          } catch (qrErr) {
            ntp.println('[QR:' + qrUrl + ']');
          }
          break;
        }

        default:
          break;
      }
    } catch (blockErr) {
      logFile(`Error rendering block ${block.t}: ${blockErr.message}`);
    }
  }
}

/**
 * Tenta parsear o template como JSON v2. Retorna os blocks ou null.
 */
function parseJsonTemplate(template) {
  if (!template || typeof template !== 'string') return null;
  try {
    const parsed = JSON.parse(template);
    if (parsed && parsed.v === 2 && Array.isArray(parsed.blocks)) {
      return parsed.blocks;
    }
  } catch (e) { /* not JSON */ }
  return null;
}

// --- Impressão via sistema (fallback) ---
async function printViaSystem(text, opts = {}, copies = 1) {
  const { spawnSync } = require('child_process');
  const printerName = opts.printerName || PRINTER_NAME;

  for (let i = 0; i < copies; i++) {
    if (process.platform === 'win32') {
      const tmpFile = path.join(__dirname, `tmp-print-${Date.now()}-${i}.txt`);
      fs.writeFileSync(tmpFile, text, 'utf8');
      try {
        const safeName = printerName ? ` -Name '${printerName.replace(/'/g, "''")}'` : '';
        const safePath = tmpFile.replace(/'/g, "''");
        const cmd = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content -Raw -Encoding UTF8 '${safePath}' | Out-Printer${safeName}`;
        const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { timeout: SPAWN_TIMEOUT_MS });
        if (result.status !== 0) {
          const stderr = result.stderr ? result.stderr.toString().slice(0, 200) : '';
          throw new Error(`PowerShell Out-Printer exit ${result.status}: ${stderr}`);
        }
      } finally {
        try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
      }
    } else {
      const args = printerName ? ['-d', printerName] : [];
      const result = spawnSync('lp', args, { input: text, timeout: SPAWN_TIMEOUT_MS });
      if (result.status !== 0) {
        const stderr = result.stderr ? result.stderr.toString().slice(0, 200) : '';
        throw new Error(`lp exit ${result.status}: ${stderr}`);
      }
    }
  }
  return true;
}

// --- Função principal de impressão ---
async function printOrder(order, opts = {}) {
  if (!order) throw new Error('No order provided');

  const orderId = order.id || order.orderId || `noid-${Date.now()}`;

  // 1. Deduplicação
  if (isRecentlyPrinted(orderId)) {
    logFile(`Skipping duplicate print for order ${orderId}`);
    console.log('Skipping recently printed order', orderId);
    return false;
  }
  markPrintingStart(orderId);

  // 2. Preparar contexto e template
  const template = opts.receiptTemplate || DEFAULT_TEMPLATE;
  const printerSetting = {
    headerName: opts.headerName || process.env.HEADER_NAME || 'Minha Loja',
    headerCity: opts.headerCity || process.env.HEADER_CITY || ''
  };
  const context = buildContext(order, printerSetting);
  const copies = Math.max(1, Math.min(10, Number(opts.copies || DEFAULT_COPIES)));

  // Detectar se é template JSON v2
  const jsonBlocks = parseJsonTemplate(template);
  const isJsonTemplate = !!jsonBlocks;

  // Para fallback e dry-run, renderizar sempre como texto plano
  const renderedText = isJsonTemplate
    ? renderTemplate(DEFAULT_TEMPLATE, context)
    : renderTemplate(template, context);

  logFile(`Printing order ${orderId} - ${copies} copies - format ${isJsonTemplate ? 'json-v2' : 'plain'}`);
  console.log(`Printing order ${orderId} - ${copies} copies - format ${isJsonTemplate ? 'json-v2' : 'plain'}`);

  // 3. DRY_RUN
  const effectiveDryRun = (typeof opts.dryRun === 'boolean') ? opts.dryRun : DRY_RUN;
  if (effectiveDryRun) {
    console.log('[DRY_RUN] Would print:\n', renderedText);
    logFile('[DRY_RUN] ' + renderedText.slice(0, 500));
    markPrinted(orderId);
    return true;
  }

  // 4. Caminho primário: node-thermal-printer
  try {
    initPrinter(opts);

    for (let copy = 0; copy < copies; copy++) {
      if (isJsonTemplate) {
        // --- Template JSON v2: blocos com formatação ESC/POS ---
        renderJsonBlocks(jsonBlocks, context);
      } else {
        // --- Template texto plano v1: linha por linha ---
        const QR_PATTERN = /^\[QR:(.+)\]$/;
        const lines = renderedText.split('\n');
        for (const line of lines) {
          const qrMatch = line.trim().match(QR_PATTERN);
          if (qrMatch && qrMatch[1]) {
            try {
              ntp.alignCenter();
              ntp.printQR(qrMatch[1], { cellSize: 6, correction: 'M', model: 2 });
              ntp.println('Escaneie para despachar');
              ntp.alignLeft();
            } catch (qrErr) {
              ntp.println(line);
            }
          } else {
            ntp.println(line);
          }
        }
      }
      ntp.cut();
    }

    const result = await ntp.execute();
    logFile(`Printed via node-thermal-printer, result: ${result}`);
    console.log('Printed via node-thermal-printer to', opts.printerName || PRINTER_NAME || 'default');
    markPrinted(orderId);
    return true;
  } catch (err) {
    logFile(`node-thermal-printer failed: ${err.message}`);
    console.warn('node-thermal-printer failed:', err.message, '- trying system fallback');
  }

  // 5. Fallback: PowerShell/lp (usa texto plano sempre)
  try {
    await printViaSystem(renderedText, opts, copies);
    logFile(`Printed via system fallback (${process.platform})`);
    console.log('Printed via system fallback');
    markPrinted(orderId);
    return true;
  } catch (err) {
    logFile(`System fallback failed: ${err.message}`);
    console.error('System fallback failed:', err.message);
  }

  // 6. Tudo falhou - salvar para retry manual
  clearRecentPrint(orderId);
  const failPath = path.join(__dirname, 'failed-print', `failed-${orderId}-${Date.now()}.txt`);
  try {
    fs.writeFileSync(failPath, renderedText, 'utf8');
    logFile(`Saved failed print to ${failPath}`);
    console.log('Saved failed print to', failPath);
  } catch (e) { /* ignore */ }

  try {
    const jsonPath = path.join(__dirname, 'failed-print', `failed-${orderId}-${Date.now()}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({ order, opts, error: 'all-methods-failed' }, null, 2));
  } catch (e) { /* ignore */ }

  throw new Error('All print methods failed for order ' + orderId);
}

module.exports = {
  printOrder,
  formatOrderText: function (order, opts) {
    const context = buildContext(order, opts);
    return renderTemplate(opts && opts.receiptTemplate || DEFAULT_TEMPLATE, context);
  }
};
