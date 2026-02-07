import express from 'express'
import path from 'path'
import fs from 'fs'
import { prisma } from '../prisma.js'
import { enrichOrderForAgent } from '../enrichOrderForAgent.js'

const router = express.Router()

// Minimal agent print route to accept print requests from the frontend or proxy.
// This implementation is intentionally lightweight so the server can start even
// if the full `printQueue` module is not present. If `printQueue` exists it
// will be used; otherwise the route will persist the payload to disk for
// inspection and return success.

let printQueue = null

async function ensurePrintQueue() {
  if (printQueue) return printQueue
  try {
    const mod = await import('../printQueue.js')
    printQueue = mod && (mod.default || mod)
    return printQueue
  } catch (e) {
    // ignore — module may be intentionally absent in some setups
    printQueue = null
    return null
  }
}

// Server-side fallback formatter to ensure print jobs include a readable
// ticket text when the client did not provide one. Mirrors the frontend
// `OrderTicketPreview` / `printService.formatOrderText` layout so saved
// payloads and agent jobs have the same information as the preview.
function formatOrderTextServer(o) {
  if (!o) return '';
  const padNumber = (n) => (n == null || n === '') ? '' : String(n).padStart(2, '0');
  const display = (o.displayId ?? o.displaySimple ?? o.display) != null ? padNumber(o.displayId ?? o.displaySimple ?? o.display) : (String(o.id || '').slice(0,6));
  const customer = o.customer?.name || o.customerName || o.name || '-';
  const addr = (() => {
    try {
      const maybe = o.address || o.addressFull || o.addressString || (o.payload && (o.payload.delivery && o.payload.delivery.deliveryAddress)) || null;
      if (!maybe) return '-';
      if (typeof maybe === 'string') return maybe;
      if (maybe.formatted) return maybe.formatted;
      const parts = [];
      if (maybe.street || maybe.logradouro) parts.push(maybe.street || maybe.logradouro);
      if (maybe.number || maybe.numero) parts.push(maybe.number || maybe.numero);
      if (maybe.neighborhood || maybe.bairro) parts.push(maybe.neighborhood || maybe.bairro);
      if (maybe.city) parts.push(maybe.city);
      if (parts.length) return parts.join(' | ');
      return JSON.stringify(maybe);
    } catch (e) { return '-'; }
  })();
  const phone = o.customer?.phone || o.customerPhone || o.contact || o.phone || '-';

  const lines = [];
  lines.push(`#${display} - Cliente: ${customer}`);
  lines.push(`Endereço: ${addr}`);
  lines.push(`Telefone: ${phone}`);

  const items = Array.isArray(o.items) ? o.items : (o.payload && Array.isArray(o.payload.items) ? o.payload.items : []);
  lines.push('------------------------------');
  lines.push('Itens do pedido');
  lines.push('');
  const nameCol = 30;
  for (const it of items) {
    const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
    const name = `${qty}x ${it.name || it.title || it.productName || ''}`;
    const unit = Number(it.price ?? it.unitPrice ?? it.unit_price ?? 0) || 0;
    const price = (unit * qty).toFixed(2);
    const left = name.padEnd(nameCol, ' ');
    lines.push(`${left} R$ ${price}`);
    const opts = it.options || it.selectedOptions || it.addons || [];
    for (const op of (opts || [])) {
      const oq = Number(op.quantity ?? op.qty ?? 1) || 1;
      const optPrice = (Number(op.price ?? op.unitPrice ?? op.amount ?? 0) * oq).toFixed(2);
      lines.push(`-   ${oq}x ${op.name || op.title || ''} — R$ ${optPrice}`);
    }
    lines.push('');
  }

  // totals
  const subtotal = (() => {
    try {
      let s = 0;
      for (const it of items) {
        const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
        const unit = Number(it.price ?? it.unitPrice ?? it.unit_price ?? 0) || 0;
        let optsSum = 0;
        const opts = it.options || it.selectedOptions || it.addons || [];
        for (const op of (opts || [])) optsSum += (Number(op.price ?? op.unitPrice ?? op.amount ?? 0) || 0) * (Number(op.quantity ?? op.qty ?? 1) || 1);
        s += (unit * qty) + (optsSum * qty);
      }
      return s;
    } catch (e) { return 0; }
  })();
  const discount = Number(o.discount || o.discountAmount || 0) || 0;
  const total = Number(o.total || o.amount || o.orderAmount || (subtotal - discount)) || subtotal - discount;

  lines.push('------------------------------');
  lines.push(`Sub-total = R$ ${subtotal.toFixed(2)}`);
  if (discount && discount > 0) lines.push(`Desconto: R$ ${discount.toFixed(2)}`);
  lines.push('');
  lines.push(`TOTAL a cobrar: R$ ${total.toFixed(2)}`);
  const pay = o.paymentMethod || o.payment || (o.payload && o.payload.payment && (o.payload.payment.method || o.payload.payment.type)) || '—';
  lines.push(`Pagamento: ${pay}`);
  lines.push('==============================');
  const channel = o.payload && o.payload.integration && o.payload.integration.provider ? o.payload.integration.provider : (o.channel || o.source || 'Canal de venda');
  lines.push(`${channel} - ${o.storeName || o.companyName || ''}`);
  lines.push('Obrigado e bom apetite!');
  lines.push('==============================');
  return lines.join('\n');
}

