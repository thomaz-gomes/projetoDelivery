require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
// node-thermal-printer has changed exports across versions; defensively import
const ntp = require('node-thermal-printer');
const ThermalPrinter = ntp.printer || ntp.ThermalPrinter || ntp.Printer || ntp;
const PrinterTypes = ntp.types || ntp.PrinterTypes || ntp.Types || { EPSON: 'EPSON', STAR: 'STAR' };

const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(__dirname, 'logs'));
const PRINTER_INTERFACE = process.env.PRINTER_INTERFACE || 'printer:default';
const PRINTER_TYPE = (process.env.PRINTER_TYPE || 'EPSON').toUpperCase();
const DRY_RUN = (String(process.env.DRY_RUN || 'false').toLowerCase() === 'true');
const PRINTER_CHARSET = process.env.PRINTER_CHARSET || 'SLOVENIA';
// Desired scale factor for fonts (float). Note: ESC/POS supports integer multiples only; we will
// approximate by rounding and/or try high-level API calls that may accept fractional values.
const PRINTER_SCALE = Number(process.env.PRINTER_SCALE || 1.25);
// ensure env is set for downstream modules that may read it
if (!process.env.PRINTER_CHARSET) process.env.PRINTER_CHARSET = PRINTER_CHARSET;

// iconv-lite for charset conversions (used for ESC/POS CP1252 output)
let iconv = null;
try { iconv = require('iconv-lite'); } catch (e) { iconv = null }
// Codepage used when encoding ESC/POS payloads for raw spooler (default Windows-1252)
const PRINTER_CODEPAGE = process.env.PRINTER_CODEPAGE || 'windows-1252';

// optional QR code rendering (PNG/ASCII) for delivery receipts
let QRLib = null;
try { QRLib = require('qrcode'); } catch (e) { QRLib = null }

// optional PNG decode helpers (to extract textual QR from PNG images)
let Jimp = null;
let jsQR = null;
try { Jimp = require('jimp'); } catch (e) { Jimp = null }
try { jsQR = require('jsqr'); } catch (e) { jsQR = null }

async function decodePngQr(pngBuf) {
  if (!pngBuf || !Jimp || !jsQR) return null;
  try {
    const image = await Jimp.read(pngBuf);
    const { data, width, height } = image.bitmap;
    // data is a Buffer of RGBA bytes; jsQR expects Uint8ClampedArray of RGB(A)
    const arr = new Uint8ClampedArray(data);
    const code = jsQR(arr, width, height);
    if (code && code.data) return code.data;
    return null;
  } catch (e) {
    return null;
  }
}

// Convert PNG buffer to ESC/POS raster command (GS v 0) using sharp to get raw pixels
async function pngToEscposRaster(pngBuf, threshold = 127) {
  if (!pngBuf) return null;
  try {
    const s = require('sharp');
    const { data, info } = await s(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const width = info.width; const height = info.height; const channels = info.channels;
    const bytesPerRow = Math.ceil(width / 8);
    const raster = Buffer.alloc(bytesPerRow * height);
    let offset = 0;
    for (let y = 0; y < height; y++) {
      for (let xb = 0; xb < bytesPerRow; xb++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xb * 8 + bit;
          let black = false;
          if (x < width) {
            const idx = (y * width + x) * channels;
            const r = data[idx] || 0;
            const g = data[idx + 1] || 0;
            const b = data[idx + 2] || 0;
            const a = channels > 3 ? data[idx + 3] : 255;
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255);
            if (lum < threshold) black = true;
          }
          if (black) byte |= (0x80 >> bit);
        }
        raster[offset++] = byte;
      }
    }
    const xL = bytesPerRow & 0xFF;
    const xH = (bytesPerRow >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;
    // GS v 0 m xL xH yL yH
    const header = Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
    return Buffer.concat([header, raster]);
  } catch (e) {
    logFile('pngToEscposRaster failed: ' + (e && e.message));
    return null;
  }
}

// Render plain text into a PNG via SVG (monospace) and return PNG buffer.
async function renderTextToPng(text, scale = 1.0, widthPx = 576) {
  if (!text) return null;
  try {
    const s = require('sharp');
    const lines = String(text).split(/\r?\n/);
    const baseFont = 12; // base font size in px
    const fontSize = Math.max(8, Math.round(baseFont * (scale || 1)));
    const lineHeight = Math.round(fontSize * 1.25);
    const heightPx = Math.max(64, lines.length * lineHeight + 20);

    // escape HTML
    const esc = (str) => String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // include a white background rect to avoid transparent background becoming black
    const svg = `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='${widthPx}' height='${heightPx}'>\n  <rect width='100%' height='100%' fill='#ffffff'/>\n  <style>pre{font-family: 'Courier New', monospace; white-space: pre; font-size: ${fontSize}px; line-height: ${lineHeight}px; color:#000000; }</style>\n  <foreignObject width='100%' height='100%'>\n    <body xmlns='http://www.w3.org/1999/xhtml'><pre>${esc(lines.join('\n'))}</pre></body>\n  </foreignObject>\n</svg>`;

    // Use sharp and flatten to ensure opaque white background
    let png = await s(Buffer.from(svg)).png().flatten({ background: '#ffffff' }).toBuffer();
    // debug: optionally save raster PNG for inspection
    try {
      if (String(process.env.PRINT_DEBUG_SAVE_RASTER || '').toLowerCase() === 'true') {
        const ts = Date.now();
        const debugPath = path.join(__dirname, 'logs', `raster-debug-${ts}.png`);
        try { fs.writeFileSync(debugPath, png); logFile(`Saved debug raster PNG: ${debugPath}`); } catch (e) { /* ignore */ }
      }
    } catch (eDbg) { /* ignore */ }
    return png;
  } catch (e) {
    logFile('renderTextToPng failed: ' + (e && e.message));
    return null;
  }
}

