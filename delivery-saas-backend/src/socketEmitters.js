// Socket emit functions extracted from index.js so they can be unit-tested.
// All order/rider/chat emissions are scoped to the company room `company_<companyId>`
// to prevent cross-tenant leaks.
//
// The `io` instance is injected via setIo() by index.js after Socket.IO is attached.
// Tests can inject a mock io via setIo() directly.

import printQueue from './printQueue.js';

let io = null;

export function setIo(ioInstance) {
  io = ioInstance;
}

export function _getIoForTest() {
  return io;
}

// ---- recent-emit tracker (avoid re-emitting same order within a short window) ----
const RECENT_EMIT_TTL_MS = process.env.RECENT_EMIT_TTL_MS ? Number(process.env.RECENT_EMIT_TTL_MS) : 15000;
const recentEmits = new Map(); // orderId -> ts

function isRecentlyEmitted(orderId) {
  try {
    if (!orderId) return false;
    const ts = recentEmits.get(orderId);
    if (!ts) return false;
    if ((Date.now() - ts) <= RECENT_EMIT_TTL_MS) return true;
    recentEmits.delete(orderId);
    return false;
  } catch (e) { return false; }
}

function markEmitted(orderId) {
  try {
    if (!orderId) return;
    recentEmits.set(orderId, Date.now());
    setTimeout(() => { try { recentEmits.delete(orderId); } catch (e) {} }, RECENT_EMIT_TTL_MS + 5000);
  } catch (e) {}
}

export function _clearRecentEmitsForTest() {
  recentEmits.clear();
}

// ---- helpers ----
function companyRoom(companyId) {
  return `company_${companyId}`;
}

// Returns all sockets currently joined to the given room (excluding those not present on the main namespace).
function socketsInRoom(roomName) {
  try {
    const roomSet = io && io.sockets && io.sockets.adapter && io.sockets.adapter.rooms
      ? io.sockets.adapter.rooms.get(roomName)
      : null;
    if (!roomSet) return [];
    const out = [];
    for (const sid of roomSet) {
      const s = io.sockets.sockets.get(sid);
      if (s) out.push(s);
    }
    return out;
  } catch (e) { return []; }
}

// ---- emit: novo-pedido ----
export function emitirNovoPedido(pedido) {
  if (!io) {
    console.warn("⚠️ Socket.IO ainda não inicializado — pedido não emitido ao painel.");
    return;
  }
  try {
    // Ensure payload carries a convenient `address` string to help frontends render immediately.
    try {
      if (pedido && !pedido.address) {
        const p = pedido.payload || {};
        const tryFormatted = (obj) => { try { if (!obj) return null; if (typeof obj === 'string') return obj; return obj.formatted || obj.formattedAddress || obj.formatted_address || null; } catch(e){return null} };
        const candidates = [
          pedido.address,
          tryFormatted(p.rawPayload && p.rawPayload.address),
          tryFormatted(p.delivery && p.delivery.deliveryAddress),
          tryFormatted(p.deliveryAddress),
          tryFormatted(p.order && p.order.delivery && p.order.delivery.address),
          (p.rawPayload && p.rawPayload.neighborhood) || null,
          (pedido.customer && pedido.customer.address && (typeof pedido.customer.address === 'string' ? pedido.customer.address : tryFormatted(pedido.customer.address))) || null,
        ];
        const addr = candidates.find(c => c && String(c).trim());
        if (addr) pedido.address = String(addr).trim();
      }
    } catch(e) { /* ignore */ }

    const oid = pedido && (pedido.id || pedido.orderId || pedido.externalId) ? (pedido.id || pedido.orderId || pedido.externalId) : null;
    if (oid && isRecentlyEmitted(oid)) {
      console.log('emitirNovoPedido: skipping recent emit for', oid);
      return;
    }

    const companyId = pedido && pedido.companyId;
    if (!companyId) {
      console.warn('⚠️ emitirNovoPedido: pedido sem companyId — abortando emissão por segurança multi-tenant', pedido && pedido.id);
      return;
    }

    // Only deliver to sockets that joined the company's room.
    const sockets = socketsInRoom(companyRoom(companyId));
    let sent = 0;
    const agentSockets = [];
    for (const s of sockets) {
      try {
        if (s && s.agent) { agentSockets.push(s); continue; }
        try { s.emit('novo-pedido', pedido); sent++; } catch (e) { /* ignore per-socket */ }
      } catch (e) { /* ignore */ }
    }
    console.log(`📢 Novo pedido emitido para painel da company ${companyId}: ${sent} sockets, agentes: ${agentSockets.length} — ${pedido.displayId || pedido.id}`);
    try { if (oid) markEmitted(oid); } catch (e) {}

    // Auto-print: enrich order and deliver directly to connected agents (same company only).
    // Falls back to printQueue if no agent is available (delivered when agent reconnects).
    if (agentSockets.length > 0) {
      const orderId = pedido.id || pedido.orderId || null;
      if (orderId) {
        (async () => {
          try {
            const orderCopy = Object.assign({}, pedido);
            try {
              const { enrichOrderForAgent: enrich } = await import('./enrichOrderForAgent.js');
              await enrich(orderCopy);
            } catch (e) { console.warn('🖨️ Auto-print: enrichment failed:', e && e.message); }
            // Safety net: ensure qrText is set for DELIVERY orders even if enrichment missed it
            if (!orderCopy.qrText && orderCopy.id) {
              const ot = String(orderCopy.orderType || (orderCopy.payload && (orderCopy.payload.orderType || orderCopy.payload.order_type)) || '').toUpperCase();
              if (ot === 'DELIVERY' || (orderCopy.payload && (orderCopy.payload.delivery || orderCopy.payload.deliveryAddress))) {
                const fe = (process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
                orderCopy.qrText = `${fe}/orders/${orderCopy.id}`;
                console.log(`🖨️ Auto-print: qrText safety net generated: ${orderCopy.qrText}`);
              }
            }
            console.log(`🖨️ Auto-print: enriched order ${orderId} qrText=${orderCopy.qrText || '(none)'} printerName=${orderCopy.printerName || '(none)'}`);
            const ACK_TIMEOUT_MS = 10000;
            for (const s of agentSockets) {
              try {
                const result = await new Promise(resolve => {
                  let done = false;
                  const timer = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'ack_timeout', sid: s.id }); } }, ACK_TIMEOUT_MS + 1000);
                  try {
                    s.timeout(ACK_TIMEOUT_MS).emit('novo-pedido', orderCopy, (...args) => {
                      if (done) return;
                      done = true; clearTimeout(timer);
                      resolve({ ok: true, ack: args, sid: s.id });
                    });
                  } catch (e) {
                    if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: String(e && e.message), sid: s.id }); }
                  }
                });
                if (result.ok) {
                  console.log(`🖨️ Auto-print: delivered to agent ${result.sid} — order ${orderId}`);
                  break;
                } else {
                  console.warn(`🖨️ Auto-print: agent ${result.sid} failed: ${result.error}`);
                }
              } catch (e) { /* ignore per-socket */ }
            }
          } catch (e) { console.warn('🖨️ Auto-print failed:', e && e.message); }
        })();
      }
    } else {
      // No agents connected — enqueue for later delivery when agent reconnects
      try {
        const storeId = pedido.storeId || (pedido.payload && pedido.payload.storeId) || null;
        const orderId = pedido.id || pedido.orderId || null;
        if (orderId) {
          const job = printQueue.enqueue({ order: pedido, storeId });
          console.log(`🖨️ Auto-print: no agent connected; job ${job.id} queued for order ${orderId}`);
        }
      } catch (e) { console.warn('🖨️ Auto-print enqueue failed:', e && e.message); }
    }
  } catch (e) {
    console.warn('emitirNovoPedido broadcast failed:', e && e.message);
  }
}

