/**
 * printerService.js - Serviço de impressão para comandas de delivery
 *
 * Arquitetura:
 *   1. Renderiza template via templateEngine
 *   2. Constrói buffer ESC/POS usando node-thermal-printer (interface NUL)
 *   3. Caminho primário: raw-spooler.exe (envia bytes RAW ao spooler Windows)
 *   4. Fallback ntp.execute() (se módulo 'printer' estiver instalado)
 *   5. Fallback: PowerShell Out-Printer (Windows) ou lp (Linux)
 *   6. Salva em disco se tudo falhar
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
const PRINTER_NAME_ENV = process.env.PRINTER_NAME || '';
const DEFAULT_COPIES = Number(process.env.COPIES || 1);
const DEDUPE_TTL_MS = Number(process.env.PRINT_DEDUPE_TTL_MS || 15000);
const SPAWN_TIMEOUT_MS = Number(process.env.PRINT_HELPER_TIMEOUT_MS || 30000);

// raw-spooler.exe - sends raw ESC/POS bytes to Windows print spooler
const RAW_SPOOLER_CANDIDATES = [
  path.join(__dirname, 'raw-spooler', 'raw-spooler.exe'),
  path.join(__dirname, 'raw-spooler', 'publish', 'raw-spooler.exe'),
  process.env.RAW_SPOOLER_EXE || ''
].filter(Boolean);
const RAW_SPOOLER_EXE = RAW_SPOOLER_CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;

// --- Auto-detect printer ---
// Se PRINTER_NAME não estiver no .env, tenta detectar uma impressora térmica USB
let DETECTED_PRINTER_NAME = '';

function detectThermalPrinter() {
  if (process.platform !== 'win32') return '';
  try {
    const { spawnSync } = require('child_process');
    const ps = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-Printer | Select-Object Name, PortName, DriverName, PrinterStatus | ConvertTo-Json -Compress'
    ], { timeout: 10000, windowsHide: true });
    if (ps.status !== 0 || !ps.stdout) return '';
    const raw = ps.stdout.toString().trim();
    const data = JSON.parse(raw);
    const printers = Array.isArray(data) ? data : [data];

    // Filtrar impressoras virtuais
    const skipNames = ['microsoft print to pdf', 'onenote', 'fax', 'xps', 'microsoft xps'];
    const candidates = printers.filter(p => {
      const name = (p.Name || '').toLowerCase();
      const port = (p.PortName || '').toUpperCase();
      const status = String(p.PrinterStatus || '').toLowerCase();
      // Pular virtuais
      if (skipNames.some(s => name.includes(s))) return false;
      // Pular impressoras em PendingDeletion
      if (status.includes('pendingdeletion') || status.includes('deletion')) return false;
      // Preferir impressoras em portas USB ou COM (térmicas)
      return port.startsWith('USB') || port.startsWith('COM') || port.startsWith('LPT');
    });

    // Preferir impressoras em estado Normal, depois qualquer candidata
    const normal = candidates.filter(p => {
      const status = String(p.PrinterStatus || '').toLowerCase();
      return status === 'normal' || status === '0' || status === '';
    });
    if (normal.length > 0) return normal[0].Name;
    if (candidates.length > 0) return candidates[0].Name;

    // Fallback: qualquer impressora física que não esteja em PendingDeletion
    const physical = printers.filter(p => {
      const name = (p.Name || '').toLowerCase();
      const status = String(p.PrinterStatus || '').toLowerCase();
      return !skipNames.some(s => name.includes(s)) && !status.includes('pendingdeletion');
    });
    return physical.length > 0 ? physical[0].Name : '';
  } catch (e) {
    console.warn('Auto-detect printer failed:', e.message);
    return '';
  }
}

if (PRINTER_NAME_ENV) {
  DETECTED_PRINTER_NAME = PRINTER_NAME_ENV;
  console.log('Printer (from .env):', DETECTED_PRINTER_NAME);
} else {
  DETECTED_PRINTER_NAME = detectThermalPrinter();
  if (DETECTED_PRINTER_NAME) {
    console.log('Printer (auto-detected):', DETECTED_PRINTER_NAME);
  } else {
    console.warn('WARNING: No thermal printer detected. Set PRINTER_NAME in .env');
  }
}

if (RAW_SPOOLER_EXE) {
  console.log('raw-spooler.exe found:', RAW_SPOOLER_EXE);
} else {
  console.warn('raw-spooler.exe NOT found - ESC/POS printing will fall back to Out-Printer');
}

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

// --- ESC/POS raw byte sequences ---
const PAPER_WIDTH_DOTS = Number(process.env.PAPER_WIDTH_DOTS || 576); // 576 = 80mm, 384 = 58mm
const ESCPOS_INIT = Buffer.from([
  0x1b, 0x40,       // ESC @ - Initialize / reset printer
  0x1b, 0x52, 0x08, // ESC R 8 - Select character table (PC860 Portuguese)
  0x1b, 0x21, 0x00, // ESC ! 0 - Select Font A, normal size (not condensed)
  0x1d, 0x4c, 0x00, 0x00, // GS L 0 0 - Set left margin to 0
  0x1d, 0x57, PAPER_WIDTH_DOTS & 0xFF, (PAPER_WIDTH_DOTS >> 8) & 0xFF, // GS W - Set print area width (576 dots = 80mm)
  0x1b, 0x32,       // ESC 2 - Set default line spacing
]);

/**
 * Inicializa o node-thermal-printer em modo buffer-only (interface NUL).
 * Isso constrói os bytes ESC/POS em memória sem tentar acessar a impressora.
 * O envio real é feito via raw-spooler.exe ou fallback.
 */
