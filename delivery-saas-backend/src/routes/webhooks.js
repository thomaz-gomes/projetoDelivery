import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "../prisma.js";
import { upsertCustomerFromIfood, normalizeDeliveryAddressFromPayload } from "../services/customers.js";
import { emitirNovoPedido } from "../index.js"; // envia o pedido ao front via Socket.IO
import printQueue from '../printQueue.js'
import { enrichOrderForAgent } from '../enrichOrderForAgent.js'

// Helper: try to process the print queue for the provided storeIds with a
// small retry/backoff strategy. Returns the final result from processForStores.
async function tryProcessQueueWithRetries(io, storeIds, maxRetries = 2, baseDelayMs = 1000) {
  if (!io || !storeIds || !storeIds.length) return { ok: false, results: [] };
  let attempt = null;
  try {
    attempt = await printQueue.processForStores(io, storeIds);
    // if any job was delivered, return immediately
    if (attempt && attempt.ok && Array.isArray(attempt.results) && attempt.results.some(r => r && r.ok)) return attempt;
  } catch (e) {
    // continue to retries
  }

  for (let i = 0; i < maxRetries; i++) {
    const delay = baseDelayMs * Math.pow(2, i); // exponential backoff: 1s, 2s, ...
    try {
      await new Promise(res => setTimeout(res, delay));
      attempt = await printQueue.processForStores(io, storeIds);
      if (attempt && attempt.ok && Array.isArray(attempt.results) && attempt.results.some(r => r && r.ok)) return attempt;
    } catch (e) {
      // swallow and continue
    }
  }
  return attempt || { ok: false, results: [] };
}

export const webhooksRouter = express.Router();

