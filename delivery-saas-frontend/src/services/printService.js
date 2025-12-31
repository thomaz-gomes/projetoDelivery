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
  const header = `
==============================
      ${display}
==============================
Cliente: ${order.customerName || "Não informado"}
Endereço: ${order.address || "-"}
------------------------------
`;
  const items = (order.items || [])
    .map(
      (it) => {
        const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
        const name = String(it.name || it.title || it.productName || '').slice(0, 25);
        const priceNum = Number(it.price ?? it.unitPrice ?? it.unit_price ?? it.amount ?? 0) || 0;
        return `${String(qty).padStart(2, " ")}x ${name.padEnd(25, " ")} R$${priceNum.toFixed(2).padStart(6, " ")}`;
      }
    )
    .join("\n");

  const totalNum = Number(order.total ?? order.amount ?? order.orderAmount ?? 0) || 0;
  const footer = `
------------------------------
TOTAL: R$ ${totalNum.toFixed(2)}
==============================
  Obrigado e bom apetite!
==============================
\n\n\n`;

  return header + items + footer;
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
        const ok = await printComanda(order);
        if (ok) return true;
      } catch (e) {
        console.warn('printService: QZ print failed, falling back to /agent-print', e && e.message);
      }
    }

    const res = await fetch(`${BACKEND_BASE}/agent-print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order })
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