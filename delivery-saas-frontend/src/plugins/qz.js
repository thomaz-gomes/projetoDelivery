import { API_URL } from '../config';

// Build-time flag (Vite) to indicate QZ-enabled builds
const ENABLE_QZ = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ENABLE_QZ)
  ? String(import.meta.env.VITE_ENABLE_QZ) === '1' || String(import.meta.env.VITE_ENABLE_QZ) === 'true'
  : false;

function getBaseApi() {
  return String(API_URL || '').replace(/\/$/, '') || ''
}

async function setupQZSecurity(qz) {
  try {
    if (!qz || !qz.security) return
    const base = getBaseApi()

    if (typeof qz.security.setCertificatePromise === 'function') {
      qz.security.setCertificatePromise(() => fetch(`${base}/qz/cert`, { credentials: 'include' }).then(r => r.text()))
    }

    if (typeof qz.security.setSignaturePromise === 'function') {
      // Newer QZ accepts a Promise<string> return; keep callback form for compatibility
      qz.security.setSignaturePromise((toSign) => {
        return fetch(`${base}/qz/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ toSign })
        }).then(r => r.text())
      })
    }
  } catch (e) {
    console.warn('print plugin: setupQZSecurity failed', e?.message || e)
  }
}

// Try to initialize QZ Tray (if available in the page). Returns true if
// QZ websocket connection was established or the `qz` object is present.
export async function initQZ() {
  if (typeof window === 'undefined') return false;
  const qz = window.qz;
  if (!qz) {
    console.log('print plugin: QZ Tray not available in window');
    return false;
  }
  try {
    await setupQZSecurity(qz)
    if (qz.websocket && typeof qz.websocket.connect === 'function') {
      // Connect if not already connected
      try { if (!qz.websocket.isActive || !qz.websocket.isActive()) await qz.websocket.connect(); } catch(_) {}
      console.log('print plugin: QZ websocket connected');
      return true;
    }
    // If websocket API missing but qz.api exists, consider it available
    if (qz.api && typeof qz.api.print === 'function') return true;
  } catch (e) {
    console.warn('print plugin: initQZ failed', e && e.message);
  }
  return false;
}

// Print an order using QZ Tray when available. Falls back to opening a
// print preview window or posting to `/agent-print` if QZ is not present.
export async function printComanda(order) {
  if (!order) return console.warn('print plugin: pedido indefinido');
  const base = getBaseApi();

  try {
    const res = await fetch(`${base}/qz-print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id || order })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('print plugin: /qz-print failed', res.status, txt);
      if (ENABLE_QZ) {
        return fallbackPreview(txt || '<p>Preview unavailable</p>');
      }
      return fallbackAgentPrint(base, order);
    }
    const json = await res.json();
    const html = json && json.html ? String(json.html) : null;
    if (!html) return fallbackAgentPrint(base, order);

    if (typeof window !== 'undefined' && window.qz && window.qz.print && window.qz.configs) {
      try {
        await setupQZSecurity(window.qz)
        const printerName = (localStorage.getItem('printerConfig') && JSON.parse(localStorage.getItem('printerConfig') || '{}').printerName) || '';
        const config = window.qz.configs.create(printerName);
        const data = [{ type: 'html', format: 'plain', data: html }];
        await window.qz.print(config, data);
        console.log('print plugin: printed via QZ Tray');
        return true;
      } catch (e) {
        console.warn('print plugin: QZ print failed, falling back', e && e.message);
        return fallbackPreview(html);
      }
    }

    return fallbackPreview(html);
  } catch (e) {
    console.error('print plugin: unexpected error while printing', e && e.message);
    if (ENABLE_QZ) return fallbackPreview('<p>Preview unavailable</p>');
    return fallbackAgentPrint(base, order);
  }
}

async function fallbackAgentPrint(base, order) {
  try {
    const res = await fetch(`${base}/agent-print`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order })
    });
    if (res.ok) { console.log('print plugin: sent to agent-print fallback'); return true; }
  } catch (e) {}
  console.warn('print plugin: agent-print fallback failed');
  return false;
}

function fallbackPreview(html) {
  try {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.open();
    w.document.write(html);
    w.document.close();
    return true;
  } catch (e) {
    console.warn('print plugin: preview fallback failed', e && e.message);
    return false;
  }
}

export default { initQZ, printComanda };