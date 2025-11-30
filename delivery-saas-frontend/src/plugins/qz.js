// Replacement plugin: QZ Tray is no longer used.
// This module provides a small compatibility layer with the same exports
// (`initQZ` and `printComanda`) so the frontend can call printing without
// referencing `window.qz`. Printing is delegated to a backend HTTP endpoint
// (`/api/print`) or to any proxy the app provides.

export async function initQZ() {
  // No-op replacement for legacy init. Keep for compatibility.
  console.log('print plugin: QZ Tray removed — init no-op');
  return false;
}

import { API_URL } from '../config';

export async function printComanda(order) {
  if (!order) return console.warn('print plugin: pedido indefinido');

  try {
    // Send order to backend print endpoint. Adjust URL if your backend exposes
    // a different route for printing (e.g. `/print` or external print agent).
    const base = String(API_URL || '').replace(/\/$/, '') || '';
    const res = await fetch(`${base}/agent-print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order })
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('print plugin: falha ao enviar impressão', res.status, txt);
      return false;
    }

    console.log('print plugin: pedido enviado para impressão (backend)');
    return true;
  } catch (e) {
    console.error('print plugin: erro ao enviar impressão', e);
    return false;
  }
}

export default { initQZ, printComanda };