// Replacement plugin: QZ Tray is no longer used.
// This module provides a small compatibility layer with the same exports
// (`initQZ` and `printComanda`) so the frontend can call printing without
// referencing `window.qz`. Printing is delegated to a backend HTTP endpoint
// (`/api/print`) or to any proxy the app provides.

import { API_URL } from '../config';

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
    if (qz.websocket && typeof qz.websocket.connect === 'function') {
      await qz.websocket.connect();
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
  const base = String(API_URL || '').replace(/\/$/, '') || '';

  try {
    const res = await fetch(`${base}/qz-print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id || order })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('print plugin: /qz-print failed', res.status, txt);
      // fallback to legacy agent-print
      return fallbackAgentPrint(base, order);
    }
    const json = await res.json();
    const html = json && json.html ? String(json.html) : null;
    if (!html) return fallbackAgentPrint(base, order);

    // If QZ Tray is present, send HTML to it
    if (typeof window !== 'undefined' && window.qz && window.qz.api && typeof window.qz.api.print === 'function') {
      try {
        const qz = window.qz;
        const printerName = (localStorage.getItem('printerConfig') && JSON.parse(localStorage.getItem('printerConfig') || '{}').printerName) || null;
        const config = (qz.configs && typeof qz.configs.create === 'function') ? qz.configs.create(printerName || '') : null;
        const data = [{ type: 'html', format: 'plain', data: html }];
        await qz.print(config, data);
        console.log('print plugin: printed via QZ Tray');
        return true;
      } catch (e) {
        console.warn('print plugin: QZ print failed, falling back', e && e.message);
        return fallbackPreview(html);
      }
    }

    // If QZ not available, open a preview window so the operator can print locally
    return fallbackPreview(html);
  } catch (e) {
    console.error('print plugin: unexpected error while printing', e && e.message);
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