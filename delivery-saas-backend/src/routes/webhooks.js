import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "../prisma.js";
import { upsertCustomerFromIfood } from "../services/customers.js";
import { emitirNovoPedido } from "../index.js"; // envia o pedido ao front via Socket.IO
import printQueue from '../printQueue.js'

export const webhooksRouter = express.Router();

// 📂 Pasta de logs (para debugging)
const LOG_DIR = path.resolve("logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

/**
 * 🔐 Verifica assinatura do iFood (opcional)
 */
function verifySignature(req, secret) {
  try {
    const sig = req.headers["x-ifood-signature"] || "";
    if (!sig || !secret) return true; // Se não houver segredo, ignora
    const raw = JSON.stringify(req.body);
    const h = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    return h === sig;
  } catch {
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
      console.log("🏢 Empresa encontrada pelo merchantId/merchantUuid:", integ.companyId, 'storeId:', integ.storeId, 'matched:', integ.merchantId || integ.merchantUuid);
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

      return { companyId: integ.companyId, merchantId: String(merchantId), storeId: resolvedStoreId || null };
    }
  }

  // fallback: se houver apenas uma integração ativa
  const onlyOne = await prisma.apiIntegration.findMany({
    where: { provider: "IFOOD", enabled: true },
    select: { companyId: true, merchantId: true },
  });
  if (onlyOne.length === 1) {
    console.log("🏢 Empresa fallback (única integração ativa):", onlyOne[0].companyId);
    return {
      companyId: onlyOne[0].companyId,
      merchantId: onlyOne[0].merchantId || null,
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
        body = {};
      }
    }

    // Salva log do corpo original (útil para debug)
    const logFile = path.join(LOG_DIR, `ifood-${Date.now()}.json`);
    fs.writeFileSync(logFile, JSON.stringify(body, null, 2), "utf8");

    const okSig = verifySignature(req, process.env.IFOOD_WEBHOOK_SECRET);
    if (!okSig) {
      return res.status(401).json({ ok: false, message: "Assinatura inválida" });
    }

    // Detecta o pedido dentro do corpo
    const order =
      body.order ??
      body.data?.order ??
      body.payload?.order ??
      body.resource?.order ??
      body;

    if (!order || typeof order !== "object") {
      throw new Error("Payload inválido — corpo sem dados de pedido.");
    }

    // 🔎 Resolve empresa
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
    const address =
      addr.formattedAddress ||
      [addr.streetName, addr.streetNumber, addr.neighborhood]
        .filter(Boolean)
        .join(", ") ||
      null;

    const latitude = Number(addr.coordinates?.latitude ?? 0) || null;
    const longitude = Number(addr.coordinates?.longitude ?? 0) || null;

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

    // 🔊 Envia o pedido para o painel via Socket.IO
    emitirNovoPedido(saved);
    console.log(`📦 Pedido salvo e emitido ao painel: ${displayId} (simple:${saved.displaySimple || 'N/A'})`);

    // --- Auto-print: try to deliver the order to a connected print agent for this storeId
    try {
      const io = req.app && req.app.locals && req.app.locals.io;
      const storeIdForPrint = saved.storeId || null;
      if (storeIdForPrint && io) {
        const candidates = Array.from(io.sockets.sockets.values()).filter(s => s.agent && Array.isArray(s.agent.storeIds) && s.agent.storeIds.includes(storeIdForPrint));
        if (!candidates || candidates.length === 0) {
          const queued = printQueue.enqueue({ order: saved, storeId: storeIdForPrint });
          console.log('Auto-print: no agent connected; job queued', queued.id);
        } else {
          // try recently connected agents first
          const sorted = candidates.slice().sort((a, b) => {
            const ta = (a.agent && a.agent.connectedAt) ? a.agent.connectedAt : 0;
            const tb = (b.agent && b.agent.connectedAt) ? b.agent.connectedAt : 0;
            return tb - ta;
          });

          const ACK_TIMEOUT_MS = process.env.PRINT_ACK_TIMEOUT_MS ? Number(process.env.PRINT_ACK_TIMEOUT_MS) : 10000;
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
            try { io.emit('print-result', { orderId: saved.id, status: 'queued', queuedId: queued.id }) } catch(_){}
          } else {
            try { io.emit('print-result', { orderId: saved.id, status: 'printed', socketId: deliveredInfo && deliveredInfo.socketId, ack: deliveredInfo && deliveredInfo.ack }) } catch(_){}
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
        latitude: Number(orderPayload.delivery?.deliveryAddress?.coordinates?.latitude ?? null) || null,
        longitude: Number(orderPayload.delivery?.deliveryAddress?.coordinates?.longitude ?? null) || null,
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
        latitude: Number(orderPayload.delivery?.deliveryAddress?.coordinates?.latitude ?? null) || null,
        longitude: Number(orderPayload.delivery?.deliveryAddress?.coordinates?.longitude ?? null) || null,
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