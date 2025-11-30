require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mkdirp = require('mkdirp');
// node-thermal-printer may require native bindings at load time. Defer requiring
// it until we actually need it to avoid noisy stack traces when optional native
// modules like `printer` are not installed on the host. We'll lazy-load below.
let ntp = null;
let ThermalPrinter = null;
let PrinterTypes = { EPSON: 'EPSON', STAR: 'STAR' };

const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(__dirname, 'logs'));
const PRINTER_INTERFACE = process.env.PRINTER_INTERFACE || 'printer:default';
const PRINTER_TYPE = (process.env.PRINTER_TYPE || 'EPSON').toUpperCase();
const DRY_RUN = (String(process.env.DRY_RUN || 'false').toLowerCase() === 'true');
// Character set hint for native printer bindings. Default to UTF-8.
const PRINTER_CHARSET = process.env.PRINTER_CHARSET || 'UTF-8';
// Desired scale factor for fonts (float). Note: ESC/POS supports integer multiples only; we will
// approximate by rounding and/or try high-level API calls that may accept fractional values.
// Default increased to 2.0 to make printed fonts larger. Override with env PRINTER_SCALE if needed.
const PRINTER_SCALE = Number(process.env.PRINTER_SCALE || 2.0);
// ensure env is set for downstream modules that may read it
if (!process.env.PRINTER_CHARSET) process.env.PRINTER_CHARSET = PRINTER_CHARSET;

// In-memory recent print tracker to avoid duplicate prints for same order id
// Store entries as objects { ts: number, inProgress: boolean }
const RECENT_PRINT_TTL_MS = Number(process.env.PRINT_DEDUPE_TTL_MS || 15000);
const recentPrints = new Map(); // orderId -> { ts, inProgress }
function isRecentlyPrinted(orderId) {
  if (!orderId) return false;
  try {
    const entry = recentPrints.get(orderId);
    if (!entry) return false;
    // If another process is already printing this order, consider it recent
    if (entry.inProgress) return true;
    if ((Date.now() - (entry.ts || 0)) <= RECENT_PRINT_TTL_MS) return true;
    recentPrints.delete(orderId);
    return false;
  } catch (e) { return false; }
}
function markPrintingStart(orderId) {
  if (!orderId) return;
  try {
    recentPrints.set(orderId, { ts: Date.now(), inProgress: true });
    // schedule cleanup in case something goes wrong
    setTimeout(() => { try { recentPrints.delete(orderId); } catch (e) {} }, RECENT_PRINT_TTL_MS + 5000);
  } catch (e) {}
}
function markPrinted(orderId) {
  if (!orderId) return;
  try {
    recentPrints.set(orderId, { ts: Date.now(), inProgress: false });
    // schedule cleanup
    setTimeout(() => { try { recentPrints.delete(orderId); } catch (e) {} }, RECENT_PRINT_TTL_MS + 5000);
  } catch (e) {}
}
function clearRecentPrint(orderId) {
  if (!orderId) return;
  try { recentPrints.delete(orderId); } catch (e) {}
}

// iconv-lite for charset conversions (used for ESC/POS CP1252 output)
let iconv = null;
try { iconv = require('iconv-lite'); } catch (e) { iconv = null }
// Codepage used when encoding ESC/POS payloads for raw spooler.
// Default to UTF-8 to correctly render accented characters and other Unicode.
const PRINTER_CODEPAGE = process.env.PRINTER_CODEPAGE || 'utf8';

// optional QR code rendering (PNG/ASCII) for delivery receipts
let QRLib = null;
try { QRLib = require('qrcode'); } catch (e) { QRLib = null }

// optional PNG decode helpers (to extract textual QR from PNG images)
let PNG = null;
let jsQR = null;
try { PNG = require('pngjs').PNG; } catch (e) { PNG = null }
try { jsQR = require('jsqr'); } catch (e) { jsQR = null }

async function decodePngQr(pngBuf) {
  if (!pngBuf || !PNG || !jsQR) return null;
  try {
    let img;
    // pngjs provides a sync.read helper in some versions
    if (PNG && PNG.sync && typeof PNG.sync.read === 'function') {
      img = PNG.sync.read(pngBuf);
    } else {
      img = await new Promise((resolve, reject) => {
        try {
          const p = new PNG();
          p.parse(pngBuf, (err, data) => err ? reject(err) : resolve(data));
        } catch (e) { reject(e); }
      });
    }
    const { data, width, height } = img;
    const arr = new Uint8ClampedArray(data);
    const code = jsQR(arr, width, height);
    if (code && code.data) return code.data;
    return null;
  } catch (e) {
    return null;
  }
}