// 📂 Pasta de logs (para debugging)
const LOG_DIR = path.resolve("logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Control flag: enable automatic printing when receiving webhooks.
// Default: disabled (require explicit ENABLE_AUTO_PRINT=1 to enable).
const ENABLE_AUTO_PRINT = String(process.env.ENABLE_AUTO_PRINT || '').toLowerCase() === '1';

/**
 * 🔐 Verifica assinatura do iFood (opcional)
 */
function verifySignature(req, secret) {
  try {
    const sig = req.headers["x-ifood-signature"] || "";
    if (!sig || !secret) return true; // If there's no signature configured, treat as valid
    const raw = JSON.stringify(req.body);
    const h = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    return h === sig;
  } catch (e) {
    return false;
  }
}

/**
 * 🔍 Busca o primeiro valor válido em uma lista de chaves
 */
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/**
 * 🏢 Resolve empresa via merchantId
 */
async function resolveCompanyByMerchant(req, order) {
  const hdrMerchant =
    req.headers["x-merchant-id"] || req.headers["x-ifood-merchant-id"];
  const merchantId =
    hdrMerchant ||
    order?.merchantId ||
    order?.merchant?.id ||
    req.body?.merchantId ||
    null;

  if (merchantId) {
    // Try matching either merchantId or merchantUuid fields (some integrations store UUID vs numeric id)
    const integ = await prisma.apiIntegration.findFirst({
      where: {
        provider: "IFOOD",
        enabled: true,
        OR: [
          { merchantId: String(merchantId) },
          { merchantUuid: String(merchantId) }
        ]
      },
      select: { companyId: true, storeId: true, merchantId: true, merchantUuid: true },
    });
    if (integ?.companyId) {
      console.log("🏢 Empresa encontrada pelo merchantId:", integ.companyId, 'storeId:', integ.storeId, 'matched:', integ.merchantId);
      // If integration exists but storeId is not set, attempt a best-effort match using payload store info
      let resolvedStoreId = integ.storeId || null;
      if (!resolvedStoreId) {
        try {
          const payloadStoreId = order?.storeId || order?.store?.id || order?.storeExternalId || null;
          const payloadStoreName = order?.store?.name || null;
          if (payloadStoreId) {
            // try direct match by store.id or slug or cnpj
            const s = await prisma.store.findFirst({ where: { companyId: integ.companyId, OR: [{ id: payloadStoreId }, { slug: payloadStoreId }, { cnpj: payloadStoreId }] }, select: { id: true } });
            if (s) resolvedStoreId = s.id;
          }
          if (!resolvedStoreId && payloadStoreName) {
            const s2 = await prisma.store.findFirst({ where: { companyId: integ.companyId, name: payloadStoreName }, select: { id: true } });
            if (s2) resolvedStoreId = s2.id;
          }
        } catch (e) {
          console.warn('store inference failed:', e?.message || e);
        }
      }

      if (!resolvedStoreId) {
        try {
          const firstStore = await prisma.store.findFirst({ where: { companyId: integ.companyId }, select: { id: true }, orderBy: { createdAt: 'asc' } });
          resolvedStoreId = firstStore?.id || null;
          if (resolvedStoreId) console.log('iFood webhook: sem storeId na integração, usando primeira loja:', resolvedStoreId);
        } catch (e) { /* ignore */ }
      }
      return { companyId: integ.companyId, merchantId: String(merchantId), storeId: resolvedStoreId || null };
    }
  }

  // fallback: se houver apenas uma integração ativa
  const onlyOne = await prisma.apiIntegration.findMany({
    where: { provider: "IFOOD", enabled: true },
    select: { companyId: true, merchantId: true, merchantUuid: true, storeId: true },
  });
  if (onlyOne.length === 1) {
    console.log("🏢 Empresa fallback (única integração ativa):", onlyOne[0].companyId);
    return {
      companyId: onlyOne[0].companyId,
      merchantId: onlyOne[0].merchantId || null,
      merchantUuid: onlyOne[0].merchantUuid || null,
      storeId: onlyOne[0].storeId || null,
    };
  }

  throw new Error("merchantId ausente e não foi possível determinar empresa.");
}

/**
 * 🚀 Webhook iFood (pedido criado)
 */
webhooksRouter.post("/ifood", async (req, res) => {
  try {
    let body = req.body;

    // Se vier como string (PowerShell ou curl), parseia manualmente
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        console.warn("⚠️ Corpo recebido como string inválida");
      }
    }

    // 🔎 Resolve empresa
    // normalize payload: some providers wrap the order under `order` property
    const order = (body && (body.order || body)) || {};
    const { companyId, merchantId, storeId } = await resolveCompanyByMerchant(req, order);

    // 🆔 Dados principais
    const externalId =
      pick(order, ["id", "orderId", "code", "orderCode", "reference"]) ||
      "IFD-" + crypto.randomBytes(5).toString("hex");
    const displayId =
      order.displayId ||
      order.shortId ||
      order.number ||
      `#${String(externalId).slice(-6)}`;

    // 👤 Cliente
    const customer = order.customer || order.consumer || {};
    const customerName = customer.name || customer.fullName || "Cliente";
    const customerPhone =
      customer.phone?.number ||
      customer.phoneNumber ||
      customer.phone ||
      null;

    // Try to persist or upsert a Customer record for this company from the payload.
    // This is best-effort: failures here should not block order ingestion.
    let persistedCustomer = null;
    try {
      console.log('iFood webhook: customer payload:', JSON.stringify(customer).slice(0, 1000))
      console.log('iFood webhook: derived customerPhone:', customerPhone)
      const up = await upsertCustomerFromIfood({ companyId, payload: order });
      console.log('iFood upsertCustomerFromIfood returned:', up && up.customer ? { id: up.customer.id, whatsapp: up.customer.whatsapp, fullName: up.customer.fullName } : up)
      if (up && up.customer) persistedCustomer = up.customer;
    } catch (custErr) {
      console.warn('Failed to upsert customer from iFood payload:', custErr?.message || custErr);
    }

    // 📍 Endereço
    const delivery = order.delivery || {};
    const addr =
      delivery.deliveryAddress ||
      order.deliveryAddress ||
      body.deliveryAddress ||
      {};

    // normalize delivery address into a consistent shape for storage/processing
    const normalizedDelivery = normalizeDeliveryAddressFromPayload(order) || normalizeDeliveryAddressFromPayload({ delivery: { deliveryAddress: addr } }) || null;
    const address = normalizedDelivery && normalizedDelivery.formattedAddress ? normalizedDelivery.formattedAddress : (addr.formattedAddress || [addr.streetName, addr.streetNumber, addr.neighborhood].filter(Boolean).join(', ') || null);

    const latitude = normalizedDelivery && normalizedDelivery.latitude != null ? normalizedDelivery.latitude : (Number(addr.coordinates?.latitude ?? 0) || null);
    const longitude = normalizedDelivery && normalizedDelivery.longitude != null ? normalizedDelivery.longitude : (Number(addr.coordinates?.longitude ?? 0) || null);

    // 💰 Valores
    const total = Number(
      order?.total?.orderAmount ?? order?.totalAmount ?? order?.amount ?? 0
    );
    const deliveryFee = Number(
      order?.total?.deliveryFee ?? order?.deliveryFee ?? 0
    );

    console.log("📋 Dados antes do upsert:", {
      companyId,
      externalId,
      displayId,
      customerName,
      total,
    });

    const eventId = body.eventId || body.id || crypto.randomBytes(8).toString("hex");

    // 🧾 Log de evento
    const ev = await prisma.webhookEvent.upsert({
      where: { eventId },
      update: { payload: body, status: "RECEIVED" },
      create: { provider: "IFOOD", eventId, payload: body, status: "RECEIVED" },
    });

    // 🛒 Cria ou atualiza o pedido
    // Compute a per-day sequential number to persist as displaySimple for new orders.
    // We compute the number based on how many orders already exist today for this company.
    const nowForCreation = new Date();
    const startOfDayForCreation = new Date(nowForCreation.getFullYear(), nowForCreation.getMonth(), nowForCreation.getDate());
    const existingTodayCount = await prisma.order.count({
      where: { companyId, createdAt: { gte: startOfDayForCreation } },
    });
    const displaySimpleForCreate = existingTodayCount + 1;

    const saved = await prisma.order.upsert({
      where: { externalId },
      update: {
        companyId,
        storeId: storeId || undefined,
        displayId,
        customerId: persistedCustomer ? persistedCustomer.id : undefined,
        customerSource: 'IFOOD',
        customerName,
        customerPhone,
        address,
        latitude,
        longitude,
        total,
        deliveryFee,
        payload: order,
      },
      create: {
        companyId,
        storeId: storeId || null,
        externalId,
        displayId,
        status: "EM_PREPARO",
  customerId: persistedCustomer ? persistedCustomer.id : undefined,
  customerSource: 'IFOOD',
        customerName,
        customerPhone,
        address,
        latitude,
        longitude,
        total,
        deliveryFee,
        payload: order,
        displaySimple: displaySimpleForCreate,
        histories: {
          create: [{ from: null, to: "EM_PREPARO", reason: "Webhook iFood" }],
        },
        items: {
          create: (order.items || []).map((it) => ({
            name: it.name || "Item",
            quantity: Number(it.quantity || 1),
            price: Number(it.totalPrice || it.price || 0),
          })),
        },
      },
      include: { items: true },
    });

    // ✅ Atualiza evento
    await prisma.webhookEvent.update({
      where: { id: ev.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });

    // 🔊 Ensure emitted object carries a human friendly padded displaySimple (e.g. "01")
    try {
      if (saved.displaySimple != null) {
        saved.displaySimple = String(saved.displaySimple).padStart(2, '0');
      } else {
        const createdAt = saved.createdAt || new Date();
        const startOfDay = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
        // count how many orders for this company were created up to this one (inclusive)
        const count = await prisma.order.count({
          where: {
            companyId: saved.companyId,
            createdAt: { gte: startOfDay, lte: createdAt }
          }
        });
        saved.displaySimple = String(count).padStart(2, '0');
      }
    } catch (e) {
      console.warn('Failed to compute displaySimple for emitted order', e?.message || e);
    }

    // 🔊 Generate QR (data URL) for delivery orders so agents can print QR on comanda
    try {
      const resolvedOrderType = String(saved.orderType || saved.order_type || (saved.payload && (saved.payload.orderType || saved.payload.order_type)) || '').toUpperCase();
      const hasDeliveryPayload = !!(saved.payload && (saved.payload.delivery || saved.payload.deliveryAddress || saved.payload.orderType === 'DELIVERY'));
      if (resolvedOrderType === 'DELIVERY' || hasDeliveryPayload) {
        try {
          const QRLib = await import('qrcode');
          const frontend = (process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
          const qrTarget = `${frontend}/orders/${saved.id}`;
          const dataUrl = await QRLib.toDataURL(qrTarget, { width: 240 });
          // persist to order so agents can access raster directly
          try {
            await prisma.order.update({ where: { id: saved.id }, data: { qrDataUrl: dataUrl, qrText: qrTarget, rasterDataUrl: dataUrl } });
            saved.qrDataUrl = dataUrl;
            saved.qrText = qrTarget;
            saved.rasterDataUrl = dataUrl;
          } catch (eUp) {
            // If the schema doesn't have qrDataUrl (Unknown argument), fallback to saving inside JSON payload
            try {
              console.warn('Persisting qrDataUrl directly failed, falling back to payload. Reason:', eUp && eUp.message);
              const current = await prisma.order.findUnique({ where: { id: saved.id }, select: { payload: true } });
              const currentPayload = (current && current.payload) ? current.payload : {};
              currentPayload.qrDataUrl = dataUrl;
              currentPayload.qrText = qrTarget;
              currentPayload.rasterDataUrl = dataUrl;
              await prisma.order.update({ where: { id: saved.id }, data: { payload: currentPayload } });
              // reflect in-memory so emitted object contains the QR
              saved.payload = currentPayload;
              saved.qrText = qrTarget;
              saved.rasterDataUrl = dataUrl;
              saved.qrText = qrTarget;
            } catch (e2) {
              console.warn('Failed to persist qrDataUrl to payload for order', saved.id, e2 && e2.message);
            }
          }
        } catch (eQr) {
          console.warn('Failed to generate QR for order', saved.id, eQr && eQr.message);
        }
      }
    } catch (e) { /* ignore QR generation errors */ }

    // 🔊 Envia o pedido para o painel via Socket.IO
    // Ensure emitted object has required fields so agents always receive id + QR info
    try {
      const emitObj = {
        id: saved.id,
        companyId: saved.companyId || saved.company || null,
        storeId: saved.storeId || (saved.payload && saved.payload.storeId) || null,
        qrDataUrl: saved.qrDataUrl || (saved.payload && saved.payload.qrDataUrl) || null,
        rasterDataUrl: saved.rasterDataUrl || (saved.payload && saved.payload.rasterDataUrl) || null,
        qrText: saved.qrText || (saved.payload && saved.payload.qrText) || null,
        payload: saved.payload || null
      };
      emitirNovoPedido(emitObj);
    } catch (eEmit) {
      console.warn('emitirNovoPedido failed for saved order', saved && saved.id, eEmit && eEmit.message);
      emitirNovoPedido(saved);
    }
    console.log(`📦 Pedido salvo e emitido ao painel: ${displayId} (simple:${saved.displaySimple || 'N/A'})`);
    // Auto-print behavior can be toggled via `ENABLE_AUTO_PRINT` env var.
    if (!ENABLE_AUTO_PRINT) {
      console.log('Auto-print disabled (ENABLE_AUTO_PRINT not set to 1) — skipping enqueue/delivery logic');
    } else {
      // If saved.storeId is missing, persist the job to the print queue so it
      // can be processed later when an agent connects. This helps cases where
      // webhooks do not include storeId information but an agent is available.
      try {
        if (!saved.storeId) {
          const QUEUE_FILE = path.join(process.cwd(), 'tmp', 'print-queue.json');
          let existing = [];
          try {
            if (fs.existsSync(QUEUE_FILE)) {
              existing = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8') || '[]') || [];
            }
          } catch (e) { existing = [] }
          const already = existing.find(it => it && it.order && (it.order.id === saved.id || it.order.externalId === saved.externalId));
          if (!already) {
            try {
              const queued = printQueue.enqueue({ order: saved, storeId: saved.storeId || null });
              console.log('Auto-print: saved.storeId missing — job enqueued for later processing', queued.id);
              // try processing immediately using handshake-advertised storeIds
              try {
                const io = req.app && req.app.locals && req.app.locals.io;
                if (io) {
                  const hsStoreIds = new Set();
                  Array.from(io.sockets.sockets.values()).forEach(s => {
                    try {
                      const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
                      const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
                      if (Array.isArray(handshakeStoreIds)) handshakeStoreIds.forEach(id => hsStoreIds.add(id));
                    } catch (e) {}
                  });
                  const toTry = Array.from(hsStoreIds).length ? Array.from(hsStoreIds) : null;
                  if (toTry && toTry.length) {
                    printQueue.processForStores(io, toTry).then(r => {
                      if (r && r.ok) console.log('Auto-print: processed queue after enqueue (missing storeId), results:', r.results);
                    }).catch(e => console.warn('Auto-print: processForStores after enqueue failed', e && e.message));
                  }
                }
              } catch (e) { }
            } catch (e) { console.warn('Auto-print: enqueue failed for missing storeId', e && e.message); }
          }
        }
      } catch (e) { /* ignore */ }

      // --- Auto-print: try to deliver the order to a connected print agent for this storeId
      try {
        const io = req.app && req.app.locals && req.app.locals.io;
        const storeIdForPrint = saved.storeId || null;
        // If we don't have a storeId but we do have a companyId, try to target
        // agents by company as a best-effort (useful when webhooks don't include storeId).
        const companyIdForPrint = saved.companyId || null;
        if (io && (storeIdForPrint || companyIdForPrint)) {
          let candidates = [];
          if (storeIdForPrint) {
            candidates = Array.from(io.sockets.sockets.values()).filter(s => {
              const agentStoreIds = (s.agent && Array.isArray(s.agent.storeIds)) ? s.agent.storeIds : null;
              const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
              const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
              const storeIds = agentStoreIds || handshakeStoreIds;
              return storeIds && storeIds.includes(storeIdForPrint);
            });
          } else if (companyIdForPrint) {
            // include sockets that authenticated as agents for this company
            candidates = Array.from(io.sockets.sockets.values()).filter(s => {
              try {
                if (s.agent && s.agent.companyId === companyIdForPrint) return true;
                const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
                const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
                if (!handshakeStoreIds || !handshakeStoreIds.length) return false;
                // best-effort: check if any handshake store belongs to this company
                return false; // placeholder, we'll filter below with DB check
              } catch (e) { return false; }
            });
          }
          // If we need to consider handshake storeIds for company matching, perform
          // a single bulk DB query to find which handshake-advertised storeIds
          // actually belong to the target company, then select matching sockets.
          if (!storeIdForPrint && companyIdForPrint && io) {
            try {
              // map socket -> handshake storeIds and collect all handshake storeIds
              const socketMap = new Map();
              const allHsIds = new Set();
              for (const s of Array.from(io.sockets.sockets.values())) {
                try {
                  const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
                  const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
                  if (Array.isArray(handshakeStoreIds) && handshakeStoreIds.length) {
                    socketMap.set(s, handshakeStoreIds);
                    handshakeStoreIds.forEach(id => allHsIds.add(id));
                  }
                } catch (e) { /* ignore per-socket */ }
              }
              const allIds = Array.from(allHsIds);
              let validStoreIds = [];
              if (allIds.length) {
                try {
                  const found = await prisma.store.findMany({ where: { id: { in: allIds }, companyId: companyIdForPrint }, select: { id: true } });
                  validStoreIds = (found || []).map(f => String(f.id));
                } catch (e) { /* ignore DB error, fall back to no matches */ }
              }
              // collect sockets whose handshake storeIds intersect validStoreIds
              const matchedByHandshake = [];
              if (validStoreIds.length) {
                for (const [s, hsIds] of socketMap.entries()) {
                  try {
                    if (hsIds.some(id => validStoreIds.includes(String(id)))) matchedByHandshake.push(s);
                  } catch (e) { /* ignore */ }
                }
              }
              // also include sockets that authenticated as agents for the company
              const authMatched = Array.from(io.sockets.sockets.values()).filter(s => s.agent && s.agent.companyId === companyIdForPrint);
              const merged = [...new Set([...(authMatched || []), ...(matchedByHandshake || [])])];
              candidates = merged;
            } catch (e) {
              // on unexpected errors, fall back to no candidates
              candidates = [];
            }
          }
          if (!candidates || candidates.length === 0) {
            const queued = printQueue.enqueue({ order: saved, storeId: storeIdForPrint });
            console.log('Auto-print: no agent connected; job queued', queued.id);
            // Attempt to process the queue immediately for any connected agents
            try {
              if (io) {
                // collect handshake-advertised storeIds from connected sockets
                const hsStoreIds = new Set();
                Array.from(io.sockets.sockets.values()).forEach(s => {
                  try {
                    const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
                    const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
                    if (Array.isArray(handshakeStoreIds)) handshakeStoreIds.forEach(id => hsStoreIds.add(id));
                  } catch (e) {}
                });
                const toTry = storeIdForPrint ? [storeIdForPrint] : (Array.from(hsStoreIds).length ? Array.from(hsStoreIds) : null);
                if (toTry && toTry.length) {
                  printQueue.processForStores(io, toTry).then(r => {
                    if (r && r.ok) console.log('Auto-print: processed queue after enqueue, results:', r.results);
                  }).catch(e => console.warn('Auto-print: immediate post-enqueue processForStores failed', e && e.message));
                }
              }
            } catch (e) { /* ignore */ }
          } else {
            // try recently connected agents first
            const sorted = candidates.slice().sort((a, b) => {
              const ta = (a.agent && a.agent.connectedAt) ? a.agent.connectedAt : 0;
              const tb = (b.agent && b.agent.connectedAt) ? b.agent.connectedAt : 0;
              return tb - ta;
            });

            const ACK_TIMEOUT_MS = process.env.PRINT_ACK_TIMEOUT_MS ? Number(process.env.PRINT_ACK_TIMEOUT_MS) : 10000;
            // Enrich order with printer settings before sending to agent
            try { await enrichOrderForAgent(saved); } catch (e) { /* non-fatal */ }
            let delivered = false;
            let deliveredInfo = null;
            for (const s of sorted) {
              try {
                const attempt = await new Promise(resolve => {
                  let resolved = false;
                  const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve({ ok: false, error: 'ack_timeout', socketId: s.id }); } }, ACK_TIMEOUT_MS + 1000);
                  try {
                    s.timeout(ACK_TIMEOUT_MS).emit('novo-pedido', saved, (...args) => {
                      if (resolved) return;
                      resolved = true; clearTimeout(timer);
                      resolve({ ok: true, ack: args, socketId: s.id });
                    });
                  } catch (e) {
                    if (!resolved) { resolved = true; clearTimeout(timer); resolve({ ok: false, error: String(e && e.message), socketId: s.id }); }
                  }
                });
                if (attempt && attempt.ok) {
                  console.log('Auto-print: delivered to agent socket', attempt.socketId);
                  delivered = true;
                  deliveredInfo = { socketId: attempt.socketId, ack: attempt.ack }
                  break;
                } else {
                  console.log('Auto-print: attempt failed for socket', attempt.socketId, attempt.error || '<no error>');
                }
              } catch (e) {
                console.warn('Auto-print: delivery attempt error', e && e.message);
              }
            }
            if (!delivered) {
              const queued = printQueue.enqueue({ order: saved, storeId: storeIdForPrint });
              console.log('Auto-print: no agent acknowledged; job queued', queued.id);
              try { io.emit('print-result', { orderId: saved.id, status: 'queued', queuedId: queued.id }) } catch(_){ }
            } else {
              try { io.emit('print-result', { orderId: saved.id, status: 'printed', socketId: deliveredInfo && deliveredInfo.socketId, ack: deliveredInfo && deliveredInfo.ack }) } catch(_){ }
            }
          }
        } else if (!io) {
          // no Socket.IO instance available yet — enqueue for later
          if (saved.storeId) {
            const queued = printQueue.enqueue({ order: saved, storeId: saved.storeId });
            console.log('Auto-print: Socket.IO not initialized; job queued', queued.id);
          }
        }
      } catch (e) {
        console.warn('Auto-print: unexpected error while attempting to deliver print job:', e && e.message);
      }
    }

    return res.json({
      ok: true,
      message: "Pedido processado e enviado ao painel",
      orderId: saved.id,
      displayId: saved.displayId,
      merchantId,
    });

  } catch (e) {
    console.error("❌ Erro ao processar webhook IFOOD:");
    console.error("Mensagem:", e.message);
    if (e.code) console.error("Código Prisma:", e.code);
    if (e.meta) console.error("Meta Prisma:", e.meta);
    if (e.stack) console.error(e.stack);
    return res.status(400).json({
      ok: false,
      message: "Falha ao processar pedido",
      error: e.message || String(e),
    });
  }
});

