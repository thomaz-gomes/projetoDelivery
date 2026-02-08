// src/services/printService.js

// Minimal HTTP-based print service that replaces QZ Tray integration.
// - Sends print requests to `/agent-print`.
// - Keeps a small retry queue when network/backend is unavailable.
// - Provides connectivity checks used by UI components.
// Determine backend base URL: prefer VITE_API_URL, otherwise default to localhost:3000
const BACKEND_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL)
  ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
  : 'http://localhost:3000';

// If running dev with QZ Tray enabled, don't poll the legacy `agent-print` service.
const ENABLE_QZ = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ENABLE_QZ)
  ? String(import.meta.env.VITE_ENABLE_QZ) === '1' || String(import.meta.env.VITE_ENABLE_QZ) === 'true'
  : false;

let connected = true; // optimistic default
let defaultPrinter = null;
const queue = [];
let isPrinting = false;
let connectingPromise = null;

// ================================
// 🧾 Gera o conteúdo de texto da comanda
// ================================
function formatOrderText(order) {
  const display = order.displaySimple != null ? String(order.displaySimple).padStart(2, '0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : "PEDIDO");
  // resolve address with several fallbacks and ensure it's a string
  function formatAddress(a) {
    if (!a && !order) return '-';
    const src = a ?? null;
    if (!src) return '-';
    if (typeof src === 'string') return src;
    // common shapes: { formattedAddress }, { formatted }, { address }, { street, number, neighborhood, city }
    if (typeof src === 'object') {
      if (src.formattedAddress) return String(src.formattedAddress);
      if (src.formatted) return String(src.formatted);
      if (src.fullAddress) return String(src.fullAddress);
      if (src.line) return String(src.line);
      // nested formatted inside deliveryAddress
      if (src.deliveryAddress && src.deliveryAddress.formattedAddress) return String(src.deliveryAddress.formattedAddress);
      // try common fields
      const parts = [];
      if (src.street || src.logradouro || src.streetName) parts.push(src.street || src.logradouro || src.streetName);
      if (src.number || src.numero) parts.push(src.number || src.numero);
      if (src.neighborhood || src.bairro) parts.push(src.neighborhood || src.bairro);
      if (src.city || src.cidade) parts.push(src.city || src.cidade);
      if (parts.length) return parts.join(', ');
      // last resort: JSON stringify concise
      try { return JSON.stringify(src); } catch(e){ return String(src); }
    }
    return String(src);
  }

  const rawAddr = order.address || (order.payload && (order.payload.rawPayload?.address || order.payload.delivery?.deliveryAddress?.formattedAddress || order.payload.delivery?.deliveryAddress)) || order.addressText || null;
  const resolvedAddress = formatAddress(rawAddr);
  // Header in a single line as requested: "#14 - Cliente: Thomaz"
  const header = `#${display} - Cliente: ${order.customerName || 'Não informado'}\nEndereço: ${resolvedAddress}\n`;
  // phone
  const phone = order.customerPhone || order.customer?.phone || order.customer?.whatsapp || order.contact || '';
  const phoneLine = phone ? `Telefone: ${phone}\n` : '';
  // ifood locator / pickup
  const ifoodLines = (() => {
    try {
      const loc = order.ifood?.externalCode || order.externalCode || order.payload?.rawPayload?.externalCode || null;
      const pickup = order.pickupCode || order.pickup_code || order.retrievalCode || order.payload?.pickupCode || null;
      if (!loc && !pickup) return '';
      return `${loc ? `Localizador:${loc}\n` : ''}${pickup ? `Código de retirada: ${pickup}\n` : ''}`;
    } catch (e) { return ''; }
  })();

  let headerBlock = `${header}${phoneLine}${ifoodLines}------------------------------\n`;

  // build items block including selected options per item
  const itemsArr = Array.isArray(order.items) ? order.items : (order.payload && Array.isArray(order.payload.items) ? order.payload.items : []);
  const items = itemsArr.map((it) => {
    const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
    const name = String(it.name || it.title || it.productName || '').slice(0, 25);
    const priceNum = Number(it.price ?? it.unitPrice ?? it.unit_price ?? it.amount ?? it.unitPrice ?? 0) || 0;
    const mainLine = `${String(qty).padStart(2, " ")}x ${name.padEnd(25, " ")} R$${priceNum.toFixed(2).padStart(6, " ")}`;
    const opts = Array.isArray(it.options) ? it.options : (Array.isArray(it.addons) ? it.addons : []);
    const optsLines = (opts || []).map(o => {
      const oq = Number(o.quantity ?? o.qty ?? 1) || 1;
      const oname = String(o.name || o.title || o.productName || '').slice(0, 30);
      const op = Number(o.price ?? o.unitPrice ?? o.amount ?? 0) || 0;
        const totalOptQty = oq * qty; // multiply option qty by item qty to display total option units
        const prefix = totalOptQty && totalOptQty > 1 ? `${totalOptQty}x ` : '';
      return `  - ${prefix}${oname}${op ? ` — R$${op.toFixed(2)}` : ''}`;
    }).join('\\n');
    return mainLine + (optsLines ? '\n' + optsLines : '');
  }).join('\\n');
  // compute subtotal from items
  const subtotalNum = itemsArr.reduce((s, it) => {
    const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
    const unit = Number(it.price ?? it.unitPrice ?? it.unit_price ?? 0) || 0;
    let optsSum = 0;
    const opts = Array.isArray(it.options) ? it.options : (Array.isArray(it.addons) ? it.addons : []);
    for (const o of (opts || [])) {
      const oq = Number(o.quantity ?? o.qty ?? 1) || 1;
      const op = Number(o.price ?? o.unitPrice ?? o.amount ?? 0) || 0;
      optsSum += (op * oq);
    }
    return s + (unit * qty) + (optsSum * qty);
  }, 0);

  const discountNum = Number(order.discount ?? order.discountAmount ?? 0) || 0;
  const totalNum = Number(order.total ?? order.amount ?? order.orderAmount ?? subtotalNum - discountNum) || subtotalNum - discountNum;

  // payment info
  const paymentMethod = (order.payload && order.payload.payment && (order.payload.payment.method || order.payload.payment.type)) || order.paymentMethod || order.payment || (order.payload && order.payload.payments && order.payload.payments[0] && (order.payload.payments[0].method || order.payload.payments[0].type)) || '—';
  const changeFor = Number(order.changeFor ?? order.paymentChange ?? order.payment?.changeFor ?? order.payload?.payment?.changeFor ?? 0) || 0;

  const summaryLines = [];
  summaryLines.push('------------------------------');
  summaryLines.push(`Sub-total = R$ ${subtotalNum.toFixed(2)}`);
  if (discountNum && discountNum > 0) summaryLines.push(`Desconto: R$ ${discountNum.toFixed(2)}`);
  summaryLines.push('');
  summaryLines.push(`TOTAL a cobrar: R$ ${totalNum.toFixed(2)}`);
  summaryLines.push(`Pagamento: ${paymentMethod}`);
  if (changeFor && changeFor > 0) summaryLines.push(`Troco para R$ ${changeFor.toFixed(2)}`);
  summaryLines.push('==============================');
  summaryLines.push(`${order.payload?.integration?.provider || order.channel || order.source || 'Canal de venda'} - ${order.storeName || order.companyName || ''}`);
  summaryLines.push('Obrigado e bom apetite!');
  summaryLines.push('==============================\n\n\n');

  return headerBlock + items + '\n' + summaryLines.join('\n');
}

// expose formatter so UI can preview the comanda without printing
export { formatOrderText };

// ================================
// 🖨️ Envia pedido para o backend/agent
// ================================
export async function enqueuePrint(order) {
  if (!order) return;
  // If frontend was built with QZ enabled, prefer the QZ flow and avoid
  // posting to the legacy `/agent-print` endpoint. This prevents accidental
  // delivery to print agents when the operator expects QZ Tray to handle
  // printing locally.
  try {
    if (ENABLE_QZ) {
      try {
        const { printComanda } = await import('../plugins/qz.js');
        // provide formatted text as well so QZ plugin can print same layout
        const text = formatOrderText(order);
        const ok = await printComanda(order, text);
        if (ok) return true;
      } catch (e) {
        console.warn('printService: QZ print failed, falling back to /agent-print', e && e.message);
      }
    }

    const res = await fetch(`${BACKEND_BASE}/agent-print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order, text: formatOrderText(order) })
    });
    if (!res.ok) throw new Error('failed to post to /agent-print: ' + res.status);
    return true;
  } catch (e) {
    console.warn('printService: failed to send order, queuing for retry', e && e.message ? e.message : e);
    queue.push(order);
    // schedule a retry
    setTimeout(processQueue, 5000);
    return false;
  }
}

async function processQueue() {
  if (isPrinting || queue.length === 0) return;
  isPrinting = true;
  const order = queue.shift();
  try {
    await enqueuePrint(order);
  } catch (e) {
    console.error('printService: error while processing queued print', e);
    queue.unshift(order); // push back to front
    setTimeout(processQueue, 5000);
  } finally {
    isPrinting = false;
    if (queue.length > 0) setTimeout(processQueue, 5000);
  }
}

// ================================
// 🚦 Estado do serviço / conectividade
// ================================
export function isConnected() {
  return !!connected;
}

export function isConnecting() {
  return !!connectingPromise;
}

// perform an async connectivity check against the agent-print endpoint
export async function checkConnectivity() {
  if (connectingPromise) return connectingPromise;
  // If QZ Tray is enabled we try to detect a real QZ client in-browser
  // (the frontend will try QZ first). If none is present, fall back to
  // probing the legacy `agent-print/printers` endpoint so local dev can
  // exercise printing flows without a native QZ Tray installation.
  if (ENABLE_QZ) {
    connectingPromise = (async () => {
      try {
        if (typeof window !== 'undefined' && window.qz) {
          connected = true;
          return connected;
        }
        // If QZ is enabled but not available in-window, consider not connected.
        // Legacy `/agent-print/printers` endpoint was removed; avoid probing it.
        connected = false;
      } finally {
        connectingPromise = null;
      }
      return connected;
    })();
    return connectingPromise;
  }
  // For non-QZ builds, the legacy agent discovery endpoint was removed.
  // Mark connectivity as false by default and avoid network probes.
  connectingPromise = Promise.resolve(false).then(() => {
    connected = false;
    connectingPromise = null;
    return connected;
  });
  return connectingPromise;
}

// kick off a background connectivity check
try {
  checkConnectivity();
  if (!ENABLE_QZ) {
    setInterval(() => { checkConnectivity().catch(()=>{}); }, 30000);
  }
} catch(e){}

// ================================
// 🔧 Printer configuration helpers
// ================================
export function getPrinterConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem('printerConfig') || '{}');
    return cfg;
  } catch (e) {
    return {};
  }
}

export async function setPrinterConfig(cfg = {}) {
  try {
    const merged = Object.assign({}, getPrinterConfig(), cfg);
    localStorage.setItem('printerConfig', JSON.stringify(merged));
    // update in-memory defaultPrinter if provided
    if (merged.printerName) {
      defaultPrinter = merged.printerName;
    }
    return merged;
  } catch (e) {
    console.warn('Failed to set printer config', e);
    throw e;
  }
}

export default {
  enqueuePrint,
  isConnected,
  isConnecting,
  checkConnectivity,
  formatOrderText,
  getPrinterConfig,
  setPrinterConfig,
  // Expose a simple route hint so UI can decide when to auto-print
  getPrintRoute: () => (ENABLE_QZ ? 'qz' : 'agent'),
};