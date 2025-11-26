// src/services/printService.js
import QRCode from 'qrcode';
import api from '../api';

let connected = false;
let defaultPrinter = null;
const queue = [];
let isPrinting = false;
let connectingPromise = null;

// Persisted QR cache (dev-friendly): stores data URLs by order id in localStorage
const QR_CACHE_KEY = 'orderQrDataUrls_v1';
function _loadQrCache() {
  try { return JSON.parse(localStorage.getItem(QR_CACHE_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function _saveQrCache(m) {
  try { localStorage.setItem(QR_CACHE_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ }
}
function persistOrderQr(orderId, dataUrl) {
  if (!orderId || !dataUrl) return;
  const m = _loadQrCache();
  m[orderId] = dataUrl;
  _saveQrCache(m);
}
function getPersistedOrderQr(orderId) {
  if (!orderId) return null;
  const m = _loadQrCache();
  return m[orderId] || null;
}

// print route: 'backend' or 'agent' (local agent HTTP)
function _defaultPrintRoute() {
  try {
    const stored = localStorage.getItem('printRoute')
    if (stored === 'backend' || stored === 'agent') return stored
  } catch (e) {}
  // env override via Vite: VITE_PRINT_USE_BACKEND=true
  try {
    if (import.meta && import.meta.env && (import.meta.env.VITE_PRINT_USE_BACKEND === 'true' || import.meta.env.PROD)) return 'backend'
  } catch (e) {}
  return 'agent'
}
let printRoute = _defaultPrintRoute();

// ================================
// 🚦 Health-check/Connect replacement (previously QZ Tray)
// ================================
export async function connectQZ() {
  // Keep the exported name `connectQZ` for compatibility with existing UI.
  if (connectingPromise) return connectingPromise;
  connectingPromise = (async () => {
    try {
      // Health checks depend on configured route
      if (printRoute === 'agent') {
        // check local agent health
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          // include agent token if configured so health probe can authenticate
          const cfg = getPrinterConfig() || {};
          const headers = {};
          if (cfg.agentToken) headers['x-print-agent-token'] = cfg.agentToken;
          const res = await fetch((window.location.hostname === 'localhost' ? 'http://localhost:4000' : '') + '/api/print/health', { signal: controller.signal, headers });
          clearTimeout(timeout);
          // Treat 200 OK as healthy. Also consider 401 Unauthorized as "agent reachable but auth required",
          // which is useful in dev when the agent exposes a token-protected health endpoint.
          if (res && (res.ok || res.status === 401)) {
            connected = true;
            console.log('printService: local print agent healthy');
            return true;
          }
        } catch (e) {
          clearTimeout(timeout);
        }
      } else {
        // backend forwarding route
        try {
          const res2 = await fetch('/agent-print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ probe: true }), credentials: 'include' });
          if (res2 && (res2.ok || res2.status === 401 || res2.status === 202 || res2.status === 400)) {
            connected = true;
            console.log('printService: backend agent-print reachable');
            return true;
          }
        } catch (e) { /* ignore */ }
      }

      connected = false;
      return false;
    } finally {
      connectingPromise = null;
    }
  })();
  return connectingPromise;
}

// ================================
// 🖨️ Enfileira impressão e processa via HTTP
// ================================
export async function enqueuePrint(order) {
  // Ensure qrDataUrl is present when possible (generate from server ticket endpoint)
    try {
      if (order && !order.qrDataUrl && !order.qr && order.id) {
          // try to use any previously persisted QR for this order first
          try {
            const persisted = getPersistedOrderQr(order.id);
            if (persisted) {
              order.qrDataUrl = persisted;
            }
          } catch (e) {}
        try {
          // use the app API helper (includes credentials/auth) to request the same ticket used by preview
          const { data: t } = await api.post(`/orders/${encodeURIComponent(order.id)}/tickets`).catch(() => ({}));
          if (t && (t.qrUrl || t.url)) {
            try {
              const dq = await QRCode.toDataURL(t.qrUrl || t.url, { width: 220, margin: 2 });
                order.qrDataUrl = dq;
                // also attach textual QR (url) so agent ASCII fallback can use it
                try { order.qr = order.qr || (t.qrUrl || t.url); } catch (e) {}
                // persist so subsequent prints will have it even if preview route wasn't called again
                try { persistOrderQr(order.id, dq); } catch (e) {}
            } catch (eqr) {
              console.warn('printService: failed to generate qrDataUrl from ticket response', eqr && eqr.message);
            }
          } else {
            // no ticket QR returned; leave silently — agent will attempt other fallbacks
            console.debug('printService: ticket endpoint returned no qrUrl for order', order.id);
          }
        } catch (e) {
          // ignore network/auth errors here - we'll still enqueue the order but log for diagnosis
          console.warn('printService: failed to call /orders/:id/tickets for QR generation', e && e.message);
        }
      }
    } catch (eOuter) {
      // ignore
    }

  return new Promise((resolve, reject) => {
    queue.push({ order, resolve, reject });
    processQueue();
  });
}

export function getPrintRoute() { return printRoute }
export function setPrintRoute(route) { if (route === 'backend' || route === 'agent') { printRoute = route; try { localStorage.setItem('printRoute', route) } catch(e){} } return printRoute }

// ================================
// ⏳ Processa a fila de impressão
// ================================
async function processQueue() {
  if (isPrinting || queue.length === 0) return;
  isPrinting = true;
  const item = queue.shift();
  const order = item.order;
  try {
    const res = await printOrder(order);
    try { item.resolve(res); } catch(e){}
  } catch (err) {
    console.error('printService: erro ao imprimir pedido', err);
    try { item.reject(err); } catch(e){}
  } finally {
    isPrinting = false;
    if (queue.length > 0) processQueue();
  }
}

// ================================
// 🧾 Gera o conteúdo de texto da comanda
// ================================
function formatOrderText(order) {
  // Build a more complete comanda layout used for preview and sending to agent
  let cfg = {};
  try { cfg = getPrinterConfig() || {}; } catch (e) { cfg = {}; }
  const includeDesc = !!cfg.includeItemDescription;

  const display = order.displaySimple != null ? String(order.displaySimple).padStart(2, '0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : (order.id || '').slice(0,6));
  const pw = Number(cfg.paperWidth || 80);
  const nameCol = (pw === 58) ? 16 : 25;
  const date = order.createdAt || order.date || order.created || new Date().toISOString();

  const lines = [];
  lines.push(`pedido: ${display} | ${String(date).split('T')[0]}`);
  lines.push((order.customerName || order.name || 'NOME DO CLIENTE').toUpperCase());
  lines.push('--------------------');
  const address = order.addressFull || order.address || order.addressString || [order.street, order.number].filter(Boolean).join(' ') || '-';
  lines.push(address);
  lines.push('---------------------');
  // phones
  const phones = (order.customerPhone && String(order.customerPhone)) || (order.phone && String(order.phone)) || (Array.isArray(order.phones) ? order.phones.join(' / ') : '');
  if (phones) lines.push(`Telefones: ${phones}`);
  // iFood locator and collection code
  if (order.ifoodLocator || order.ifood_code || order.ifood || order.externalLocator) lines.push(`Localizador iFood: ${order.ifoodLocator || order.ifood_code || order.ifood || order.externalLocator}`);
  if (order.ifoodCollectionCode || order.collectionCode || order.pickupCode) lines.push(`Código de coleta: ${order.ifoodCollectionCode || order.collectionCode || order.pickupCode}`);
  lines.push('');

  // Items
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
    // options / extras
    const extras = it.options || it.extras || it.modifiers || it.addons || it.subItems || [];
    if (Array.isArray(extras) && extras.length) {
      extras.forEach((ex, idx) => {
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
  // payments
  if (Array.isArray(order.payments) && order.payments.length) {
    order.payments.forEach(p => {
      const label = p.method || p.type || p.name || p.paymentMethod || 'Pagamento';
      const val = Number(p.amount ?? p.value ?? 0) || 0;
      lines.push(`${label.toUpperCase()}   ${val.toFixed(2)}`);
    })
  } else if (order.paymentMethod || order.paymentType || order.payment) {
    const label = order.paymentMethod || order.paymentType || (typeof order.payment === 'string' ? order.payment : 'Pagamento');
    const val = Number(order.paymentAmount ?? order.paymentValue ?? order.paidAmount ?? total) || total;
    lines.push(`${String(label).toUpperCase()}   ${val.toFixed(2)}`);
  }

  // QR code placeholder or url
  if (order.qr || order.qrUrl) lines.push(`QR: ${order.qrUrl || order.qr}`); else lines.push('[QR CODE]');

  // iFood order id and channel
  if (order.ifoodId || order.ifood_order_id || order.externalOrderId) lines.push(`NUMERO DO PEDIDO NO IFOOD: ${order.ifoodId || order.ifood_order_id || order.externalOrderId}`);
  if (order.channel || order.source || order.salesChannel) lines.push(`CANAL DE VENDA: ${order.channel || order.source || order.salesChannel}`);

  return lines.join('\n');
}

// expose formatter so UI can preview the comanda without printing
export { formatOrderText };

// ================================
// 🖨️ Execução real da impressão
// ================================
async function printOrder(order) {
  const route = printRoute || _defaultPrintRoute();
  const dbg = order.displaySimple != null ? String(order.displaySimple).padStart(2,'0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : (order.id || '').slice(0,6));
  const text = formatOrderText(order);

  if (route === 'agent') {
    // POST to local agent HTTP endpoint (dev-friendly). Use configured agent URL/token if present.
    const cfg = getPrinterConfig() || {};
    const agentUrl = cfg.agentUrl || 'http://localhost:4000/api/print';
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.agentToken) headers['x-print-agent-token'] = cfg.agentToken;

    // Ensure we include a QR image data URL (preview uses this) so the agent can print the exact QR shown in the UI.
    try {
      if (!order.qrDataUrl && (order.qrUrl || order.qr)) {
        // generate a PNG data URL from the existing QR URL/value used in the preview
        try {
          const src = order.qrUrl || order.qr;
          const dq = await QRCode.toDataURL(String(src), { width: 220, margin: 2 });
          // attach to order copy so backend/agent can detect and print the actual image
          order.qrDataUrl = dq;
          // ensure textual QR is present for ascii fallback
          try { order.qr = order.qr || String(src); } catch(e){}
          try { persistOrderQr(order.id, dq); } catch(e){}
        } catch (eGen) {
          // ignore generation failure and continue sending the original URL/value
          console.warn('Failed to generate qrDataUrl for print payload', eGen && eGen.message);
        }
      }
    } catch (e) {
      /* ignore any QR generation errors */
    }

    console.log(`🧾 Enviando pedido ${dbg} para agente local ${agentUrl} ...`);
    const res = await fetch(agentUrl, { method: 'POST', headers, body: JSON.stringify({ order, opts: { dryRun: cfg.dryRun || false, paperWidth: cfg.paperWidth ? Number(cfg.paperWidth) : undefined, includeItemDescription: !!cfg.includeItemDescription } }) });
    const code = res.status;
    const json = await res.json().catch(()=>null);
    if (!res.ok) {
      const txt = await res.text().catch(()=>'');
      if (res.status === 401) {
        // Agent requires auth — fall back automatically to backend forwarding route.
        console.warn('Local agent returned 401 Unauthorized — falling back to backend /agent-print route.');
        // attempt backend forward and normalize response
        try {
          const body = { order, storeId: order.storeId };
          const backendRes = await fetch('/agent-print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'include' });
          const backendCode = backendRes.status;
          const backendJson = await backendRes.json().catch(()=>null);
          if (!backendRes.ok) {
            const t = await backendRes.text().catch(()=>'');
            throw new Error(`Backend agent-print fallback failed: ${backendRes.status} ${t}`);
          }
          if (backendCode === 202 || (backendJson && (backendJson.queued || backendJson.status === 'queued'))) {
            return { status: 'queued', raw: backendJson, code: backendCode };
          }
          return { status: 'printed', raw: backendJson, code: backendCode };
        } catch (be) {
          throw new Error(`Local agent requires authentication (401) and backend fallback failed: ${be && be.message ? be.message : be}`);
        }
      }
      throw new Error(`Local agent print failed: ${res.status} ${txt}`);
    }
    console.log(`✅ Pedido ${dbg} enviado ao agente local.`, json);
    // normalize result
    if (json && (json.queued || code === 202 || (json.status && json.status === 'queued'))) {
      return { status: 'queued', raw: json, code };
    }
    return { status: 'printed', raw: json, code };
  }

  // route === 'backend' -> forward to backend /agent-print endpoint
  console.log(`🧾 Enviando pedido ${dbg} para backend /agent-print ...`);
  const body = { order, storeId: order.storeId };
  const res = await fetch('/agent-print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'include' });
  const code = res.status;
  const json = await res.json().catch(()=>null);
  if (!res.ok) {
    const txt = await res.text().catch(()=>'');
    throw new Error(`Backend agent-print failed: ${res.status} ${txt}`);
  }
  console.log(`✅ Pedido ${dbg} enviado ao backend`, json);
  // normalize backend response: 202 or explicit queued -> queued, otherwise assume printed/accepted
  if (code === 202 || (json && (json.queued || json.status === 'queued'))) {
    return { status: 'queued', raw: json, code };
  }
  return { status: 'printed', raw: json, code };
}

// ================================
// ♻️ Desconectar do QZ Tray
// ================================
export async function disconnectQZ() {
  const qz = window.qz;
  if (qz && qz.websocket && qz.websocket.isActive && qz.websocket.isActive()) {
    await qz.websocket.disconnect();
    connected = false;
    console.log("🔌 Desconectado do QZ Tray.");
  }
}

// ================================
// 🚦 Estado do serviço
// ================================
export function isConnected() {
  return connected;
}

export function getEffectiveEndpoint() {
  const route = printRoute || _defaultPrintRoute();
  if (route === 'agent') {
    const cfg = getPrinterConfig() || {};
    return cfg.agentUrl || 'http://localhost:4000/api/print';
  }
  return '/agent-print';
}

// retorna se existe uma tentativa de conexão em andamento
export function isConnecting() {
  return !!connectingPromise;
}

// ================================
// 🔧 Printer configuration helpers
// ================================
export function getPrinterConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem('printerConfig') || '{}') || {};
    try {
      const legacy = localStorage.getItem('agentToken');
      if (legacy && !cfg.agentToken) cfg.agentToken = legacy;
    } catch (e) { /* ignore */ }
    return cfg;
  } catch (e) {
    try {
      const legacy = localStorage.getItem('agentToken');
      if (legacy) return { agentToken: legacy };
    } catch (ee) {}
    return {};
  }
}

export async function setPrinterConfig(cfg = {}) {
  try {
    const merged = Object.assign({}, getPrinterConfig(), cfg);
    localStorage.setItem('printerConfig', JSON.stringify(merged));
    // keep legacy agentToken key in sync for other parts of the app
    try {
      if (merged.agentToken) localStorage.setItem('agentToken', merged.agentToken);
    } catch (e) { /* ignore */ }
    // update in-memory defaultPrinter if provided
    if (merged.printerName) {
      defaultPrinter = merged.printerName;
    }
    // If already connected and no explicit printer was provided, refresh default from QZ
    if (connected && (!merged.printerName) && window.qz && window.qz.printers) {
      try { defaultPrinter = await window.qz.printers.getDefault(); } catch(e){}
    }
    return merged;
  } catch (e) {
    console.warn('Failed to set printer config', e);
    throw e;
  }
}

export default {
  connectQZ,
  enqueuePrint,
  disconnectQZ,
  isConnected,
  isConnecting,
  formatOrderText,
  getPrinterConfig,
  setPrinterConfig,
  getPrintRoute,
  setPrintRoute,
  getEffectiveEndpoint,
};