/**
 * 🧪 Endpoint de teste manual
 */
webhooksRouter.get("/generate-test", async (req, res) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) return res.status(404).json({ message: "Nenhuma empresa encontrada" });

    // load sample payload and use the iFood upsert logic to create a customer
    const samplePath = path.resolve('sample', 'ifood-webhook.json');
    if (!fs.existsSync(samplePath)) return res.status(500).json({ message: 'Sample payload not found: sample/ifood-webhook.json' });
    const raw = fs.readFileSync(samplePath, 'utf8');
    let sample = {};
    try { sample = JSON.parse(raw); } catch (e) { return res.status(500).json({ message: 'Invalid sample JSON' }); }

    const orderPayload = sample.order || sample;

    // try to upsert a customer using the same service used for real webhooks
    let upsertResult = null;
    try {
      upsertResult = await upsertCustomerFromIfood({ companyId: company.id, payload: orderPayload });
    } catch (e) {
      console.warn('generate-test: upsertCustomerFromIfood failed:', e?.message || e);
    }

    // ensure payload has a normalized deliveryAddress shape for consistency
    try {
      const norm = normalizeDeliveryAddressFromPayload(orderPayload);
      if (norm) {
        orderPayload.delivery = orderPayload.delivery || {};
        orderPayload.delivery.deliveryAddress = norm;
      }
    } catch (e) {}

    const externalId = orderPayload.id || 'TEST-' + Date.now();
    const displayId = orderPayload.displayId || `SIMULADO-${new Date().toISOString().slice(11,19).replace(/:/g,'')}`;

    // Compute displaySimple for today
    const displaySimple = (await prisma.order.count({ where: { companyId: company.id, createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) } } })) + 1;

    // Use upsert to avoid unique constraint failures when sample.externalId already exists
    const saved = await prisma.order.upsert({
      where: { externalId },
      update: {
        companyId: company.id,
        displayId,
        customerId: upsertResult && upsertResult.customer ? upsertResult.customer.id : undefined,
        customerSource: 'IFOOD',
        customerName: (orderPayload.customer && (orderPayload.customer.name || orderPayload.customer.fullName)) || 'Cliente',
        customerPhone: orderPayload.customer && (orderPayload.customer.phone?.number || orderPayload.customer.phone || null),
        address: orderPayload.delivery && orderPayload.delivery.deliveryAddress && (orderPayload.delivery.deliveryAddress.formattedAddress || [orderPayload.delivery.deliveryAddress.streetName, orderPayload.delivery.deliveryAddress.streetNumber].filter(Boolean).join(', ')) || null,
        latitude: Number(orderPayload.delivery?.deliveryAddress?.latitude ?? orderPayload.delivery?.deliveryAddress?.coordinates?.latitude ?? null) || null,
        longitude: Number(orderPayload.delivery?.deliveryAddress?.longitude ?? orderPayload.delivery?.deliveryAddress?.coordinates?.longitude ?? null) || null,
        total: Number(orderPayload.total?.orderAmount ?? orderPayload.totalAmount ?? orderPayload.amount ?? 0),
        deliveryFee: Number(orderPayload.total?.deliveryFee ?? orderPayload.deliveryFee ?? 0),
        payload: orderPayload,
      },
      create: {
        companyId: company.id,
        externalId,
        displayId,
        displaySimple,
        status: 'EM_PREPARO',
        customerId: upsertResult && upsertResult.customer ? upsertResult.customer.id : undefined,
        customerSource: 'IFOOD',
        customerName: (orderPayload.customer && (orderPayload.customer.name || orderPayload.customer.fullName)) || 'Cliente',
        customerPhone: orderPayload.customer && (orderPayload.customer.phone?.number || orderPayload.customer.phone || null),
        address: orderPayload.delivery && orderPayload.delivery.deliveryAddress && (orderPayload.delivery.deliveryAddress.formattedAddress || [orderPayload.delivery.deliveryAddress.streetName, orderPayload.delivery.deliveryAddress.streetNumber].filter(Boolean).join(', ')) || null,
        latitude: Number(orderPayload.delivery?.deliveryAddress?.latitude ?? orderPayload.delivery?.deliveryAddress?.coordinates?.latitude ?? null) || null,
        longitude: Number(orderPayload.delivery?.deliveryAddress?.longitude ?? orderPayload.delivery?.deliveryAddress?.coordinates?.longitude ?? null) || null,
        total: Number(orderPayload.total?.orderAmount ?? orderPayload.totalAmount ?? orderPayload.amount ?? 0),
        deliveryFee: Number(orderPayload.total?.deliveryFee ?? orderPayload.deliveryFee ?? 0),
        payload: orderPayload,
        items: {
          create: (orderPayload.items || []).map((it) => ({ name: it.name || 'Item', quantity: Number(it.quantity || it.qtd || 1), price: Number(it.totalPrice || it.unitPrice || it.price || 0) }))
        },
        histories: { create: [{ to: 'EM_PREPARO', reason: 'Teste iFood (generate-test)' }] }
      },
      include: { items: true }
    });

    emitirNovoPedido(saved);
    return res.json({ ok: true, message: 'Simulated iFood order created/upserted and upsert executed', upsertResult, order: saved });
  } catch (err) {
    console.error('generate-test failed:', err);
    return res.status(500).json({ message: 'generate-test failed', error: String(err?.message || err) });
  }
});