router.post('/', async (req, res) => {
  try {
    const payload = req.body || {}
    // If the client sent only an id (or minimal order object), try to load
    // the full order from the database so agents receive the same shape the
    // automatic/new-pedido flow sends. This reduces missing fields during
    // manual prints and makes the manual route behave like the automatic API.
    try {
      const maybeId = payload.id || (payload.order && payload.order.id) || null;
      if (maybeId && !payload.order) {
        try {
          const full = await prisma.order.findUnique({ where: { id: maybeId }, include: { items: true } });
          if (full) {
            payload.order = full;
            // ensure top-level storeId is present for routing
            payload.storeId = payload.storeId || full.storeId || null;
          }
        } catch (e) {
          console.warn('agentPrint: failed to fetch full order for manual print', e && e.message);
        }
      } else if (payload.order && payload.order.id) {
        // If a partial order object was provided, try to fetch full record and merge
        try {
          const full2 = await prisma.order.findUnique({ where: { id: payload.order.id }, include: { items: true } });
          if (full2) payload.order = Object.assign({}, full2, payload.order || {});
        } catch (e) {
          /* non-fatal */
        }
      }
    } catch (e) { /* ignore */ }
    // If the payload includes a storeId (or order.storeId) try to attach
    // the company's printer settings so agents receive printerInterface
    // and other prefs with the job. This allows agents to use the configured
    // printer without client-side environment changes.
    try {
      let storeId = payload.storeId || (payload.order && payload.order.storeId) || null;
      if (storeId) {
        try {
          const store = await prisma.store.findUnique({ where: { id: storeId }, select: { companyId: true } });
          if (store && store.companyId) {
            const setting = await prisma.printerSetting.findUnique({ where: { companyId: store.companyId } });
            if (setting) {
              // attach a best-effort printerInterface and width to the payload
              payload.printerInterface = payload.printerInterface || setting.interface || null;
              payload.printerType = payload.printerType || setting.type || null;
              payload.paperWidth = payload.paperWidth || setting.width || null;
            }
          }
        } catch (e) {
          // ignore DB errors — not fatal for enqueuing
          console.warn('agentPrint: failed to enrich payload with printerSetting', e && e.message);
        }
      }
    } catch (e) { /* ignore */ }

    // Ensure agents receive a hint to include full order data on the printed ticket.
    // This instructs the agent to append a sanitized JSON dump of the order.
    // Can be overridden by the client by setting payload.includeFullOrder = false.
    if (payload && typeof payload.includeFullOrder === 'undefined') payload.includeFullOrder = true;

    // Ensure a printable text body is present so agents or saved payloads
    // have the same visible content as the frontend preview. Clients may
    // already send `payload.text`; only generate when absent.
    try {
      if (!payload.text) payload.text = formatOrderTextServer(payload.order || payload);
    } catch (e) { /* non-fatal */ }
    // Attempt immediate delivery to connected agents for this storeId (if any)
    const io = req.app && req.app.locals && req.app.locals.io;
    const pq = await ensurePrintQueue()
    // Determine target store ids for this print request. Prefer explicit
    // `payload.storeId` then `payload.storeIds` (array) then order.storeId/order.storeIds.
    const explicitStoreId = payload.storeId || (payload.order && payload.order.storeId) || null;
    const explicitStoreIds = Array.isArray(payload.storeIds) && payload.storeIds.length ? payload.storeIds : (Array.isArray(payload.order && payload.order.storeIds) ? payload.order.storeIds : null);
    const storeIdsForPrint = explicitStoreIds || (explicitStoreId ? [explicitStoreId] : null);

    // Enrich payload with printer settings (template, copies, printerName, etc.)
    try {
      const orderToEnrich = payload.order || payload
      await enrichOrderForAgent(orderToEnrich)
      if (payload.order) payload.order = orderToEnrich
      else Object.assign(payload, orderToEnrich)
    } catch (e) { /* non-fatal */ }

    if (io && storeIdsForPrint && storeIdsForPrint.length) {
      try {
        // find candidate sockets that service any of the requested storeIds; accept authenticated
        // agents or sockets that provided storeIds in the handshake.auth
        const candidates = Array.from(io.sockets.sockets.values()).filter(s => {
          const agentStoreIds = (s.agent && Array.isArray(s.agent.storeIds)) ? s.agent.storeIds : null;
          const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
          const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
          const storeIds = agentStoreIds || handshakeStoreIds;
          if (!storeIds) return false;
          // accept if any requested storeId is present on the socket
          return storeIdsForPrint.some(id => storeIds.includes(id));
        });

        if (candidates && candidates.length > 0) {
          // try recently connected agents first
          const sorted = candidates.slice().sort((a, b) => {
            const ta = (a.agent && a.agent.connectedAt) ? a.agent.connectedAt : 0;
            const tb = (b.agent && b.agent.connectedAt) ? b.agent.connectedAt : 0;
            return tb - ta;
          });

          const ACK_TIMEOUT_MS = process.env.PRINT_ACK_TIMEOUT_MS ? Number(process.env.PRINT_ACK_TIMEOUT_MS) : 10000;
          let delivered = false;
          for (const s of sorted) {
            try {
              const attempt = await new Promise((resolve) => {
                let resolved = false;
                const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve({ ok: false, error: 'ack_timeout', socketId: s.id }); } }, ACK_TIMEOUT_MS + 1000);
                try {
                  s.timeout(ACK_TIMEOUT_MS).emit('novo-pedido', payload, (...args) => {
                    if (resolved) return;
                    resolved = true; clearTimeout(timer);
                    resolve({ ok: true, ack: args, socketId: s.id });
                  });
                } catch (e) {
                  if (!resolved) { resolved = true; clearTimeout(timer); resolve({ ok: false, error: String(e && e.message), socketId: s.id }); }
                }
              });
              if (attempt && attempt.ok) {
                const orderId = (payload && payload.order && payload.order.id) || payload.id || '<no-id>';
                console.log('agentPrint: delivered to agent socket', attempt.socketId, { orderId, storeId: explicitStoreId || null, method: 'direct' });
                delivered = true;
                break;
              } else {
                console.log('agentPrint: attempt failed for socket', attempt.socketId, attempt.error || '<no error>');
              }
            } catch (e) {
              console.warn('agentPrint: delivery attempt error', e && e.message);
            }
          }

          if (delivered) return res.json({ ok: true, printed: true });
        }
      } catch (e) {
        console.warn('agentPrint: immediate delivery attempt failed', e && e.message);
      }
    }
    // If we reach here, immediate delivery did not occur. Log current Socket.IO sockets
    try {
      if (io) {
        try {
          const all = Array.from(io.sockets.sockets.values()).map(s => {
            const hs = (s.handshake && s.handshake.auth) ? Object.assign({}, s.handshake.auth) : null;
            if (hs && hs.token) delete hs.token;
            return { id: s.id, connected: s.connected, agent: s.agent || null, handshake: hs };
          });
          console.log('agentPrint: immediate delivery not possible. Current sockets:', JSON.stringify({ total: all.length, sockets: all }, null, 2));
        } catch (eLog) { console.warn('agentPrint: failed to log sockets', eLog && eLog.message); }
      }
    } catch (e) {}

    // If immediate delivery did not occur, try a last-resort attempt:
    // if the request did not include storeIds, attempt to deliver to any
    // connected agents that advertised `handshake.auth.storeIds` (dev-friendly)
    // before falling back to enqueuing. This addresses cases where the
    // frontend omitted storeId but an agent for the target store is connected.
    try {
      const ACK_TIMEOUT_MS = process.env.PRINT_ACK_TIMEOUT_MS ? Number(process.env.PRINT_ACK_TIMEOUT_MS) : 10000;
      // Only perform this fallback when the request did NOT include an explicit storeId/storeIds
      // (we do NOT want to deliver to agents that merely advertised other storeIds)
      if ((!storeIdsForPrint || !storeIdsForPrint.length) && !explicitStoreId && io) {
        const candidates = Array.from(io.sockets.sockets.values()).filter(s => {
          const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
          const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
          return handshakeStoreIds && handshakeStoreIds.length;
        });

          if (candidates && candidates.length) {
          console.log('agentPrint: attempting fallback delivery to agents that advertised handshake.storeIds (count=' + candidates.length + ')');
          let delivered = false;
          for (const s of candidates) {
            try {
              const attempt = await new Promise((resolve) => {
                let resolved = false;
                const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve({ ok: false, error: 'ack_timeout', socketId: s.id }); } }, ACK_TIMEOUT_MS + 1000);
                try {
                  s.timeout(ACK_TIMEOUT_MS).emit('novo-pedido', payload, (...args) => {
                    if (resolved) return;
                    resolved = true; clearTimeout(timer);
                    resolve({ ok: true, ack: args, socketId: s.id });
                  });
                } catch (e) {
                  if (!resolved) { resolved = true; clearTimeout(timer); resolve({ ok: false, error: String(e && e.message), socketId: s.id }); }
                }
              });
              if (attempt && attempt.ok) {
                const orderId = (payload && payload.order && payload.order.id) || payload.id || '<no-id>';
                console.log('agentPrint: fallback delivered to agent socket', attempt.socketId, { orderId, storeId: explicitStoreId || null, method: 'fallback-handshake' });
                delivered = true; break;
              } else {
                console.log('agentPrint: fallback attempt failed for socket', attempt.socketId, attempt.error || '<no error>');
              }
            } catch (e) { console.warn('agentPrint: fallback attempt error', e && e.message); }
          }
          if (delivered) return res.json({ ok: true, printed: true, note: 'delivered-via-fallback-handshake-storeIds' });
        }
      }
    } catch (e) {
      console.warn('agentPrint: fallback delivery attempt failed', e && e.message);
    }

    // If fallback delivery did not occur, fall back to enqueuing the job
    if (pq && typeof pq.enqueue === 'function') {
      try {
        const queued = pq.enqueue(payload)
        // Attempt immediate processing via the printQueue (same method used by automatic prints)
        try {
          const io = req.app && req.app.locals && req.app.locals.io;
          const storeIds = Array.isArray(storeIdsForPrint) && storeIdsForPrint.length ? storeIdsForPrint : (explicitStoreId ? [explicitStoreId] : []);
          if (io && typeof pq.processForStores === 'function') {
            const procRes = await pq.processForStores(io, storeIds);
            const anyDelivered = procRes && Array.isArray(procRes.results) && procRes.results.some(r => r && r.ok);
            if (anyDelivered) return res.json({ ok: true, printed: true, queued: !!queued });
          }
        } catch (eProc) {
          console.warn('agentPrint: immediate queue processing failed', eProc && eProc.message);
        }
        return res.json({ ok: true, queued: !!queued })
      } catch (e) {
        console.warn('agentPrint enqueue failed', e && e.message)
      }
    }

    // Otherwise write payload to disk for debugging and return ok
    try {
      const outdir = path.join(process.cwd(), 'tmp', 'agent-prints')
      fs.mkdirSync(outdir, { recursive: true })
      const ts = Date.now()
      const fname = path.join(outdir, `agent-print-${ts}.json`)
      fs.writeFileSync(fname, JSON.stringify(payload, null, 2), 'utf8')
      console.log('agentPrint: saved payload to', fname)
    } catch (e) {
      console.warn('agentPrint: failed to save payload', e && e.message)
    }

    return res.json({ ok: true, note: 'queued-to-disk' })
  } catch (e) {
    console.error('POST /agent-print failed', e)
    return res.status(500).json({ ok: false, error: String(e && e.message) })
  }
})