// ---- emit: order-updated ----
export function emitirPedidoAtualizado(pedido) {
  if (!io) {
    console.warn("⚠️ Socket.IO ainda não inicializado — atualização de pedido não emitida.");
    return;
  }
  try {
    const companyId = pedido && pedido.companyId;
    if (!companyId) {
      console.warn('⚠️ emitirPedidoAtualizado: pedido sem companyId — abortando emissão por segurança multi-tenant', pedido && pedido.id);
      return;
    }
    const payload = { id: pedido.id, displayId: pedido.displayId, status: pedido.status, riderId: pedido.riderId || null, closedByIfoodCode: pedido.closedByIfoodCode || false };
    io.to(companyRoom(companyId)).emit('order-updated', payload);
    console.log('📢 Atualização de pedido emitida:', payload);
  } catch (e) {
    console.warn('Falha ao emitir atualização de pedido:', e?.message || e);
  }
}

// ---- emit: rider-position ----
export function emitirPosicaoEntregador(companyId, payload) {
  if (!io) return;
  if (!companyId) {
    console.warn('⚠️ emitirPosicaoEntregador: companyId ausente — abortando');
    return;
  }
  try {
    io.to(companyRoom(companyId)).emit('rider-position', payload);
  } catch (e) {
    console.warn('Falha ao emitir posição do entregador:', e?.message || e);
  }
}

// ---- emit: rider-offline ----
export function emitirEntregadorOffline(companyId, riderId) {
  if (!io) return;
  if (!companyId) {
    console.warn('⚠️ emitirEntregadorOffline: companyId ausente — abortando');
    return;
  }
  try {
    io.to(companyRoom(companyId)).emit('rider-offline', { riderId });
  } catch (e) {
    console.warn('Falha ao emitir rider-offline:', e?.message || e);
  }
}

// ---- emit: goal-achieved ----
export function emitirMetaAtingida(companyId, payload) {
  if (!io) return;
  if (!companyId) return;
  try {
    io.to(companyRoom(companyId)).emit('goal-achieved', payload);
  } catch (e) {
    console.warn('Falha ao emitir meta atingida:', e?.message || e);
  }
}

// ---- emit: ifood:chat (to extension sockets only, scoped by company) ----
export function emitirIfoodChat({ orderNumber, message, storeId, companyId }) {
  if (!io) {
    console.warn('⚠️ Socket.IO não inicializado — ifood:chat não emitido.');
    return;
  }
  if (!companyId) {
    console.warn('⚠️ emitirIfoodChat: companyId ausente — abortando');
    return;
  }
  try {
    const payload = { orderNumber, message, storeId };
    const sockets = socketsInRoom(companyRoom(companyId));
    let sent = 0;
    for (const s of sockets) {
      if (!s.extension) continue;
      try { s.emit('ifood:chat', payload); sent++; } catch (e) { /* ignore */ }
    }
    console.log(`📨 ifood:chat emitido para ${sent} extensões — pedido: ${orderNumber}`);
  } catch (e) {
    console.warn('Falha ao emitir ifood:chat:', e?.message || e);
  }
}