function initPrinter(opts = {}) {
  const type = PRINTER_TYPE === 'STAR' ? ntp.printerTypes.STAR : ntp.printerTypes.EPSON;

  ntp.init({
    type,
    interface: 'NUL',
    width: opts.width || PRINTER_WIDTH,
    characterSet: 'PC850_MULTILINGUAL',
    removeSpecialCharacters: false,
    options: { timeout: 5000 }
  });

  // Injeta sequência de inicialização ESC/POS:
  // Reset da impressora, margem 0, largura máxima, espaçamento padrão
  ntp.add(ESCPOS_INIT);
}

/**
 * Resolve o nome da impressora a partir das opções / env / auto-detect.
 */
function resolveRealPrinterName(opts = {}) {
  return opts.printerName || DETECTED_PRINTER_NAME || 'default';
}

/**
 * Envia bytes RAW para a impressora via raw-spooler.exe (Win32 spooler API).
 * Isso garante que os bytes ESC/POS cheguem à impressora sem processamento GDI.
 */
async function sendViaRawSpooler(buffer, printerName) {
  if (!RAW_SPOOLER_EXE) throw new Error('raw-spooler.exe not found');
  if (!buffer || buffer.length === 0) throw new Error('Empty buffer');

  const { spawnSync } = require('child_process');
  const tmpFile = path.join(__dirname, `tmp-raw-${Date.now()}.bin`);

  try {
    fs.writeFileSync(tmpFile, buffer);
    const result = spawnSync(RAW_SPOOLER_EXE, [printerName, tmpFile], {
      timeout: SPAWN_TIMEOUT_MS,
      windowsHide: true
    });
    if (result.status !== 0) {
      const stderr = result.stderr ? result.stderr.toString().slice(0, 300) : '';
      throw new Error(`raw-spooler exit ${result.status}: ${stderr}`);
    }
    return true;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
  }
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
  const printerName = opts.printerName || DETECTED_PRINTER_NAME;

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

/**
 * Renderiza blocos JSON v2 como texto plano formatado (para fallback sem ESC/POS).
 * Respeita a estrutura do template customizado do usuário.
 */
function renderV2AsText(blocks, context, width) {
  const W = width || PRINTER_WIDTH;
  const SEP = '='.repeat(W);
  const lines = [];

  for (const block of blocks) {
    try {
      switch (block.t) {
        case 'sep':
          lines.push(SEP);
          break;
        case 'text': {
          const text = renderBlockContent(block.c || '', context);
          if (!text.trim() && !block.c) break;
          if (block.a === 'center') {
            lines.push(text.trim().length < W ? text.trim().padStart(Math.floor((W + text.trim().length) / 2)) : text);
          } else if (block.a === 'right') {
            lines.push(text.trim().padStart(W));
          } else {
            lines.push(text);
          }
          break;
        }
        case 'cond': {
          const val = context[block.key];
          if (!val || val === '0' || val === '0.00') break;
          const text = renderBlockContent(block.c || '', context);
          lines.push(text);
          break;
        }
        case 'items': {
          const items = context.items;
          if (!Array.isArray(items) || items.length === 0) break;
          for (const item of items) {
            const merged = Object.assign({}, context, item);
            lines.push(replacePlaceholders('{{item_qty}}x  {{item_name}}  R$ {{item_price}}', merged));
            if (Array.isArray(item.item_options)) {
              for (const opt of item.item_options) {
                const optMerged = Object.assign({}, merged, opt);
                lines.push(replacePlaceholders('  -- {{option_qty}}x {{option_name}}  R$ {{option_price}}', optMerged));
              }
            }
            if (item.notes) lines.push('  OBS: ' + item.notes);
          }
          break;
        }
        case 'payments': {
          const pags = context.pagamentos;
          if (!Array.isArray(pags) || pags.length === 0) break;
          for (const p of pags) {
            const merged = Object.assign({}, context, p);
            lines.push(replacePlaceholders('{{payment_method}}   R$ {{payment_value}}', merged));
          }
          break;
        }
        case 'qr': {
          const qrUrl = context.qr_url;
          if (qrUrl) lines.push('[QR:' + qrUrl + ']');
          break;
        }
        default: break;
      }
    } catch (e) { /* ignore block error */ }
  }
  return lines.join('\n');
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
  const realPrinterName = resolveRealPrinterName(opts);

  // Detectar se é template JSON v2
  const jsonBlocks = parseJsonTemplate(template);
  const isJsonTemplate = !!jsonBlocks;

  // Texto plano para fallback/dry-run - respeita template v2 se disponível
  const renderedText = isJsonTemplate
    ? renderV2AsText(jsonBlocks, context, opts.width || PRINTER_WIDTH)
    : renderTemplate(template, context);

  logFile(`Printing order ${orderId} - ${copies} copies - format ${isJsonTemplate ? 'json-v2' : 'plain'} - printer ${realPrinterName}`);
  console.log(`Printing order ${orderId} - ${copies} copies - format ${isJsonTemplate ? 'json-v2' : 'plain'} - printer ${realPrinterName}`);

  // 3. DRY_RUN
  const effectiveDryRun = (typeof opts.dryRun === 'boolean') ? opts.dryRun : DRY_RUN;
  if (effectiveDryRun) {
    console.log('[DRY_RUN] Would print:\n', renderedText);
    logFile('[DRY_RUN] ' + renderedText.slice(0, 500));
    markPrinted(orderId);
    return true;
  }

  // 4. Caminho primário: construir buffer ESC/POS e enviar via raw-spooler
  let escposBuffer = null;
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

    // Obter o buffer ESC/POS construído
    escposBuffer = ntp.getBuffer();
    ntp.clear();
  } catch (err) {
    logFile(`ESC/POS buffer build failed: ${err.message}`);
    console.warn('ESC/POS buffer build failed:', err.message);
  }

  // 4a. Enviar buffer via raw-spooler.exe (caminho preferido no Windows)
  if (escposBuffer && escposBuffer.length > 0 && RAW_SPOOLER_EXE) {
    try {
      await sendViaRawSpooler(escposBuffer, realPrinterName);
      logFile(`Printed via raw-spooler (${escposBuffer.length} bytes) to ${realPrinterName}`);
      console.log(`Printed via raw-spooler (${escposBuffer.length} bytes) to`, realPrinterName);
      markPrinted(orderId);
      return true;
    } catch (err) {
      logFile(`raw-spooler failed: ${err.message}`);
      console.warn('raw-spooler failed:', err.message, '- trying ntp.execute fallback');
    }
  }

  // 4b. Fallback: tentar ntp.execute() (requer módulo 'printer' nativo)
  if (escposBuffer && escposBuffer.length > 0) {
    try {
      // Reinicializar com interface real da impressora
      const realIface = realPrinterName && realPrinterName !== 'default'
        ? `printer:${realPrinterName}`
        : (process.env.PRINTER_INTERFACE || 'printer:default');
      const type = PRINTER_TYPE === 'STAR' ? ntp.printerTypes.STAR : ntp.printerTypes.EPSON;
      ntp.init({
        type,
        interface: realIface,
        width: opts.width || PRINTER_WIDTH,
        characterSet: 'PC850_MULTILINGUAL',
        removeSpecialCharacters: false,
        options: { timeout: 5000 }
      });
      ntp.setBuffer(escposBuffer);
      const result = await ntp.execute();
      logFile(`Printed via node-thermal-printer native, result: ${result}`);
      console.log('Printed via node-thermal-printer native to', realPrinterName);
      markPrinted(orderId);
      return true;
    } catch (err) {
      logFile(`node-thermal-printer native execute failed: ${err.message}`);
      console.warn('ntp.execute fallback failed:', err.message, '- trying system fallback');
    }
  }

  // 5. Fallback: PowerShell/lp (usa texto plano - agora com template correto)
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