// GET /agent-print/printers?storeId=... - ask connected agent for its local printers
router.get('/printers', async (req, res) => {
  try {
    const storeId = req.query.storeId || null;
    const io = req.app && req.app.locals && req.app.locals.io;
    if (!io) {
      // Socket.IO not yet attached — return a graceful empty list so the UI
      // shows no printers instead of an Internal Server Error.
      console.warn('GET /agent-print/printers: Socket.IO não inicializado (fallback empty list)');
      return res.json({ ok: true, printers: [] , note: 'socket-not-initialized'});
    }

    // find candidate sockets that service this storeId (accept authenticated
    // agents or sockets that provided storeIds in handshake.auth)
    const sockets = Array.from(io.sockets.sockets.values()).slice().reverse().filter(s => {
      const agentStoreIds = (s.agent && Array.isArray(s.agent.storeIds)) ? s.agent.storeIds : null;
      const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
      const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
      const storeIds = agentStoreIds || handshakeStoreIds;
      return storeIds && (storeId ? storeIds.includes(storeId) : true);
    });
    if (!sockets || sockets.length === 0) return res.status(404).json({ ok: false, message: 'Nenhum agente conectado para esse storeId' });

    // try each candidate until one responds
    for (const candidate of sockets) {
      try {
        const list = await new Promise((resolve) => {
          try {
            const timeout = 5000;
            let settled = false;
            const timer = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, timeout);
            // use a safe emit with acknowledgement callback without relying on candidate.timeout
            candidate.emit('list-printers', { storeId }, (err, result) => {
              if (settled) return;
              settled = true; clearTimeout(timer);
              if (err) return resolve(null);
              return resolve(result);
            });
          } catch (e) {
            // if emit fails synchronously resolve null
            try { return resolve(null); } catch (_) { return resolve(null); }
          }
        });
        if (Array.isArray(list)) return res.json({ ok: true, printers: list });
      } catch (e) {
        console.warn('agent-print: candidate socket failed during list-printers', e && e.message);
        continue;
      }
    }

    // none of the agents responded — return graceful 504 with a helpful note
    return res.status(504).json({ ok: false, message: 'Nenhum agente respondeu com lista de impressoras' });
  } catch (e) {
    console.error('GET /agent-print/printers failed', e);
    return res.status(500).json({ ok: false, error: String(e && e.message) });
  }
});

export default router