// Convert PNG buffer to ESC/POS raster command (GS v 0) using pngjs to get raw pixels
async function pngToEscposRaster(pngBuf, threshold = 127) {
  if (!pngBuf || !PNG) return null;
  try {
    let img;
    if (PNG && PNG.sync && typeof PNG.sync.read === 'function') {
      img = PNG.sync.read(pngBuf);
    } else {
      img = await new Promise((resolve, reject) => {
        try {
          const p = new PNG();
          p.parse(pngBuf, (err, data) => err ? reject(err) : resolve(data));
        } catch (e) { reject(e); }
      });
    }
    const data = img.data;
    const width = img.width; const height = img.height;
    // detect channels from data length
    const channels = Math.max(1, Math.round((data && data.length) / (width * height))) || 4;
    const bytesPerRow = Math.ceil(width / 8);

    // Packing and inversion can be controlled via environment variables to match printer expectations
    // PRINTER_RASTER_PACKING: 'msb' (default) or 'lsb'
    // PRINTER_RASTER_INVERT: 'true' or 'false' (default false)
    const packingEnv = String(process.env.PRINTER_RASTER_PACKING || 'msb').toLowerCase();
    const lsbFirst = packingEnv === 'lsb';
    const invertEnv = String(process.env.PRINTER_RASTER_INVERT || 'false').toLowerCase();
    const invert = invertEnv === 'true';

    let nonZero = 0;
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
            const a = (channels >= 4) ? (data[idx + 3] || 255) : 255;
            // composite onto white background if alpha < 255
            const alpha = a / 255;
            const rr = Math.round((r * alpha) + (255 * (1 - alpha)));
            const gg = Math.round((g * alpha) + (255 * (1 - alpha)));
            const bb = Math.round((b * alpha) + (255 * (1 - alpha)));
            const lum = (0.299 * rr + 0.587 * gg + 0.114 * bb);
            if (!invert) {
              if (lum < threshold) black = true;
            } else {
              if (lum >= threshold) black = true;
            }
          }
          if (black) {
            if (lsbFirst) byte |= (0x01 << bit);
            else byte |= (0x80 >> bit);
          }
        }
        raster[offset++] = byte;
        if (byte !== 0) nonZero++;
      }
    }

    const xL = bytesPerRow & 0xFF;
    const xH = (bytesPerRow >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;
    const header = Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
    return Buffer.concat([header, raster]);
  } catch (e) {
    logFile('pngToEscposRaster failed: ' + (e && e.message));
    return null;
  }
}

// Diagnostic: produce alternative raster variants (different bit packing/order and explicit inversion)
// Returns an array of { name: string, buf: Buffer }
async function pngToEscposRasterVariants(pngBuf, threshold = 127) {
  if (!pngBuf || !PNG) return [];
  try {
    let img;
    if (PNG && PNG.sync && typeof PNG.sync.read === 'function') {
      img = PNG.sync.read(pngBuf);
    } else {
      img = await new Promise((resolve, reject) => {
        try {
          const p = new PNG();
          p.parse(pngBuf, (err, data) => err ? reject(err) : resolve(data));
        } catch (e) { reject(e); }
      });
    }
    const data = img.data;
    const width = img.width; const height = img.height;
    const channels = Math.max(1, Math.round((data && data.length) / (width * height))) || 4;
    const bytesPerRow = Math.ceil(width / 8);

    const buildRasterBuffers = (invert, lsbFirst) => {
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
              const a = (channels >= 4) ? (data[idx + 3] || 255) : 255;
              const alpha = a / 255;
              const rr = Math.round((r * alpha) + (255 * (1 - alpha)));
              const gg = Math.round((g * alpha) + (255 * (1 - alpha)));
              const bb = Math.round((b * alpha) + (255 * (1 - alpha)));
              const lum = (0.299 * rr + 0.587 * gg + 0.114 * bb);
              if (!invert) {
                if (lum < threshold) black = true;
              } else {
                if (lum >= threshold) black = true;
              }
            }
            if (black) {
              if (lsbFirst) byte |= (0x01 << bit);
              else byte |= (0x80 >> bit);
            }
          }
          raster[offset++] = byte;
        }
      }
      const xL = bytesPerRow & 0xFF;
      const xH = (bytesPerRow >> 8) & 0xFF;
      const yL = height & 0xFF;
      const yH = (height >> 8) & 0xFF;
      const header = Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
      return Buffer.concat([header, raster]);
    };

    const variants = [];
    // standard MSB, normal
    try { variants.push({ name: 'msb-normal', buf: buildRasterBuffers(false, false) }); } catch (e) {}
    // standard MSB, inverted
    try { variants.push({ name: 'msb-inverted', buf: buildRasterBuffers(true, false) }); } catch (e) {}
    // LSB packing, normal
    try { variants.push({ name: 'lsb-normal', buf: buildRasterBuffers(false, true) }); } catch (e) {}
    // LSB packing, inverted
    try { variants.push({ name: 'lsb-inverted', buf: buildRasterBuffers(true, true) }); } catch (e) {}

    return variants;
  } catch (e) {
    logFile('pngToEscposRasterVariants failed: ' + (e && e.message));
    return [];
  }
}