// Timeout for external print helper calls (ms). Can be overridden with env PRINT_HELPER_TIMEOUT_MS
const SPAWN_TIMEOUT_MS = process.env.PRINT_HELPER_TIMEOUT_MS ? Number(process.env.PRINT_HELPER_TIMEOUT_MS) : 60000;

mkdirp.sync(LOG_DIR);
mkdirp.sync(path.join(__dirname, 'failed-print'));

function logFile(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(path.join(LOG_DIR, 'agent.log'), line);
}

function formatOrderText(order, opts = {}) {
  if (!order) return '';
  const display = order.displaySimple != null ? String(order.displaySimple).padStart(2,'0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : (order.id || '').slice(0,6));
  const date = order.createdAt || order.date || order.created || new Date().toISOString();

  // determine paper width (chars) preference: opts.paperWidth (58/80) or env PRINTER_WIDTH or default 80
  const pw = Number(opts.paperWidth || process.env.PRINTER_WIDTH || 80);
  const nameCol = (pw === 58) ? 16 : 25;
  const includeDesc = !!(opts && opts.includeItemDescription);

  const lines = [];
  lines.push(`pedido: ${display} | ${String(date).split('T')[0]}`);
  lines.push((order.customerName || order.name || 'NOME DO CLIENTE').toUpperCase());
  lines.push('--------------------');
  const address = order.addressFull || order.address || order.addressString || [order.street, order.number].filter(Boolean).join(' ') || '-';
  lines.push(address);
  lines.push('---------------------');
  const phones = (order.customerPhone && String(order.customerPhone)) || (order.phone && String(order.phone)) || (Array.isArray(order.phones) ? order.phones.join(' / ') : '');
  if (phones) lines.push(`Telefones: ${phones}`);
  if (order.ifoodLocator || order.ifood_code || order.ifood || order.externalLocator) lines.push(`Localizador iFood: ${order.ifoodLocator || order.ifood_code || order.ifood || order.externalLocator}`);
  if (order.ifoodCollectionCode || order.collectionCode || order.pickupCode) lines.push(`Código de coleta: ${order.ifoodCollectionCode || order.collectionCode || order.pickupCode}`);
  lines.push('');

  lines.push('QT  Descrição'.padEnd(3 + 1 + nameCol, ' ') + 'Valor');
  let totalItemsCount = 0;
  let subtotal = 0;
  (order.items || []).forEach(it => {
    const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
    totalItemsCount += qty;
    const name = String(it.name || it.title || it.productName || '').slice(0, nameCol);
    const priceNum = Number(it.price ?? it.unitPrice ?? it.amount ?? 0) || 0;
    subtotal += priceNum * qty;
    lines.push(`${String(qty).padEnd(3,' ')} ${name.padEnd(nameCol,' ')} ${priceNum.toFixed(2).padStart(7,' ')}`);
    const extras = it.options || it.extras || it.modifiers || it.addons || it.subItems || [];
    if (includeDesc && (it.description || it.desc || it.note)) {
      const desc = String(it.description || it.desc || it.note || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (desc) lines.push(`   - ${desc}`);
    }
    if (Array.isArray(extras) && extras.length) {
      extras.forEach(ex => {
        const exQty = ex.quantity ?? ex.qty ?? 1;
        const exName = ex.name || ex.title || ex.description || String(ex).slice(0,40);
        const exPrice = Number(ex.price ?? ex.amount ?? 0) || 0;
        lines.push(`-- ${exQty} ${exName.slice(0,40)}   ${exPrice.toFixed(2).padStart(7,' ')}`);
      })
    }
  });

  lines.push(`\nQuantidade de itens  ${totalItemsCount}`);
  lines.push('---------------------------');

  const additions = Number(order.additions ?? order.charges ?? order.extra ?? 0) || 0;
  const discounts = Number(order.discounts ?? order.discount ?? order.couponsAmount ?? 0) || 0;
  const total = Number(order.total ?? order.amount ?? order.orderAmount ?? subtotal + additions - discounts) || 0;

  lines.push(`Total de itens   ${subtotal.toFixed(2)}`);
  if (additions) lines.push(`Acrescimos       ${additions.toFixed(2)}`);
  if (discounts) lines.push(`Descontos        ${discounts.toFixed(2)}`);

  lines.push('\nFORMAS DE PAGAMENTO');
  // Support multiple shapes: order.payments array, payload.payment, _normalized.payment, or single payment fields
  const paymentsList = Array.isArray(order.payments) ? order.payments
    : (order.payload && order.payload.payments) ? order.payload.payments
    : (order.payload && order.payload.payment) ? [order.payload.payment]
    : (order._normalized && order._normalized.payments) ? order._normalized.payments
    : (order._normalized && order._normalized.payment) ? [order._normalized.payment]
    : [];

  if (Array.isArray(paymentsList) && paymentsList.length) {
    paymentsList.forEach(p => {
      const label = p.method || p.type || p.name || p.paymentMethod || (p.methodCode || '') || 'Pagamento';
      const val = Number(p.amount ?? p.value ?? p.paymentAmount ?? 0) || 0;
      lines.push(`${String(label).toUpperCase()}   ${val.toFixed(2)}`);
    });
  } else {
    // fallback single-field payment info in several possible shapes
    const singleLabel = order.paymentMethod || order.paymentType || (order.payload && order.payload.payment && order.payload.payment.method) || (order._normalized && order._normalized.paymentMethod) || (order._normalized && order._normalized.payment && order._normalized.payment.method);
    const singleVal = Number(order.paymentAmount ?? order.paymentValue ?? (order.payload && order.payload.payment && order.payload.payment.amount) ?? (order._normalized && order._normalized.payment && order._normalized.payment.amount) ?? total) || total;
    if (singleLabel) lines.push(`${String(singleLabel).toUpperCase()}   ${singleVal.toFixed(2)}`);
  }

  // Prefer embedded QR image/data, otherwise look in payload/_normalized for qrUrl or qr text
  const qrVal = order.qrDataUrl || order.qrImage || order.qr || order.qrUrl || (order.payload && (order.payload.qrUrl || order.payload.qr)) || (order._normalized && (order._normalized.qrUrl || order._normalized.qr));
  if (qrVal) {
    // If it's a data URL, indicate presence; otherwise print the URL/text
    if (typeof qrVal === 'string' && qrVal.startsWith('data:image')) lines.push('[QR IMAGE]');
    else lines.push(`QR: ${qrVal}`);
  } else {
    lines.push('[QR CODE]');
  }
  if (order.ifoodId || order.ifood_order_id || order.externalOrderId) lines.push(`NUMERO DO PEDIDO NO IFOOD: ${order.ifoodId || order.ifood_order_id || order.externalOrderId}`);
  if (order.channel || order.source || order.salesChannel) lines.push(`CANAL DE VENDA: ${order.channel || order.source || order.salesChannel}`);

  return lines.join('\n');
}

async function printOrder(order, opts = {}) {
  const text = formatOrderText(order, opts);
  logFile(`Printing order ${order && order.id || 'null'} - length ${text.length}`);

  // prepare PNG buffer (if any) early so raw-spooler path can include raster image
  let pngBufForRaw = null;
  try {
    const qrCandidate = (order.qrDataUrl || order.qrImage || order.qr || order.qrUrl || order.qrcode || order.qrData || null);
    if (qrCandidate) {
      if (typeof qrCandidate === 'string' && qrCandidate.startsWith('data:image')) {
        try { pngBufForRaw = Buffer.from((qrCandidate.split(',')[1] || ''), 'base64'); } catch (e) { pngBufForRaw = null; }
      } else if (QRLib) {
        try { pngBufForRaw = await QRLib.toBuffer(String(qrCandidate), { type: 'png', width: 220 }); } catch (e) { pngBufForRaw = null; }
      }
    }
  } catch (eP) { pngBufForRaw = null; }

  // effective settings: opts override environment values for a single print
  const effectivePrinterInterface = (opts && opts.printerInterface) ? opts.printerInterface : PRINTER_INTERFACE;
  const effectivePrinterType = (opts && opts.printerType) ? String(opts.printerType).toUpperCase() : PRINTER_TYPE;
  const effectiveDryRun = (opts && typeof opts.dryRun === 'boolean') ? opts.dryRun : DRY_RUN;
  const effectivePrinterCodepage = (opts && opts.printerCodepage) ? opts.printerCodepage : PRINTER_CODEPAGE;

  if (effectiveDryRun) {
    console.log('[DRY_RUN] Printing content:\n', text);
    return;
  }

    // Resolve type safely even if PrinterTypes is not the expected object
    let resolvedType = null;
    let printer = null;
    let printerApiType = null;
    try {
      if (PrinterTypes && typeof PrinterTypes === 'object') {
        if (effectivePrinterType === 'STAR' && Object.prototype.hasOwnProperty.call(PrinterTypes, 'STAR')) resolvedType = PrinterTypes.STAR;
        else if (effectivePrinterType === 'EPSON' && Object.prototype.hasOwnProperty.call(PrinterTypes, 'EPSON')) resolvedType = PrinterTypes.EPSON;
        else {
          const vals = Object.values(PrinterTypes).filter(Boolean);
          resolvedType = vals.length ? vals[0] : effectivePrinterType;
        }
      } else {
        resolvedType = effectivePrinterType;
      }

      const initOptions = {
        type: (resolvedType && resolvedType.toLowerCase ? resolvedType.toLowerCase() : resolvedType),
        interface: effectivePrinterInterface,
        width: process.env.PRINTER_WIDTH ? Number(process.env.PRINTER_WIDTH) : 48,
        characterSet: PRINTER_CHARSET,
        removeSpecialCharacters: process.env.PRINTER_REMOVE_SPECIAL ? (String(process.env.PRINTER_REMOVE_SPECIAL).toLowerCase() === 'true') : false,
        replaceSpecialCharacters: process.env.PRINTER_REPLACE_SPECIAL ? (String(process.env.PRINTER_REPLACE_SPECIAL).toLowerCase() === 'true') : true,
        options: { timeout: 5000 }
      };

      if (ThermalPrinter && typeof ThermalPrinter === 'function') {
        printer = new ThermalPrinter(initOptions);
        printerApiType = 'module-constructor';
      } else if (ThermalPrinter && typeof ThermalPrinter === 'object') {
        printer = ThermalPrinter;
        if (typeof printer.init === 'function') printer.init(initOptions);
        printerApiType = 'module-object';
      }

      // sanity-check that init succeeded; some versions may throw silently or not set internal config
      try {
        if (printer && typeof printer.getWidth === 'function') {
          printer.getWidth();
        }
      } catch (eCheck) {
        throw new Error('module-init-failed: ' + (eCheck && eCheck.message));
      }
    } catch (e) {
      console.warn('Failed to initialize printer API', e && e.message);
    }

    logFile(`printerApiType: ${printerApiType} - interface:${effectivePrinterInterface} type:${effectivePrinterType}`);
    console.log(`printerApiType: ${printerApiType} - interface:${effectivePrinterInterface} type:${effectivePrinterType}`);

    // Attempt to apply requested scale to the high-level printer API if available.
    try {
      if (printer && typeof printer.setTextSize === 'function') {
        try {
          // Some implementations accept floats, others require integers. Try both.
          printer.setTextSize(PRINTER_SCALE, PRINTER_SCALE);
          logFile(`Applied printer.setTextSize(${PRINTER_SCALE}, ${PRINTER_SCALE})`);
        } catch (eSet) {
          const i = Math.max(1, Math.round(PRINTER_SCALE));
          try { printer.setTextSize(i, i); logFile(`Applied printer.setTextSize(${i}, ${i}) (rounded)`); } catch(e2) {}
        }
      } else if (printer && typeof printer.setTextNormal === 'function') {
        // nothing to do, keep default
      }
    } catch (eApply) {
      logFile('Failed to apply setTextSize on printer API: ' + (eApply && eApply.message));
    }

    // Prefer raw-spooler helper when available on Windows: bypass native module
    try {
      const printerName = (String(effectivePrinterInterface || '') || '').replace(/^printer:/i, '').trim();
      const helperCandidates = [
        path.join(__dirname, 'raw-spooler', 'raw-spooler.exe'),
        path.join(__dirname, 'raw-spooler', 'publish', 'raw-spooler.exe'),
        path.join(__dirname, 'raw-spooler', 'bin', 'Release', 'net6.0', 'win-x64', 'publish', 'raw-spooler.exe')
      ];
      const helperPath = helperCandidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false } });

      if (helperPath && process.platform === 'win32' && printerName && !effectiveDryRun) {
        console.log('Attempting to use raw-spooler helper at', helperPath, 'printerName:', printerName);
        // Build binary payload from formatted text (use same text used for logging)
        let dataBuf;
        try {
          if (iconv && iconv.encode) dataBuf = iconv.encode(text + '\n\n', effectivePrinterCodepage);
          else dataBuf = Buffer.from(text + '\n\n', 'utf8');
        } catch (eEnc) {
          dataBuf = Buffer.from(text + '\n\n', 'utf8');
        }
        const cutBuf = Buffer.from([0x1D, 0x56, 0x00]);

        // Construct ESC/POS size command that approximates PRINTER_SCALE.
        // ESC/POS GS ! n sets width/height multipliers as integer (1x,2x,...).
        let escSizeBuf = null;
        try {
          const intScale = Math.max(1, Math.min(8, Math.round(PRINTER_SCALE)));
          if (intScale > 1) {
            const n = ((intScale - 1) & 0x0F) | (((intScale - 1) & 0x0F) << 4);
            escSizeBuf = Buffer.from([0x1D, 0x21, n]);
            logFile(`Prepared ESC/POS size header for scale ~${intScale} (PRINTER_SCALE=${PRINTER_SCALE})`);
          } else {
            // no integer scaling needed
          }
        } catch (eSz) {
          logFile('Failed to prepare ESC/POS size header: ' + (eSz && eSz.message));
          escSizeBuf = null;
        }

        // If we have a PNG buffer prepared earlier, try to convert to ESC/POS raster and include it
        let rasterBuf = null;
        try {
          if (pngBufForRaw) {
            rasterBuf = await pngToEscposRaster(pngBufForRaw);
            if (rasterBuf) logFile(`Including ESC/POS raster in raw payload (size=${rasterBuf.length})`);
            else logFile('pngToEscposRaster returned null, not including raster');
          }
        } catch (eR) {
          logFile('pngToEscposRaster failed (primary raw path): ' + (eR && eR.message));
          rasterBuf = null;
        }

        // Build final payload: optional ESC size header, text, optional raster, reset size, cut
        const escReset = Buffer.from([0x1D, 0x21, 0x00]);
        let parts = [];
        if (escSizeBuf) parts.push(escSizeBuf);
        parts.push(dataBuf);
        if (rasterBuf) parts.push(rasterBuf);
        if (escSizeBuf) parts.push(escReset);
        parts.push(cutBuf);
        const final = Buffer.concat(parts);
        const ts = Date.now();
        const fnameBin = path.join(__dirname, 'failed-print', `helper-${ts}.bin`);
        try { fs.writeFileSync(fnameBin, final); } catch (e) { logFile(`Failed to write helper bin ${fnameBin}: ${e && e.message}`); }

        const spawnSync = require('child_process').spawnSync;
        const res = spawnSync(helperPath, [printerName, fnameBin], { timeout: SPAWN_TIMEOUT_MS, windowsHide: true });
        try {
          if (res && res.stdout && res.stdout.length) logFile(`raw-spooler stdout: ${Buffer.from(res.stdout || '').toString()}`);
          if (res && res.stderr && res.stderr.length) logFile(`raw-spooler stderr: ${Buffer.from(res.stderr || '').toString()}`);
        } catch (eLog) { /* ignore */ }
        if (res && res.error) {
          logFile(`raw-spooler error: ${res.error && res.error.message}`);
          console.error('raw-spooler error', res.error && res.error.message);
          // fallthrough to native path
        } else if (res && res.status === 0) {
          logFile(`Printed via raw-spooler helper (${helperPath}) to printer '${printerName}'`);
          console.log('Printed via raw-spooler helper', printerName);
          return true;
        } else {
          logFile(`raw-spooler returned status ${res && res.status}`);
          console.warn('raw-spooler returned status', res && res.status);
          // fallthrough
        }
      }
    } catch (ePrefer) {
      logFile(`raw-spooler prefer attempt failed: ${ePrefer && ePrefer.message}`);
    }

    // If initialization failed and we don't have a usable printer instance,
    // provide a lightweight JS fallback so the agent can still respond to
    // test-print requests (important for DRY_RUN and environments without
    // native printer bindings).
    if (!printer || printerApiType === 'module-object' && (!printer || typeof printer.execute !== 'function')) {
      logFile('Using fallback JS printer implementation (no native interface)');
      let buf = '';
      const fallback = {
        alignCenter: () => { buf += '[alignCenter]\n'; },
        alignLeft: () => { buf += '[alignLeft]\n'; },
        alignRight: () => { buf += '[alignRight]\n'; },
        println: (t) => { buf += (t == null ? '' : String(t)) + '\n'; },
        print: (t) => { buf += (t == null ? '' : String(t)); },
        newLine: () => { buf += '\n'; },
        setTable: () => {},
        tableCustom: (arr) => { buf += arr.map(a => a && a.text ? a.text : '').join(' | ') + '\n'; },
        cut: () => { buf += '[cut]\n'; },
        execute: async () => {
          // write to log file for inspection and act as successful print
          logFile('[fallback execute] ' + buf.slice(0, 2000));
          console.log('[FALLBACK PRINT]');
          console.log(buf);
          return true;
        }
      };

      printer = fallback;
      printerApiType = 'fallback';
    }

  try {
    // Build command buffer - guard this phase so we can fallback to shim if the
    // native/printer module is partially broken (e.g., missing internal config)
    try {
      // Use the unified text formatter so the preview and the real print match
      const fullText = formatOrderText(order, opts);
      const lines = String(fullText || '').split(/\r?\n/);
      // print line-by-line using the printer API available
      lines.forEach(l => {
        try {
          if (typeof printer.println === 'function') printer.println(l);
          else if (typeof printer.print === 'function') printer.print(l + '\n');
        } catch (e) {
          // ignore per-line errors and continue
        }
      });

      // If this is a delivery order, try to render a QR code (if order contains QR data)
      const isDelivery = !!(order.delivery || order.isDelivery || (order.fulfillment && String(order.fulfillment).toLowerCase().includes('delivery')) || (order.type && /delivery/i.test(order.type)) || (order.pickup === false));
      const qrData = (order.qrDataUrl || order.qrImage || order.qr || order.qrUrl || order.qrcode || order.qrData || null);
            if (isDelivery && qrData) {
        try {
          if (QRLib) {
            // If the frontend provided a data URL image, decode it and use the buffer directly.
            let pngBuf = null;
            try {
              if (typeof qrData === 'string' && qrData.startsWith('data:image')) {
                const parts = qrData.split(',');
                const b64 = parts[1] || '';
                pngBuf = Buffer.from(b64, 'base64');
              } else {
                pngBuf = await QRLib.toBuffer(String(qrData), { type: 'png', width: 200 });
              }
            } catch (eBuf) {
              pngBuf = null;
            }
                  // If we only have a PNG (data URL) and no textual QR, attempt to decode it to text
                  let textualFromPng = null;
                  if (pngBuf && (!qrData || (typeof qrData === 'string' && qrData.startsWith('data:image')))) {
                    try {
                      const decoded = await decodePngQr(pngBuf);
                      if (decoded) {
                        textualFromPng = decoded;
                        logFile('Decoded textual QR from PNG for order ' + (order && order.id || 'noid'));
                      }
                    } catch (eDec) {
                      // ignore decode errors
                    }
                  }

                  // prefer textual if available (either from original qrData string or decoded)
                  const textualQr = (typeof qrData === 'string' && !qrData.startsWith('data:image')) ? String(qrData) : (textualFromPng || null);

            const imageMethods = ['printImageBuffer', 'printImage', 'printPNG', 'printBitmap', 'printImageSync', 'image', 'printImageFile'];
            let printedImage = false;
            for (const m of imageMethods) {
              try {
                if (printer && typeof printer[m] === 'function') {
                  try {
                    // Some implementations accept Buffer directly
                    console.log('Attempting image method', m, 'with pngBuf?', !!pngBuf);
                    const r = pngBuf ? printer[m](pngBuf) : printer[m](String(qrData));
                    if (r) printedImage = true;
                    if (printedImage) console.log('Printed image using method', m);
                  } catch (e) {
                    if (pngBuf) {
                      // Otherwise try writing a temp file and call with path
                      const tmp = path.join(__dirname, `tmp-qr-${Date.now()}.png`);
                      fs.writeFileSync(tmp, pngBuf);
                      try { printer[m](tmp); printedImage = true; console.log('Printed image by writing temp file', tmp); } catch (e2) { console.warn('Image print via tmp file failed', e2 && e2.message); }
                      try { fs.unlinkSync(tmp); } catch (e3) { /* ignore */ }
                    }
                  }
                  if (printedImage) break;
                }
              } catch (e) { /* continue */ }
            }

            if (!printedImage) {
              try {
                // If we have textual QR (either original or decoded from PNG), render ASCII
                const asciiSource = textualQr || (typeof qrData === 'string' && !qrData.startsWith('data:image') ? String(qrData) : null);
                if (asciiSource) {
                  const ascii = await QRLib.toString(String(asciiSource), { type: 'terminal' });
                  if (ascii) {
                    console.log('Printing ASCII QR fallback');
                    if (typeof printer.println === 'function') printer.println(ascii);
                    else if (typeof printer.print === 'function') printer.print(ascii + '\n');
                  } else if (asciiSource) {
                    // if ascii generation returned empty, print textual source
                    if (typeof printer.println === 'function') printer.println(String(asciiSource));
                  }
                } else {
                  // Last resort: if we only had a data URL and couldn't decode, print raw text
                  if (typeof printer.println === 'function') printer.println(String(qrData));
                }
              } catch (eAscii) {
                console.warn('ASCII fallback failed, printing QR text', eAscii && eAscii.message);
                if (typeof printer.println === 'function') printer.println(String(qrData));
              }
            }
          } else {
            if (typeof printer.println === 'function') printer.println(String(qrData));
          }
        } catch (eQr) {
          logFile(`Failed to render QR: ${eQr && eQr.message}`);
        }
      }

      if (typeof printer.cut === 'function') printer.cut();

      // send to printer
      let execute;
      console.log('About to execute printer commands; printerApiType=', printerApiType);
      try {
        execute = await (typeof printer.execute === 'function' ? printer.execute() : (printer.execute ? printer.execute : Promise.resolve(true)));
      } catch (errCreate) {
        // If the installed `node-thermal-printer` has a different API shape
        // attempt a graceful fallback to a shim implementation.
        logFile(`Primary printer.execute failed: ${errCreate && errCreate.message}`);
        console.error('Primary printer.execute failed:', errCreate && errCreate.message);
        throw errCreate;
      }

      // execute returns true/false depending on success in some versions
      logFile(`Printer execute result: ${execute}`);
      console.log('Printed to interface', effectivePrinterInterface, 'result:', execute);

      return execute;
    } catch (buildErr) {
      // Fallback shim if building commands against native printer failed
      console.warn('Native printer build failed, using ShimPrinter fallback:', buildErr && buildErr.message);
      logFile(`Native printer build failed, fallback: ${buildErr && buildErr.message}`);

      class ShimPrinter2 {
        constructor() { this._buf = []; }
        alignCenter() { this._buf.push('[alignCenter]'); }
        alignLeft() { this._buf.push('[alignLeft]'); }
        println(s = '') { this._buf.push(String(s)); }
        newLine() { this._buf.push('\n'); }
        setTable() {}
        tableCustom(cols) { this._buf.push(cols.map(c => c.text).join(' | ')); }
        cut() { this._buf.push('[CUT]'); }
        async execute() {
          const out = this._buf.join('\n');
          const ts = Date.now();
          const fnameTxt = path.join(__dirname, 'failed-print', `shim2-${ts}.txt`);
          const fnameBin = path.join(__dirname, 'failed-print', `shim2-${ts}.bin`);
          // write text file for debugging
          try { fs.writeFileSync(fnameTxt, out, 'utf8'); } catch (e) { logFile(`Shim2 failed to write text file ${fnameTxt}: ${e && e.message}`); }

          const printerName = (String(effectivePrinterInterface || '') || '').replace(/^printer:/i, '').trim();
          // try raw-spooler helper if available
          try {
            const helperCandidates = [
              path.join(__dirname, 'raw-spooler', 'raw-spooler.exe'),
              path.join(__dirname, 'raw-spooler', 'publish', 'raw-spooler.exe'),
              path.join(__dirname, 'raw-spooler', 'bin', 'Release', 'net6.0', 'win-x64', 'publish', 'raw-spooler.exe')
            ];
            const helperPath = helperCandidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false } });

            if (helperPath && process.platform === 'win32' && printerName && !effectiveDryRun) {
              // prepare binary payload using configured codepage
              let dataBuf;
              try {
                if (iconv && iconv.encode) dataBuf = iconv.encode(out + '\n\n', effectivePrinterCodepage);
                else dataBuf = Buffer.from(out + '\n\n', 'utf8');
              } catch (eEnc) {
                dataBuf = Buffer.from(out + '\n\n', 'utf8');
              }
              // append full cut
              const cutBuf = Buffer.from([0x1D, 0x56, 0x00]);

              // Construct ESC/POS size command that approximates PRINTER_SCALE for shim path as well
              let escSizeBufShim = null;
              try {
                const intScaleShim = Math.max(1, Math.min(8, Math.round(PRINTER_SCALE)));
                if (intScaleShim > 1) {
                  const nShim = ((intScaleShim - 1) & 0x0F) | (((intScaleShim - 1) & 0x0F) << 4);
                  escSizeBufShim = Buffer.from([0x1D, 0x21, nShim]);
                  logFile(`Shim2 prepared ESC/POS size header for scale ~${intScaleShim} (PRINTER_SCALE=${PRINTER_SCALE})`);
                }
              } catch (eSzShim) {
                logFile('Shim2 failed to prepare ESC/POS size header: ' + (eSzShim && eSzShim.message));
                escSizeBufShim = null;
              }

              // Try to include raster if available
              let rasterBufShim = null;
              try {
                if (pngBufForRaw) {
                  rasterBufShim = await pngToEscposRaster(pngBufForRaw);
                  if (rasterBufShim) logFile(`Shim2: including ESC/POS raster in raw payload (size=${rasterBufShim.length})`);
                }
              } catch (eRShim) {
                logFile('Shim2 pngToEscposRaster failed: ' + (eRShim && eRShim.message));
                rasterBufShim = null;
              }

              const escResetShim = Buffer.from([0x1D, 0x21, 0x00]);
              let partsShim = [];
              if (escSizeBufShim) partsShim.push(escSizeBufShim);
              partsShim.push(dataBuf);
              if (rasterBufShim) partsShim.push(rasterBufShim);
              if (escSizeBufShim) partsShim.push(escResetShim);
              partsShim.push(cutBuf);
              const final = Buffer.concat(partsShim);
              try { fs.writeFileSync(fnameBin, final); } catch (e) { logFile(`Shim2 failed to write bin ${fnameBin}: ${e && e.message}`); }

              const spawnSync = require('child_process').spawnSync;
              const res = spawnSync(helperPath, [printerName, fnameBin], { timeout: SPAWN_TIMEOUT_MS, windowsHide: true });
              // Log detailed helper output for diagnostics
              try {
                if (res && res.stdout && res.stdout.length) logFile(`raw-spooler stdout: ${Buffer.from(res.stdout || '').toString()}`);
                if (res && res.stderr && res.stderr.length) logFile(`raw-spooler stderr: ${Buffer.from(res.stderr || '').toString()}`);
              } catch (eLog) { /* ignore logging errors */ }
              if (res && res.error) {
                logFile(`raw-spooler error: ${res.error && res.error.message}`);
                throw res.error;
              }
              if (!res || res.status !== 0) {
                const errMsg = (res && (res.stderr || Buffer.from('')) ? (res.stderr || Buffer.from('')).toString() : 'no stderr');
                logFile(`raw-spooler failed with status ${res && res.status}: ${errMsg}`);
                throw new Error(`raw-spooler failed: ${errMsg}`);
              }
              logFile(`Shim2 printed binary ${fnameBin} to printer '${printerName}' via raw-spooler helper (${helperPath})`);
              console.log('Shim2 printed to Windows printer (raw helper)', printerName);
              return true;
            }
          } catch (eHelper) {
            logFile(`raw-spooler attempt failed: ${eHelper && eHelper.message}`);
            console.warn('raw-spooler attempt failed:', eHelper && eHelper.message);
          }

          // fallback to PowerShell Out-Printer (text)
          if (process.platform === 'win32' && printerName && !effectiveDryRun) {
            try {
              const spawnSync = require('child_process').spawnSync;
              // If printerName is 'default' or empty, call Out-Printer without -Name to use the system default printer.
              const safePrinterName = (printerName || '').toString();
              const useDefaultPrinter = !safePrinterName || /^default$/i.test(safePrinterName);
              // Ensure PowerShell uses UTF8 for output and reading the file to avoid encoding issues with accented names/content.
              const safePath = fnameTxt.replace(/'/g, "''");
              const safeNameArg = useDefaultPrinter ? '' : ` -Name '${safePrinterName.replace(/'/g, "''")}'`;
              const psCmd = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content -Raw -Encoding UTF8 '${safePath}' | Out-Printer${safeNameArg}`;
              const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], { timeout: SPAWN_TIMEOUT_MS });
              try {
                if (res && res.stdout && res.stdout.length) logFile(`powershell stdout: ${Buffer.from(res.stdout || '').toString()}`);
                if (res && res.stderr && res.stderr.length) logFile(`powershell stderr: ${Buffer.from(res.stderr || '').toString()}`);
              } catch (eLog) { /* ignore logging errors */ }
              if (res && res.error) {
                logFile(`powershell spawn error: ${res.error && res.error.message}`);
                throw res.error;
              }
              if (!res || res.status !== 0) {
                const errMsg = (res && (res.stderr || Buffer.from('')) ? (res.stderr || Buffer.from('')).toString() : 'no stderr');
                logFile(`Out-Printer failed with status ${res && res.status}: ${errMsg}`);
                throw new Error(`Out-Printer failed: ${errMsg}`);
              }
              logFile(`Shim2 printed file ${fnameTxt} to printer '${printerName}' via PowerShell Out-Printer`);
              console.log('Shim2 printed to Windows printer', printerName);
              return true;
            } catch (ePs) {
              logFile(`Shim2 Windows Out-Printer attempt failed: ${ePs && ePs.message}`);
              console.warn('Shim2 Windows print attempt failed:', ePs && ePs.message);
              return false;
            }
          }

          logFile(`Shim2 wrote output to ${fnameTxt} (no printer action attempted)`);
          console.log('Shim2 output saved to', fnameTxt);
          return true;
        }
      }

      const shim = new ShimPrinter2();
      try {
        shim.alignCenter();
        shim.println('*** PEDIDO ***');
        shim.newLine();
        (order.items || []).forEach(it => shim.tableCustom([{ text: String(it.quantity || 1) }, { text: String(it.name || '') }, { text: String(it.price || 0) }]));
        shim.newLine();
        shim.alignLeft();
        shim.println(`Cliente: ${order.customerName || order.name || 'Cliente'}`);
        shim.println(`Endereço: ${order.address || order.addressString || '-'}`);
        shim.println(`Total: R$ ${(Number(order.total ?? order.amount ?? 0) || 0).toFixed(2)}`);

        // Payment methods
        shim.newLine();
        shim.println('FORMAS DE PAGAMENTO');
        if (Array.isArray(order.payments) && order.payments.length) {
          order.payments.forEach(p => {
            const label = p.method || p.type || p.name || p.paymentMethod || 'Pagamento';
            const val = Number(p.amount ?? p.value ?? 0) || 0;
            shim.println(`${String(label).toUpperCase()}   ${val.toFixed(2)}`);
          });
        } else if (order.paymentMethod || order.paymentType || order.payment) {
          const label = order.paymentMethod || order.paymentType || (typeof order.payment === 'string' ? order.payment : 'Pagamento');
          const val = Number(order.paymentAmount ?? order.paymentValue ?? order.paidAmount ?? (order.total || 0)) || (order.total || 0);
          shim.println(`${String(label).toUpperCase()}   ${val.toFixed(2)}`);
        }

        // QR handling for shim: prefer to print an ASCII QR (scannable) if we have
        // a textual QR payload (URL/text). If we only have a data:image PNG, try
        // to fall back to any textual field in the order (qrUrl/qr) to produce
        // an ASCII QR. Otherwise fall back to a small marker so receipts still
        // indicate a QR was present.
        const shimQr = (order.qr || order.qrUrl || order.qrDataUrl || order.qrImage || order.qrcode || order.qrData || null);
        if (shimQr) {
          shim.newLine();
          shim.alignCenter();
          try {
                // If we have a textual QR (not a data URL) prefer ASCII rendering
                let textual = (typeof shimQr === 'string' && !shimQr.startsWith('data:image')) ? shimQr : (
                  // attempt to locate textual source elsewhere on order
                  (order.payload && (order.payload.qrUrl || order.payload.qr)) || (order._normalized && (order._normalized.qrUrl || order._normalized.qr)) || null
                );

                // If only a PNG/data URL is present and decode libs are available, try to extract textual QR
                if (!textual && typeof shimQr === 'string' && shimQr.startsWith('data:image') && Jimp && jsQR) {
                  try {
                    const parts = shimQr.split(',');
                    const b64 = parts[1] || '';
                    const buf = Buffer.from(b64, 'base64');
                    const decoded = await decodePngQr(buf);
                    if (decoded) {
                      textual = decoded;
                      logFile('ShimPrinter2: decoded QR text from PNG for order ' + (order && order.id || 'noid'));
                    }
                  } catch (eDecShim) {
                    // ignore
                  }
                }

                if (textual && QRLib && typeof QRLib.toString === 'function') {
                  // Generate an ASCII QR suitable for terminal/thermal printing
                  const ascii = await QRLib.toString(String(textual), { type: 'terminal' });
                  if (ascii) {
                    shim.println(ascii);
                    logFile('ShimPrinter2: printed ASCII QR fallback for order ' + (order && order.id || 'noid'));
                  } else {
                    shim.println(String(textual).slice(0, 120));
                  }
                } else if (typeof shimQr === 'string' && shimQr.startsWith('data:image')) {
                  // No textual source available: include a visible marker and a short base64 snippet
                  shim.println('[QR IMAGE PROVIDED]');
                  try {
                    const b64 = shimQr.split(',')[1] || '';
                    shim.println('[QR B64 SNIPPET] ' + (b64.slice(0, 80)));
                  } catch (eInner) {
                    shim.println('[QR IMAGE - no textual fallback]');
                  }
            } else {
              shim.println(String(shimQr).slice(0, 120));
            }
          } catch (eShimQr) {
            shim.println('[QR PROCESSING FAILED]');
            logFile('ShimPrinter2 QR processing failed: ' + (eShimQr && eShimQr.message));
          }
        }

        shim.newLine();
        shim.alignCenter();
        shim.println('Obrigado!');
        shim.cut();
        const execRes = await shim.execute();
        logFile(`Shim2 execute result: ${execRes}`);
        return execRes;
      } catch (eShim2) {
        console.error('Shim2 failed', eShim2 && eShim2.message);
        logFile(`Shim2 failed: ${eShim2 && eShim2.message}`);
        throw eShim2;
      }
    }
  } catch (err) {
    console.error('Print failed', err && err.message ? err.message : err);
    logFile(`Print failed: ${err && err.message}`);
    // save payload for retry
    try {
      const ts = Date.now();
      const fname = path.join(__dirname, 'failed-print', `failed-${order && order.id || 'noid'}-${ts}.json`);
      fs.writeFileSync(fname, JSON.stringify({ order, err: String(err && err.message) }, null, 2));
      console.log('Saved failed print payload to', fname);
    } catch (e) {
      console.error('Failed saving failed payload', e);
    }
    throw err;
  }
}

module.exports = {
  printOrder,
  formatOrderText
};