// Render plain text into a PNG via SVG (monospace) and return PNG buffer.
// Note: server-side rasterization is preferred. Agent no longer performs
// local text->PNG rasterization using sharp. If needed, the agent can call
// the backend `/rasterize` endpoint (controlled by env USE_SERVER_RASTER).

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

  // determine paper width (chars) preference: opts.paperWidth or env PRINTER_WIDTH or default 48
  // NOTE: keep this default consistent with the ThermalPrinter init below which also defaults to 48
  const pw = Number(opts.paperWidth || process.env.PRINTER_WIDTH || 48);
  const nameCol = (pw === 58) ? 16 : 25;
  const includeDesc = !!(opts && opts.includeItemDescription);

  const lines = [];
  lines.push('*** PEDIDO ***');
  lines.push(`Pedido: ${display}    Data: ${String(date).split('T')[0]}`);
  lines.push('');
  lines.push((order.customerName || order.name || 'NOME DO CLIENTE').toUpperCase());
  lines.push('----------------------------');
  const address = order.addressFull || order.address || order.addressString || [order.street, order.number].filter(Boolean).join(' ') || '-';
  lines.push(address);
  lines.push('----------------------------');
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
  lines.push('----------------------------');

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

  // QR image will be printed separately by the agent (as an image/raster).
  // Do not include the QR URL or placeholder tags in the textual receipt to keep
  // the printed receipt focused on order information only.
  if (order.ifoodId || order.ifood_order_id || order.externalOrderId) lines.push(`NUMERO DO PEDIDO NO IFOOD: ${order.ifoodId || order.ifood_order_id || order.externalOrderId}`);
  if (order.channel || order.source || order.salesChannel) lines.push(`CANAL DE VENDA: ${order.channel || order.source || order.salesChannel}`);

  // Optionally include a curated summary of order fields (sanitized) on the ticket.
  // Enable via `opts.includeFullOrder = true` or env `PRINT_INCLUDE_FULL_ORDER=true`.
  // This prints a compact, human-friendly block instead of the entire JSON
  // (avoids huge base64 blobs and long stacks). You can control how many
  // items are shown via `PRINT_FULL_ITEMS_LIMIT` (default 10) and how long
  // strings may be via `PRINT_FULL_MAX_STRING` (default 200).
  const includeFull = !!(opts && opts.includeFullOrder) || String(process.env.PRINT_INCLUDE_FULL_ORDER || '').toLowerCase() === 'true';
  if (includeFull) {
    const maxStringLen = Number(process.env.PRINT_FULL_MAX_STRING || 200);
    const maxItems = Number(process.env.PRINT_FULL_ITEMS_LIMIT || 10);

    function cleanString(s) {
      if (s == null) return '';
      try { s = String(s); } catch (e) { s = '' }
      if (/^data:/i.test(s)) return `<omitted data URL length=${s.length}>`;
      if (s.length > maxStringLen) return s.slice(0, maxStringLen) + `...<omitted ${s.length - maxStringLen} chars>`;
      return s;
    }

    // Build a selected view of the order with common useful fields
    const sel = {};
    sel.id = order.id || null;
    sel.displayId = order.displayId || order.display || null;
    sel.date = order.createdAt || order.date || order.created || null;
    sel.storeId = order.storeId || null;
    sel.customer = {
      name: cleanString(order.customerName || order.name || order.clientName || ''),
      phone: cleanString(order.customerPhone || order.phone || (Array.isArray(order.phones) ? order.phones.join(' / ') : ''))
    };
    sel.address = cleanString(order.addressFull || order.address || order.addressString || [order.street, order.number].filter(Boolean).join(' ') || '');
    sel.total = Number(order.total ?? order.amount ?? order.orderAmount ?? 0) || 0;
    sel.payments = (Array.isArray(order.payments) ? order.payments : (order.payload && Array.isArray(order.payload.payments) ? order.payload.payments : [])).slice(0,5).map(p => ({ method: cleanString(p.method || p.type || p.name || p.paymentMethod || ''), amount: Number(p.amount ?? p.value ?? p.paymentAmount ?? 0) || 0 }));

    // Items summary: show up to maxItems with qty/name/price
    sel.items = [];
    if (Array.isArray(order.items) && order.items.length) {
      for (let i = 0; i < Math.min(order.items.length, maxItems); i++) {
        const it = order.items[i];
        sel.items.push({ qty: Number(it.quantity ?? it.qty ?? 1) || 1, name: cleanString(it.name || it.title || it.productName || ''), price: Number(it.price ?? it.unitPrice ?? it.amount ?? 0) || 0 });
      }
      if (order.items.length > maxItems) sel.items.push({ more: order.items.length - maxItems });
    }

    // Short extras
    sel.ifood = cleanString(order.ifoodId || order.ifood_order_id || order.externalOrderId || '');
    sel.channel = cleanString(order.channel || order.source || order.salesChannel || '');

    // Format the selected block into lines
    try {
      lines.push('');
      lines.push('--- RESUMO IMPRESSO DO PEDIDO ---');
      if (sel.id) lines.push(`ID: ${sel.id}`);
      if (sel.displayId) lines.push(`Pedido: ${sel.displayId}`);
      if (sel.date) lines.push(`Data: ${String(sel.date).split('T')[0]}`);
      if (sel.customer && (sel.customer.name || sel.customer.phone)) lines.push(`Cliente: ${sel.customer.name} ${sel.customer.phone ? ' / ' + sel.customer.phone : ''}`);
      if (sel.address) lines.push(`Endereço: ${sel.address}`);
      lines.push(`Total: R$ ${sel.total.toFixed(2)}`);
      if (Array.isArray(sel.payments) && sel.payments.length) {
        lines.push('Pagamentos:');
        sel.payments.forEach(p => lines.push(` - ${p.method || 'Pagamento'}: R$ ${Number(p.amount || 0).toFixed(2)}`));
      }
      if (Array.isArray(sel.items) && sel.items.length) {
        lines.push('Itens:');
        sel.items.forEach(it => {
          if (it.more) lines.push(` - ...mais ${it.more} itens`);
          else lines.push(` - ${it.qty} x ${it.name} @ R$ ${Number(it.price || 0).toFixed(2)}`);
        });
      }
      if (sel.ifood) lines.push(`iFood: ${sel.ifood}`);
      if (sel.channel) lines.push(`Canal: ${sel.channel}`);
      lines.push('--- FIM RESUMO ---');
    } catch (eSel) {
      lines.push('--- RESUMO INDISPONIVEL ---');
    }
  }

  return lines.join('\n');
}

async function printOrder(order, opts = {}) {
  const text = formatOrderText(order, opts);
  logFile(`Printing order ${order && order.id || 'null'} - length ${text.length}`);

  // Deduplicate: if this order was printed recently, skip to avoid double prints
  try {
    if (order && order.id && isRecentlyPrinted(order.id)) {
      logFile(`Skipping print for order ${order.id} because it was printed recently`);
      console.log('Skipping recently printed order', order.id);
      return false;
    }
  } catch (eSkip) { /* ignore dedupe errors and continue printing */ }

  // mark printing start to avoid concurrent duplicate prints
  try { if (order && order.id) markPrintingStart(order.id); } catch (eMarkStart) { /* ignore */ }

  // prepare PNG buffer (if any) early so raw-spooler path can include raster image
  let pngBufForRaw = null;
  try {
    // prefer an explicit raster provided on the order (server-side rasterization)
    const rasterCandidate = order.rasterDataUrl || order.rasterPng || null;
    if (rasterCandidate && typeof rasterCandidate === 'string') {
      if (rasterCandidate.startsWith('data:image')) {
        try { pngBufForRaw = Buffer.from((rasterCandidate.split(',')[1] || ''), 'base64'); } catch (e) { pngBufForRaw = null; }
      } else {
        try { pngBufForRaw = Buffer.from(rasterCandidate, 'base64'); } catch (e) { pngBufForRaw = null; }
      }
    }

    // fallback: QR image candidate (from frontend)
    if (!pngBufForRaw) {
      const qrCandidate = (
        order.qrDataUrl || order.qrImage || order.qr || order.qrUrl || order.qrcode || order.qrData ||
        (order.payload && (order.payload.qrDataUrl || order.payload.qrUrl || order.payload.qr)) ||
        null
      );
      if (qrCandidate) {
        if (typeof qrCandidate === 'string' && qrCandidate.startsWith('data:image')) {
          try { pngBufForRaw = Buffer.from((qrCandidate.split(',')[1] || ''), 'base64'); } catch (e) { pngBufForRaw = null; }
        } else if (QRLib) {
          try { pngBufForRaw = await QRLib.toBuffer(String(qrCandidate), { type: 'png', width: 220 }); } catch (e) { pngBufForRaw = null; }
        }
      }
    }

    // optional: request server-side raster if env requests it and we still have no raster
    if (!pngBufForRaw && String(process.env.USE_SERVER_RASTER || '').toLowerCase() === 'true') {
      try {
        const backend = process.env.BACKEND_RASTER_URL || process.env.BACKEND_URL || 'http://localhost:3000';
        const url = (backend.replace(/\/$/, '')) + '/rasterize';
        const widthPx = Number(process.env.PRINTER_RASTER_WIDTH || 576);
        const body = JSON.stringify({ text, scale: PRINTER_SCALE || 1.0, widthPx });
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (resp && resp.ok) {
          const json = await resp.json().catch(() => null);
          if (json && json.dataUrl && typeof json.dataUrl === 'string' && json.dataUrl.startsWith('data:image')) {
            pngBufForRaw = Buffer.from(json.dataUrl.split(',')[1] || '', 'base64');
            logFile('Fetched server-side raster from ' + url);
          }
        }
      } catch (eFetch) {
        logFile('Server raster fetch failed: ' + (eFetch && eFetch.message));
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

    // Resolve type safely and attempt to lazy-load `node-thermal-printer`.
    let resolvedType = null;
    let printer = null;
    let printerApiType = null;
    try {
      // Lazy-require node-thermal-printer to avoid module-load-time crashes when
      // optional native dependencies are missing (for example the `printer` module).
      if (!ntp) {
        try {
          ntp = require('node-thermal-printer');
          ThermalPrinter = ntp.printer || ntp.ThermalPrinter || ntp.Printer || ntp;
          PrinterTypes = ntp.types || ntp.PrinterTypes || ntp.Types || PrinterTypes;
        } catch (eNt) {
          // Do not rethrow — we'll fall back to helper paths. Log concisely.
          logFile('node-thermal-printer not available: ' + (eNt && eNt.message));
          // Keep ThermalPrinter null so the logic falls back to raw-spooler/shim.
        }
      }

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
      const rawInterface = (String(effectivePrinterInterface || '') || '');
      // normalize and strip common prefixes like 'printer:'
      let printerName = rawInterface.replace(/^\s*printer:\s*/i, '').trim();
      // remember whether the original value appeared to be a "type" (EPSON/STAR)
      const initialLooksLikeType = !!printerName && (printerName.toUpperCase() === String(effectivePrinterType || '').toUpperCase() || (PrinterTypes && Object.values(PrinterTypes).map(v => String(v).toUpperCase()).includes(printerName.toUpperCase())));
      let resolvedFromType = false;

      // If the configured interface looks like a printer TYPE (e.g. "EPSON") rather
      // than a system printer name, try to discover a real printer name via the
      // local HTTP helper (`printer-http.cjs`) which exposes GET /printers.
      try {
        if (initialLooksLikeType) {
          try {
            const pUrl = `http://localhost:${process.env.PRINTER_HTTP_PORT || 4000}/printers`;
            logFile('Attempting local printer discovery at ' + pUrl + ' (interface looked like type: ' + printerName + ')');
            const resp = await fetch(pUrl, { method: 'GET' });
            if (resp && resp.ok) {
              const list = await resp.json().catch(() => []);
              if (Array.isArray(list) && list.length) {
                // try to find a printer whose name or driver mentions the type
                const wanted = printerName.toLowerCase();
                let match = list.find(p => p && p.name && String(p.name).toLowerCase().includes(wanted));
                if (!match) match = list.find(p => p && ((p.driver && String(p.driver).toLowerCase().includes(wanted)) || (p.port && String(p.port).toLowerCase().includes(wanted))));
                if (!match) match = list.find(p => p && p.default) || list[0];
                if (match && match.name) {
                  const resolvedName = String(match.name).replace(/^\s*printer:\s*/i, '').trim();
                  logFile('Resolved printer name from local discovery: ' + resolvedName + ' (was type: ' + printerName + ')');
                  printerName = resolvedName;
                  resolvedFromType = true;
                }
              } else {
                logFile('Local printer discovery returned empty list');
              }
            } else {
              logFile('Local printer discovery request failed or returned non-OK');
            }
          } catch (eDisc) {
            logFile('Local printer discovery failed: ' + (eDisc && eDisc.message));
          }
        }
      } catch (eResolve) {
        logFile('Printer name resolution error: ' + (eResolve && eResolve.message));
      }
      const helperCandidates = [
        path.join(__dirname, 'raw-spooler', 'raw-spooler.exe'),
        path.join(__dirname, 'raw-spooler', 'publish', 'raw-spooler.exe'),
        path.join(__dirname, 'raw-spooler', 'bin', 'Release', 'net6.0', 'win-x64', 'publish', 'raw-spooler.exe')
      ];
      const helperPath = helperCandidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false } });

      // If configured interface looked like a generic TYPE (eg. 'EPSON') but
      // discovery did not resolve to a concrete system printer name, skip
      // raw-spooler because it will call OpenPrinter with the type string and fail.
      if (helperPath && process.platform === 'win32' && printerName && !effectiveDryRun && !(initialLooksLikeType && !resolvedFromType)) {
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

        // Prefer HTML->PDF printing via system print (Windows) when HTML is available.
        // Attempt to render HTML->PDF (Puppeteer) and print via PowerShell PrintTo.
        // If the system-print attempt fails, fall back to HTML->PNG -> ESC/POS raster.
        const htmlCandidate = order.rasterHtml || order.html || order.previewHtml || order.htmlString || null;
        if (htmlCandidate && !pngBufForRaw) {
          // Try system PDF print on Windows first
          if (process.platform === 'win32') {
            try {
              let pdfBuf = null;
              try {
                const puppeteer = require('puppeteer');
                const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                  const page = await browser.newPage();
                  await page.setContent(String(htmlCandidate), { waitUntil: 'networkidle0' });
                  const pdfOptions = { printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } };
                  pdfBuf = await page.pdf(pdfOptions);
                } finally {
                  try { await browser.close(); } catch (e) {}
                }
              } catch (ePuppPdf) {
                logFile('puppeteer PDF render failed: ' + (ePuppPdf && ePuppPdf.message));
                pdfBuf = null;
              }

              if (pdfBuf && pdfBuf.length) {
                try {
                  const tsPdf = Date.now();
                  const fnamePdf = path.join(__dirname, 'failed-print', `helper-pdf-${tsPdf}.pdf`);
                  try { fs.writeFileSync(fnamePdf, pdfBuf); } catch (e) { /* ignore */ }
                  // Attempt to print PDF using PowerShell Start-Process -Verb PrintTo
                  try {
                    const resolvedPrinter = String(printerName || '').replace(/^\s*printer:\s*/i, '').trim();
                    const safePrinter = String(resolvedPrinter || '').replace(/'/g, "''");
                    const psCmd = resolvedPrinter ? `Start-Process -FilePath '${fnamePdf.replace(/'/g, "''")}' -Verb PrintTo -ArgumentList '${safePrinter}' -Wait` : `Start-Process -FilePath '${fnamePdf.replace(/'/g, "''")}' -Verb Print -Wait`;
                    const spawnSync = require('child_process').spawnSync;
                    const resPdfPrint = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { timeout: SPAWN_TIMEOUT_MS });
                    try {
                      if (resPdfPrint && resPdfPrint.stdout && resPdfPrint.stdout.length) logFile(`powershell stdout: ${Buffer.from(resPdfPrint.stdout || '').toString()}`);
                      if (resPdfPrint && resPdfPrint.stderr && resPdfPrint.stderr.length) logFile(`powershell stderr: ${Buffer.from(resPdfPrint.stderr || '').toString()}`);
                    } catch (eLogPdfPrint) { /* ignore */ }
                    if (!resPdfPrint || resPdfPrint.status !== 0) {
                      logFile(`PowerShell PrintTo returned status ${resPdfPrint && resPdfPrint.status}`);
                      // fallthrough to PNG->raster below
                    } else {
                      logFile(`Printed PDF via PowerShell PrintTo to printer '${printerName}'`);
                      console.log('Printed PDF via PowerShell PrintTo', printerName);
                      try { markPrinted(order && order.id); } catch (eMark) {}
                      return true;
                    }
                  } catch (ePs) {
                    logFile('PowerShell PrintTo attempt failed: ' + (ePs && ePs.message));
                    // fallthrough
                  }
                } catch (ePdfSend) {
                  logFile('PDF write/send failed: ' + (ePdfSend && ePdfSend.message));
                }
              }
            } catch (eHtmlSys) {
              logFile('HTML->PDF system print attempt failed: ' + (eHtmlSys && eHtmlSys.message));
            }
          }
          try {
            let pngBufFromHtml = null;
            try {
              const puppeteer = require('puppeteer');
              const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
              try {
                const page = await browser.newPage();
                // set a neutral viewport; allow env to override
                const vw = Number(process.env.PRINTER_PUPPETEER_VIEWPORT_WIDTH || 576) || 576;
                const vh = Number(process.env.PRINTER_PUPPETEER_VIEWPORT_HEIGHT || 800) || 800;
                await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
                await page.setContent(String(htmlCandidate), { waitUntil: 'networkidle0' });
                // screenshot options: clip or fullPage depending on content height
                const shotOpts = { fullPage: false, omitBackground: false, captureBeyondViewport: false, encoding: 'binary' };
                // allow optional width/height control
                if (process.env.PRINTER_PUPPETEER_DPR) shotOpts.deviceScaleFactor = Number(process.env.PRINTER_PUPPETEER_DPR) || 1;
                pngBufFromHtml = await page.screenshot(shotOpts);
              } finally {
                try { await browser.close(); } catch (e) {}
              }
            } catch (ePupp) {
              logFile('puppeteer HTML->PNG render failed: ' + (ePupp && ePupp.message));
              pngBufFromHtml = null;
            }
            if (pngBufFromHtml && pngBufFromHtml.length) {
              // prefer this PNG for subsequent raster conversion
              pngBufForRaw = pngBufFromHtml;
              try {
                const saved = path.join(__dirname, 'failed-print', `helper-png-${Date.now()}.png`);
                fs.writeFileSync(saved, pngBufFromHtml);
              } catch (eSave) { /* ignore */ }
            }
          } catch (eHtmlRender) {
            logFile('HTML->PNG attempt error: ' + (eHtmlRender && eHtmlRender.message));
          }
        }
        // If we have a PNG buffer prepared earlier, we'll include its ESC/POS
        // raster in the final payload (text + raster). Do not perform a
        // raster-only immediate send here to avoid printing only the image
        // and omitting the textual order data; raster conversion happens later
        // and will be attached to the final binary sent by raw-spooler.
        if (pngBufForRaw) {
          logFile('PNG candidate available for raster inclusion; will attach to final payload (text + raster)');
        }

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
        // Debug: log buffer sizes so we can verify text+raster were concatenated
        try {
          const textBytes = (dataBuf && dataBuf.length) || 0;
          const rasterBytes = (rasterBuf && rasterBuf.length) || 0;
          logFile(`DEBUG payload sizes: textBytes=${textBytes} rasterBytes=${rasterBytes} finalBytes=${final.length}`);
          console.log(`DEBUG payload sizes: textBytes=${textBytes} rasterBytes=${rasterBytes} finalBytes=${final.length}`);
        } catch (eDbg) { /* ignore debug logging errors */ }
        const ts = Date.now();
        const fnameBin = path.join(__dirname, 'failed-print', `helper-${ts}.bin`);
        try { fs.writeFileSync(fnameBin, final); } catch (e) { logFile(`Failed to write helper bin ${fnameBin}: ${e && e.message}`); }

        // Before doing a single raw-spooler call, try multiple codepages
        // (UTF-8 -> CP1252 -> CP850) and log which worked. This probes the
        // helper so we can find an encoding that the driver accepts.
        const helperPrinterArg = String(printerName || '').replace(/^\s*printer:\s*/i, '').trim();
        if (!helperPrinterArg) {
          logFile('Resolved printer name is empty after stripping prefix; skipping raw-spooler helper');
        } else {
          try {
            const sent = await trySendViaCodepages(helperPath, helperPrinterArg, text, escSizeBuf, rasterBuf, escReset, cutBuf, order && order.id, printerName);
            if (sent) {
              try { markPrinted(order && order.id); } catch (eMark) {}
              return true;
            }
            // If probe failed, fall through to the legacy single-attempt path below
            logFile('CODEPAGE-TEST: probe did not find a working codepage; falling back to single-attempt raw-spooler call');
          } catch (eProbe) {
            logFile('CODEPAGE-TEST probe error: ' + (eProbe && eProbe.message));
          }
        }
        const spawnSync = require('child_process').spawnSync;
        // Strip any `printer:` prefix the discovery helper may return and
        // avoid passing type-like or prefixed names to native helpers.
        // (helperPrinterArg already defined above)
        if (!helperPrinterArg) {
          // nothing to do
        } else {
          const res = spawnSync(helperPath, [helperPrinterArg, fnameBin], { timeout: SPAWN_TIMEOUT_MS, windowsHide: true });
          try {
            if (res && res.stdout && res.stdout.length) logFile(`raw-spooler stdout: ${Buffer.from(res.stdout || '').toString()}`);
            if (res && res.stderr && res.stderr.length) logFile(`raw-spooler stderr: ${Buffer.from(res.stderr || '').toString()}`);
          } catch (eLog) { /* ignore */ }
          if (res && res.error) {
            logFile(`raw-spooler error: ${res.error && res.error.message}`);
            console.error('raw-spooler error', res.error && res.error.message);
            // fallthrough to native path
          } else if (res && res.status === 0) {
            logFile(`Printed via raw-spooler helper (${helperPath}) to printer '${helperPrinterArg}'`);
            console.log('Printed via raw-spooler helper', helperPrinterArg);
            try { markPrinted(order && order.id); } catch (eMark) {}
            return true;
          } else {
            logFile(`raw-spooler returned status ${res && res.status}`);
            console.warn('raw-spooler returned status', res && res.status);
            // If we initially used a printer TYPE name (e.g. 'EPSON'), try discovery+retry once
            if (initialLooksLikeType) {
              try {
                const pUrl = `http://localhost:${process.env.PRINTER_HTTP_PORT || 4000}/printers`;
                const resp3 = await fetch(pUrl, { method: 'GET' });
                if (resp3 && resp3.ok) {
                  const list3 = await resp3.json().catch(() => []);
                  if (Array.isArray(list3) && list3.length) {
                    const wanted = String(rawInterface || '').replace(/^\s*printer:\s*/i, '').toLowerCase();
                    let match3 = list3.find(p => p && p.name && String(p.name).toLowerCase().includes(wanted));
                    if (!match3) match3 = list3.find(p => p && ((p.driver && String(p.driver).toLowerCase().includes(wanted)) || (p.port && String(p.port).toLowerCase().includes(wanted))));
                    if (!match3) match3 = list3.find(p => p && p.default) || list3[0];
                    if (match3 && match3.name) {
                      const resolvedName2 = String(match3.name).replace(/^\s*printer:\s*/i, '').trim();
                      logFile('Retry: resolved printer name from discovery after raw-spooler failure: ' + resolvedName2 + ' (was: ' + printerName + ')');
                      printerName = resolvedName2;
                      const helperPrinterArg2 = String(printerName || '').replace(/^\s*printer:\s*/i, '').trim();
                      if (helperPrinterArg2) {
                        const res2 = spawnSync(helperPath, [helperPrinterArg2, fnameBin], { timeout: SPAWN_TIMEOUT_MS, windowsHide: true });
                        try { if (res2 && res2.stdout && res2.stdout.length) logFile(`raw-spooler retry stdout: ${Buffer.from(res2.stdout || '').toString()}`); } catch (e) {}
                        try { if (res2 && res2.stderr && res2.stderr.length) logFile(`raw-spooler retry stderr: ${Buffer.from(res2.stderr || '').toString()}`); } catch (e) {}
                        if (res2 && !res2.error && res2.status === 0) {
                          logFile(`Printed via raw-spooler helper (retry) to printer '${helperPrinterArg2}'`);
                          console.log('Printed via raw-spooler helper (retry)', helperPrinterArg2);
                          try { markPrinted(order && order.id); } catch (eMark) {}
                          return true;
                        }
                      }
                    }
                  }
                }
              } catch (eRetryAll) {
                logFile('Retry discovery after raw-spooler failure failed: ' + (eRetryAll && eRetryAll.message));
              }
            }
            // fallthrough
          }
        }
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
          try { markPrinted(order && order.id); } catch (eMark) {}
          return true;
        } else {
          logFile(`raw-spooler returned status ${res && res.status}`);
          console.warn('raw-spooler returned status', res && res.status);
          // If we initially used a printer TYPE name (e.g. 'EPSON'), try discovery+retry once
          if (initialLooksLikeType) {
            try {
              const pUrl = `http://localhost:${process.env.PRINTER_HTTP_PORT || 4000}/printers`;
              const resp3 = await fetch(pUrl, { method: 'GET' });
              if (resp3 && resp3.ok) {
                const list3 = await resp3.json().catch(() => []);
                if (Array.isArray(list3) && list3.length) {
                  const wanted = String(rawInterface || '').replace(/^\s*printer:\s*/i, '').toLowerCase();
                  let match3 = list3.find(p => p && p.name && String(p.name).toLowerCase().includes(wanted));
                  if (!match3) match3 = list3.find(p => p && ((p.driver && String(p.driver).toLowerCase().includes(wanted)) || (p.port && String(p.port).toLowerCase().includes(wanted))));
                  if (!match3) match3 = list3.find(p => p && p.default) || list3[0];
                  if (match3 && match3.name && match3.name !== printerName) {
                    const resolvedName2 = String(match3.name).replace(/^\s*printer:\s*/i, '').trim();
                    logFile('Retry: resolved printer name from discovery after raw-spooler failure: ' + resolvedName2 + ' (was: ' + printerName + ')');
                    printerName = resolvedName2;
                    const helperPrinterArg2 = String(printerName || '').replace(/^\s*printer:\s*/i, '').trim();
                    if (helperPrinterArg2) {
                      const res2 = spawnSync(helperPath, [helperPrinterArg2, fnameBin], { timeout: SPAWN_TIMEOUT_MS, windowsHide: true });
                      try { if (res2 && res2.stdout && res2.stdout.length) logFile(`raw-spooler retry stdout: ${Buffer.from(res2.stdout || '').toString()}`); } catch (e) {}
                      try { if (res2 && res2.stderr && res2.stderr.length) logFile(`raw-spooler retry stderr: ${Buffer.from(res2.stderr || '').toString()}`); } catch (e) {}
                    } else {
                      logFile('raw-spooler retry: resolved printer name empty after stripping; skipping retry');
                    }
                    if (res2 && !res2.error && res2.status === 0) {
                      logFile(`Printed via raw-spooler helper (retry) to printer '${printerName}'`);
                      console.log('Printed via raw-spooler helper (retry)', printerName);
                      try { markPrinted(order && order.id); } catch (eMark) {}
                      return true;
                    }
                  }
                }
              }
            } catch (eRetryAll) {
              logFile('Retry discovery after raw-spooler failure failed: ' + (eRetryAll && eRetryAll.message));
            }
          }
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
                  // Last resort: if we only had a data URL and couldn't decode, DO NOT print raw data URLs
                  // (they are long noisy base64 strings). Only print if qrData is textual (not a data URL).
                  if (typeof qrData === 'string' && qrData.startsWith('data:image')) {
                    // skip printing raw data URL
                  } else {
                    if (typeof printer.println === 'function') printer.println(String(qrData));
                  }
                }
              } catch (eAscii) {
                console.warn('ASCII fallback failed, printing QR text', eAscii && eAscii.message);
                if (!(typeof qrData === 'string' && qrData.startsWith('data:image'))) {
                  if (typeof printer.println === 'function') printer.println(String(qrData));
                }
              }
            }
          } else {
            // QRLib not available: avoid printing raw data:image URLs
            if (!(typeof qrData === 'string' && qrData.startsWith('data:image'))) {
              if (typeof printer.println === 'function') printer.println(String(qrData));
            }
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
      try { if (execute) try { markPrinted(order && order.id); } catch (eMark) {} } catch (e) {}

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

              // If the configured interface is a type (e.g. 'EPSON'), try discovery
              // and avoid calling raw-spooler with a type name which will fail.
              let skipRawHelperShim = false;
              try {
                const rawIfaceShim = String(effectivePrinterInterface || '') || '';
                const pnShim = (String(printerName || '')).replace(/^printer:/i, '').trim();
                const looksLikeTypeShim = !!pnShim && (pnShim.toUpperCase() === String(effectivePrinterType || '').toUpperCase() || (PrinterTypes && Object.values(PrinterTypes).map(v => String(v).toUpperCase()).includes(pnShim.toUpperCase())));
                if (looksLikeTypeShim) {
                  try {
                    const pUrlShim = `http://localhost:${process.env.PRINTER_HTTP_PORT || 4000}/printers`;
                    const respShim = await fetch(pUrlShim, { method: 'GET' });
                    if (respShim && respShim.ok) {
                      const listShim = await respShim.json().catch(() => []);
                      if (Array.isArray(listShim) && listShim.length) {
                        const wantedShim = pnShim.toLowerCase();
                        let matchShim = listShim.find(p => p && p.name && String(p.name).toLowerCase().includes(wantedShim));
                        if (!matchShim) matchShim = listShim.find(p => p && ((p.driver && String(p.driver).toLowerCase().includes(wantedShim)) || (p.port && String(p.port).toLowerCase().includes(wantedShim))));
                        if (!matchShim) matchShim = listShim.find(p => p && p.default) || listShim[0];
                        if (matchShim && matchShim.name) {
                          printerName = String(matchShim.name).replace(/^\s*printer:\s*/i, '').trim();
                        } else {
                          // couldn't resolve to concrete name; skip raw helper and use Out-Printer default
                          skipRawHelperShim = true;
                        }
                      } else {
                        skipRawHelperShim = true;
                      }
                    } else {
                      skipRawHelperShim = true;
                    }
                  } catch (eShimDisc) {
                    skipRawHelperShim = true;
                  }
                }
              } catch (eShimPre) { /* ignore */ }

              if (helperPath && process.platform === 'win32' && printerName && !effectiveDryRun && !skipRawHelperShim) {
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
              // Debug: log buffer sizes for shim path
              try {
                const textBytesShim = (dataBuf && dataBuf.length) || 0;
                const rasterBytesShim = (rasterBufShim && rasterBufShim.length) || 0;
                logFile(`DEBUG Shim payload sizes: textBytes=${textBytesShim} rasterBytes=${rasterBytesShim} finalBytes=${final.length}`);
                console.log(`DEBUG Shim payload sizes: textBytes=${textBytesShim} rasterBytes=${rasterBytesShim} finalBytes=${final.length}`);
              } catch (eDbg2) { /* ignore */ }
              try { fs.writeFileSync(fnameBin, final); } catch (e) { logFile(`Shim2 failed to write bin ${fnameBin}: ${e && e.message}`); }

              const spawnSync = require('child_process').spawnSync;
              const helperPrinterArg = String(printerName || '').replace(/^\s*printer:\s*/i, '').trim();
              if (!helperPrinterArg) {
                logFile('Shim2: resolved printer name empty after stripping prefix; skipping raw-spooler helper');
              } else {
                try {
                  const sentShim = await trySendViaCodepages(helperPath, helperPrinterArg, out, escSizeBufShim, rasterBufShim, escResetShim, cutBuf, order && order.id, printerName);
                  if (sentShim) {
                    try { markPrinted(order && order.id); } catch (eMark) {}
                    return true;
                  }
                  logFile('Shim2: CODEPAGE-TEST probe failed to find working encoding; falling back to single raw-spooler attempt');
                } catch (eShimProbe) {
                  logFile('Shim2: CODEPAGE-TEST probe error: ' + (eShimProbe && eShimProbe.message));
                }
                const res = spawnSync(helperPath, [helperPrinterArg, fnameBin], { timeout: SPAWN_TIMEOUT_MS, windowsHide: true });
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
                logFile(`Shim2 printed binary ${fnameBin} to printer '${helperPrinterArg}' via raw-spooler helper (${helperPath})`);
                console.log('Shim2 printed to Windows printer (raw helper)', helperPrinterArg);
                try { markPrinted(order && order.id); } catch (eMark) {}
                return true;
              }
            }
          } catch (eHelper) {
            logFile(`raw-spooler attempt failed: ${eHelper && eHelper.message}`);
            console.warn('raw-spooler attempt failed:', eHelper && eHelper.message);
          }

          // fallback to PowerShell Out-Printer (text)
          if (process.platform === 'win32' && printerName && !effectiveDryRun) {
            try {
              const spawnSync = require('child_process').spawnSync;
              // Use a cleaned printer name (strip any `printer:` prefix) to avoid
              // passing invalid names to PowerShell/WinAPI.
              const resolvedPrinterName = String(printerName || '').replace(/^\s*printer:\s*/i, '').trim();
              // If resolvedPrinterName is empty or 'default', call Out-Printer without -Name to use the system default printer.
              const safePrinterName = (resolvedPrinterName || '').toString();
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
              logFile(`Shim2 printed file ${fnameTxt} to printer '${safePrinterName || 'default'}' via PowerShell Out-Printer`);
              console.log('Shim2 printed to Windows printer', safePrinterName || 'default');
              try { markPrinted(order && order.id); } catch (eMark) {}
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
                if (!textual && typeof shimQr === 'string' && shimQr.startsWith('data:image') && PNG && jsQR) {
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
                  // Data URL present but no textual QR available. Do not print
                  // the raw data URL or any placeholder tag. The agent will
                  // include the image (raster) separately when sending to the
                  // printer, so leave the textual receipt free of the URL.
                } else {
                  // If the QR content is a plain URL, avoid printing the raw URL
                  // on the ticket to keep the receipt clean. Otherwise print a
                  // short textual fallback (max 120 chars).
                  if (typeof shimQr === 'string' && /^https?:\/\//i.test(shimQr)) {
                    // skip printing raw QR URL
                  } else {
                    shim.println(String(shimQr).slice(0, 120));
                  }
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
    try { clearRecentPrint(order && order.id); } catch (eClear) {}
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

// Expose variants helper for diagnostic CLI
try {
  module.exports.pngToEscposRasterVariants = pngToEscposRasterVariants;
} catch (e) { /* ignore if function absent */ }
