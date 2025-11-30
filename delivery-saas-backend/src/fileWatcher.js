import fs from 'fs';
import path from 'path';
import { prisma } from './prisma.js';
import { emitirNovoPedido } from './index.js';
import { parseSaiposWithAI } from './aiParser.js';
import { upsertCustomerFromPayloadTx } from './services/customers.js';
import { trackAffiliateSale } from './services/affiliates.js';

const watchers = new Map(); // companyId -> fs.FSWatcher
const processing = new Set(); // externalId currently being processed (debounce)
const pendingTimers = new Map(); // externalId -> timeout
const DEFAULT_DEBOUNCE_MS = 1500;
// Enable AI parser automatically when OPENAI_API_KEY is present (convenience)
const AI_PARSER_ENABLED = process.env.USE_AI_PARSER === 'true' || !!process.env.OPENAI_API_KEY;

function ensurePrismaFileSource() {
  if (!prisma || typeof prisma.fileSource === 'undefined') {
    throw new Error('Prisma model FileSource not available. Run: npx prisma migrate dev --name add_file_source && npx prisma generate');
  }
}

// readConfig: return an object mapping companyId -> path
async function readConfig() {
  try {
    ensurePrismaFileSource();
    const rows = await prisma.fileSource.findMany();
    const map = {};
    for (const r of rows) map[r.companyId] = r.path;
    return map;
  } catch (e) {
    console.error('Failed to read file sources from DB', e?.message || e);
    return {};
  }
}

function isSaiposFile(fname) {
  return fname && fname.toLowerCase().endsWith('.saiposprt');
}

// Try to extract JSON object/array from a string (HTML or text containing JSON)
function extractJsonFromString(s) {
  if (!s || typeof s !== 'string') return null;
  // look for the largest {...} or [...] block
  const objectMatches = Array.from(s.matchAll(/\{[\s\S]*?\}/g));
  const arrayMatches = Array.from(s.matchAll(/\[[\s\S]*?\]/g));

  const candidates = [...objectMatches.map(m => m[0]), ...arrayMatches.map(m => m[0])];
  // try larger candidates first
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      return parsed;
    } catch (_e) {
      // ignore and continue
    }
  }
  return null;
}

// normalize phone to only digits, keep up to 13 digits (include DDI if present)
function normalizePhoneNumber(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;
  // keep up to 13 digits to be safe (DDI + number)
  return digits.slice(-13);
}

// Basic validator for normalized payloads returned by AI parser.
function isValidNormalized(payload) {
  if (!payload || typeof payload !== 'object') return false;
  try {
    if (Array.isArray(payload.items) && payload.items.length > 0) return true;
    const orderAmount = Number(payload?.total?.orderAmount || 0);
    if (orderAmount && orderAmount > 0) return true;
    if (payload?.customer && (payload.customer.name || (Array.isArray(payload.customer.phones) && payload.customer.phones.length > 0))) return true;
    if (payload?.delivery?.deliveryAddress?.formattedAddress) return true;
    if (payload?.displayId) return true;
  } catch (_) {}
  return false;
}

// Ensure a Customer exists for this company and attach a CustomerAddress when possible.
// Matching strategy: first try to find a CustomerAddress with the same formatted address
// (and same company via customer relation). If not found, try to find Customer by name.
// If none found, create Customer and CustomerAddress (if formatted address present).
// Returns { customerId, customer } when available, otherwise null.
// NOTE: customer/address upsert logic was centralized to services/customers.upsertCustomerFromPayloadTx

// Normalize various incoming file shapes into the internal order schema
function normalizeSaiposPayload(parsed, externalId) {
  if (!parsed) return { id: externalId, items: [], total: { orderAmount: 0 } };

  // If this is a Saipos print/export object (several shapes are possible) with printRows,
  // detect both object.raw[...] and top-level array shapes like [ { printRows: [...] } ]
  const hasPrintRows = (
    parsed && Array.isArray(parsed.raw) && parsed.raw.length > 0 && parsed.raw[0].printRows
  ) || (
    Array.isArray(parsed) && parsed.length > 0 && (parsed[0].printRows || (parsed[0].raw && Array.isArray(parsed[0].raw) && parsed[0].raw[0] && parsed[0].raw[0].printRows))
  ) || (
    parsed && parsed.printRows
  );
  if (hasPrintRows) {
    return parseSaiposRaw(parsed, externalId);
  }

  // helper to pick first available
  const pick = (...keys) => {
    for (const k of keys) {
      const parts = k.split('.');
      let v = parsed;
      for (const p of parts) {
        if (v == null) break;
        v = v[p];
      }
      if (v != null) return v;
    }
    return null;
  };

  const id = parsed.id || externalId;
  const displayId = parsed.displayId || parsed.displaySimple || (typeof id === 'string' ? id.slice(0, 6) : undefined);

  const customerName = pick('customerName', 'customer.fullName', 'customer.name', 'customerName') || null;
  const customerPhone = pick('customerPhone', 'customer.phone', 'customer.phones.0.number', 'phone');

  const address = pick('address', 'delivery.deliveryAddress.formattedAddress', 'delivery.address', 'deliveryAddress');
  const lat = pick('latitude', 'lat', 'delivery.latitude', 'delivery.deliveryAddress.coordinates.latitude');
  const lng = pick('longitude', 'lng', 'delivery.longitude', 'delivery.deliveryAddress.coordinates.longitude');

  const totalAmount = pick('total', 'orderTotal', 'totalAmount', 'total.orderAmount', 'order.total') ?? 0;

  const rawItems = Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed.orderItems) ? parsed.orderItems : []);
  const items = rawItems.map((it, idx) => {
    const qty = it.quantity ?? it.qte ?? it.qty ?? 1;
    const unit = it.price ?? it.unitPrice ?? it.unit_price ?? it.unit_price_override ?? 0;
    const total = it.total ?? it.totalPrice ?? (qty * unit);
    return {
      id: it.id ?? `${idx + 1}`,
      name: it.name || it.title || it.productName || 'Item',
      quantity: qty,
      unitPrice: unit,
      totalPrice: total,
    };
  });

  return {
    id,
    displayId,
    customer: { name: customerName || null, phones: customerPhone ? [{ number: customerPhone }] : [] },
    delivery: { deliveryAddress: { formattedAddress: address || null, coordinates: { latitude: lat ?? 0, longitude: lng ?? 0 } } },
    total: { orderAmount: Number(totalAmount) },
    items,
    raw: parsed,
  };
}

// Parse Saipos raw.printRows into structured order-like object
function parseSaiposRaw(parsed, externalId) {
  try {
    // parsed can be one of:
    // - an object with .raw = [ { printRows: [...] } ]
    // - an array like [ { printRows: [...] } ]
    // - a single node object with printRows
    let node = null;
    if (Array.isArray(parsed)) node = parsed[0];
    else if (parsed && Array.isArray(parsed.raw)) node = parsed.raw[0];
    else node = parsed;

    const rows = Array.isArray(node?.printRows) ? node.printRows.map(r => String(r)) : [];

    const stripTags = (s='') => (s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00A0/g, ' ').trim();
    const parseNumber = (s='') => {
      if (!s) return 0;
      const t = String(s).replace(/[^0-9,\.\-]/g, '').replace(/\./g, '').replace(/,/g, '.');
      const v = parseFloat(t);
      return Number.isFinite(v) ? v : 0;
    };

    // helpers to find lines
    const findLine = (matcher) => rows.find(r => matcher(stripTags(r)));
    const findLines = (matcher) => rows.filter(r => matcher(stripTags(r)));

    // order id / sale_number / logData
    const saleNumber = node?.sale_number || '';
    const logData = node?.logData || {};
    const id_sale = logData.id_sale || parsed?.id_sale || null;
    const id = id_sale ? String(id_sale) : (parsed.id || externalId);

    // displayId: try sale number numeric or slice of id
    let displayId = null;
    const mSale = String(saleNumber).match(/(\d+)/);
    if (mSale) displayId = mSale[1];
    else if (id) displayId = String(id).slice(0,6);

    // customer name: line after 'Pedido' or lines that look like a name
    let customerName = null;
    for (let i=0;i<rows.length;i++){
      const txt = stripTags(rows[i]);
      if (/^Pedido\b|^Pedido:/.test(txt)) {
        for (let j=i+1;j<rows.length;j++){ const t=stripTags(rows[j]); if (t) { customerName = t; break; } }
        break;
      }
    }
    if (!customerName) {
      for (let i=0;i<rows.length;i++){ const t=stripTags(rows[i]); if (/Telefone/i.test(t)) { if (i>0) customerName = stripTags(rows[i-1]); break; } }
    }
    if (!customerName) customerName = null;

    // phone
    let phone = null;
    const phoneLine = findLine(t => /Telefone|Telefone:|Tel:|Tel\./i.test(t));
    if (phoneLine) {
      const txt = stripTags(phoneLine);
      const m = txt.match(/(\+?\d[\d\s\-()]{6,}\d)/);
      if (m) phone = m[1].replace(/[^0-9]+/g,'');
      else {
        const m2 = txt.match(/(\d{8,14})/);
        if (m2) phone = m2[1];
      }
    }

    // address: try to pick real street lines and avoid picking phone lines.
    // Strategy:
    // - skip lines that look like phone numbers (mostly digits, parentheses or dashes)
    // - accept lines that start with common street prefixes (Rua, R., Av., Avenida, Travessa, Praça, etc.)
    // - also accept lines that contain a comma followed by a number ("Rua X, 123")
    let formattedAddress = null;
    for (const r of rows) {
      const t = stripTags(r);
      if (!t) continue;
      // skip obvious phone-like lines (only digits, spaces, dashes, parentheses, plus)
      if (/^\+?\d[\d\s\-()]{6,}\d$/.test(t)) continue;
      // accept typical street prefixes or lines with ", <number>" pattern
      if (/^\s*(R\.|Rua|Av\.|Avenida|Travessa|Praça|Rodovia|Estrada|Rua Rua)\b/i.test(t) || /,\s*\d{1,5}\b/.test(t) || /\bRefer(en|ê)n?cia\b|^Casa\b/i.test(t)) {
        formattedAddress = t;
        break;
      }
    }

    // merchant name: look for lines with Lanch or Restaurant
    let merchantName = null;
    for (const r of rows.reverse()) {
      const t = stripTags(r);
      if (/Lanch|Restaur|Padaria|Cia\b|Cia\s/i.test(t)) { merchantName = t; break; }
    }

    // pickup code
    let pickupCode = null;
    const pickupLine = findLine(t => /Codigo de Coleta|Código de Coleta|Código|Coleta/i.test(t));
    if (pickupLine) { const m=stripTags(pickupLine).match(/(\d{3,})/); if (m) pickupCode = m[1]; }

    // delivery time
    let deliveryTime = null;
    const delLine = findLine(t => /Entrega para|Entrega para às|Entrega para as|Entrega para/ig.test(t));
    if (delLine) { const m=stripTags(delLine).match(/(\d{1,2}:\d{2})/); if (m) deliveryTime = m[1]; }

    // items
    const items = [];
    for (let i=0;i<rows.length;i++){
      const t = stripTags(rows[i]);
      const m = t.match(/^\s*(\d+)\s+(.+?)\s+(\d+[\.,]\d{2})$/);
      if (m) {
        const qty = parseInt(m[1],10)||1;
        const name = m[2].trim();
        const price = parseNumber(m[3]);
        let obs = [];
        let j = i+1;
        while (j<rows.length) {
          const nxt = stripTags(rows[j]);
          if (/^\s*-/.test(nxt) || /^-\d+x|^\s+\-/.test(nxt) || nxt.startsWith(' -') ) { obs.push(nxt.replace(/^[-\s]+/,'').trim()); j++; }
          else break;
        }
        items.push({ index: items.length, id: `item-${items.length+1}`, name, externalCode: null, quantity: qty, unitPrice: price, totalPrice: price, observations: obs.join('; ') });
      }
    }

    // totals
    const total = { subTotal: 0, deliveryFee: 0, orderAmount: 0, extraCharges: 0, discounts: 0 };
    for (const r of rows) {
      const t = stripTags(r);
      if (/Total itens/i.test(t) || /^Total itens/i.test(t)) { const m=t.match(/(\d+[\.,]\d{2})/); if (m) total.subTotal = parseNumber(m[1]); }
      if (/Taxa de entrega/i.test(t) || /Taxa de entrega/i.test(t)) { const m=t.match(/(\d+[\.,]\d{2})/); if (m) total.deliveryFee = parseNumber(m[1]); }
      if (/Acr[oó]scimo|Acr[eé]scimo/i.test(t)) { const m=t.match(/(\d+[\.,]\d{2})/); if (m) total.extraCharges = parseNumber(m[1]); }
      if (/Desconto\(/i.test(t) || /^Desconto/i.test(t)) { const m=t.match(/(\d+[\.,]\d{2})/); if (m) total.discounts = parseNumber(m[1]); }
      if (/TOTAL\(/i.test(t) || /^TOTAL\(/i.test(t)) { const m=t.match(/(\d+[\.,]\d{2})/); if (m) total.orderAmount = parseNumber(m[1]); }
    }
    if (!total.orderAmount) total.orderAmount = (total.subTotal || items.reduce((s,it)=>s+ (it.totalPrice||0),0)) + (total.deliveryFee||0) + (total.extraCharges||0) - (total.discounts||0);

    // payments
    const payments = { prepaid: 0, methods: [] };
    let payIdx = rows.findIndex(r => /Forma de pagamento/i.test(stripTags(r)));
    if (payIdx>=0) {
      for (let k=payIdx+1;k<rows.length;k++){
        const t = stripTags(rows[k]);
        if (!t) continue;
        if (/Op:|www\.|Corte|corte_parcial/i.test(t)) break;
        const m = t.match(/([A-Za-z\s]+)\s+(\d+[\.,]\d{2})$/);
        if (m) {
          const methodName = m[1].trim();
          const val = parseNumber(m[2]);
          if (/Voucher|Voucher Parceiro|Voucher/i.test(methodName)) {
            payments.methods.push({ value: val, currency: 'BRL', method: 'VOUCHER', type: 'OTHER', prepaid: true });
            payments.prepaid += val;
          } else if (/Dinheiro|Dinheiro/i.test(methodName)) {
            payments.methods.push({ value: val, currency: 'BRL', method: 'CASH', type: 'OFFLINE', prepaid: false });
          } else {
            payments.methods.push({ value: val, currency: 'BRL', method: methodName.toUpperCase(), type: 'OTHER', prepaid: false });
          }
        }
      }
    }

    return {
      id: String(id),
      displayId,
      customer: { name: customerName, phones: phone ? [{ number: phone }] : [] },
      delivery: { deliveryAddress: { formattedAddress: formattedAddress || null, coordinates: { latitude: node?.printSettings?.latitude || 0, longitude: node?.printSettings?.longitude || 0 } }, pickupCode },
      items,
      total,
      payments,
      additionalInfo: { metadata: { codigoInternoPdv: String(node?.logData?.id_sale || node?.printSettings?.id_store || ''), nomeVendedor: null, storeId: node?.printSettings?.idStore || node?.printSettings?.id_store || null, printGuid: node?.printSettings?.guid } },
      raw: parsed,
    };
  } catch (e) {
    console.error('parseSaiposRaw failed', e?.message || e);
    return { id: externalId || null, displayId: null, customer: { name: 'Importado', phones: [] }, delivery: { deliveryAddress: { formattedAddress: null, coordinates: { latitude:0, longitude:0 } } }, items: [], total: { orderAmount: 0 }, payments: { prepaid:0, methods:[] }, raw: parsed };
  }
}

async function processFile(companyId, filePath) {
  // file may have been removed/moved by another process; check existence first
  if (!fs.existsSync(filePath)) {
    console.warn('FileWatcher: file disappeared before processing:', filePath);
    return;
  }

  const externalId = path.basename(filePath);
  if (processing.has(externalId)) {
    console.log('FileWatcher: already processing externalId (early), skipping duplicate event:', externalId);
    return;
  }

  processing.add(externalId);
  try {
    // read file and parse (or use AI parser when enabled)
    const data = await fs.promises.readFile(filePath, 'utf8');
    let payload = null;

    // If environment enables AI parsing, try it first (best-effort). Falls back to local parser on failure.
    if (AI_PARSER_ENABLED) {
      try {
        // Try to decode base64 content to text first (many .saiposprt files are base64-wrapped)
        let aiInput = null;
        try {
          const buf = Buffer.from(data, 'base64');
          const decoded = buf.toString('utf8');
          // simple heuristic: if decoded contains printable characters and some tags/letters, use it
          if (decoded && /[\p{L}<>\{\}\[\]]/u.test(decoded)) {
            aiInput = decoded;
          }
        } catch (_e) {
          // ignore
        }
        // if we didn't get a decoded text, try to extract an embedded JSON block from the raw content
        if (!aiInput) {
          const maybe = extractJsonFromString(data);
          if (maybe) aiInput = JSON.stringify(maybe);
        }

        const aiRes = await parseSaiposWithAI(aiInput || data, externalId);
        const aiParsed = aiRes?.parsed ?? null;
        const aiText = aiRes?.text ?? null;
        if (aiParsed && typeof aiParsed === 'object') {
          if (isValidNormalized(aiParsed)) {
            payload = aiParsed;
            console.log('FileWatcher: payload produced by AI parser for', externalId);
          } else {
            console.warn('FileWatcher: AI parser returned payload that seems empty; falling back to local parser for', externalId);
            // log the raw AI text to help debugging why extraction failed
            console.warn('FileWatcher: AI raw response:', String(aiText).slice(0, 2000));
            // also log a snippet of the input we sent to the AI (helps debugging encoding issues)
            try { console.warn('FileWatcher: AI input snippet:', String(aiInput || data).slice(0, 2000)); } catch(_){}
          }
        } else {
          // AI returned no JSON-parsable object
          console.warn('FileWatcher: AI parser returned no JSON object; falling back to local parser for', externalId);
          if (aiText) console.warn('FileWatcher: AI raw response:', String(aiText).slice(0, 2000));
          try { console.warn('FileWatcher: AI input snippet:', String(aiInput || data).slice(0, 2000)); } catch(_){}
        }
      } catch (aiErr) {
        console.warn('FileWatcher: AI parser failed, falling back to local parser for', externalId, aiErr?.message || aiErr);
      }
    }

    // If AI didn't produce a payload, try the local parse path
    if (!payload) {
      let parsed = null;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        try {
          const buf = Buffer.from(data, 'base64');
          const decoded = buf.toString('utf8');
          try {
            parsed = JSON.parse(decoded);
          } catch (err2) {
            const maybe = extractJsonFromString(decoded);
            if (maybe) parsed = maybe;
            else {
              const maybe2 = extractJsonFromString(data);
              if (maybe2) parsed = maybe2;
              else {
                console.error('Failed to parse file as JSON or extract JSON from decoded content:', filePath, err2?.message || err2);
                await moveToSubdir(filePath, 'failed');
                return;
              }
            }
          }
        } catch (err) {
          const maybe = extractJsonFromString(data);
          if (maybe) parsed = maybe;
          else {
            console.error('Failed to parse file as JSON or base64 JSON and no embedded JSON found:', filePath, err?.message || err);
            await moveToSubdir(filePath, 'failed');
            return;
          }
        }
      }

      payload = normalizeSaiposPayload(parsed, externalId);
    }
    const company = companyId;

    // debug summary
    try { console.log('FileWatcher: normalized payload summary for', externalId, JSON.stringify({ displayId: payload.displayId, customerName: payload?.customer?.name, items: Array.isArray(payload?.items) ? payload.items.length : 0, total: payload?.total?.orderAmount }, null, 2)); } catch(_){}

  const customerName = payload?.customer?.name || null;
  const total = payload?.total?.orderAmount ?? 0;
  const address = payload?.delivery?.deliveryAddress?.formattedAddress || null;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  // try to extract storeId from normalized payload (some importers include store id in metadata)
  const rawStoreId = payload?.additionalInfo?.metadata?.storeId || payload?.additionalInfo?.metadata?.idStore || payload?.storeId || payload?.additionalInfo?.storeId || null;
  const storeId = rawStoreId != null ? String(rawStoreId) : null;

    // transactional upsert: check+update or create
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.order.findUnique({ where: { externalId } });
        // try to associate a customer/address (best-effort) inside the same transaction
        let customerAssocId = null;
        try {
          const ci = await upsertCustomerFromPayloadTx(tx, { companyId: company, payload });
          if (ci && ci.customerId) customerAssocId = ci.customerId;
        } catch (err) {
          console.warn('Could not associate customer/address for externalId', externalId, err?.message || err);
        }
        if (existing) {
          const updated = await tx.order.update({
            where: { id: existing.id },
            data: {
              storeId: storeId || existing.storeId,
              customerName: customerName || existing.customerName,
              customerId: customerAssocId || existing.customerId,
              customerPhone: payload?.customer?.phones?.[0]?.number || existing.customerPhone,
              displayId: payload?.displayId || existing.displayId,
              address: address || existing.address,
              latitude: payload?.delivery?.deliveryAddress?.coordinates?.latitude ?? existing.latitude,
              longitude: payload?.delivery?.deliveryAddress?.coordinates?.longitude ?? existing.longitude,
              total: total || existing.total,
              payload
            }
          });
          await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
          if (items.length) {
            for (const it of items) {
              await tx.orderItem.create({ data: { orderId: existing.id, name: it.name || it.title || 'Item', quantity: it.quantity || it.qte || 1, price: it.price ?? it.unitPrice ?? 0 } });
            }
          }
          return { order: updated, wasNew: false };
        }

        const o = await tx.order.create({ data: {
          companyId: company,
          storeId: storeId || null,
          externalId,
          displayId: payload?.displayId || null,
          customerId: customerAssocId || null,
          customerName: customerName || 'Importado',
          customerPhone: payload?.customer?.phones?.[0]?.number || null,
          address: address || null,
          latitude: payload?.delivery?.deliveryAddress?.coordinates?.latitude ?? null,
          longitude: payload?.delivery?.deliveryAddress?.coordinates?.longitude ?? null,
          total: total || 0,
          payload
        } });
        if (items.length) {
          for (const it of items) {
            await tx.orderItem.create({ data: { orderId: o.id, name: it.name || it.title || 'Item', quantity: it.quantity || it.qte || 1, price: it.price ?? it.unitPrice ?? 0 } });
          }
        }
        return { order: o, wasNew: true };
      });

      const o = result.order;
      
      // Track affiliate sale if applicable (after order creation/update)
      try {
        await trackAffiliateSale(o, company);
      } catch (affiliateError) {
        console.warn('Failed to track affiliate sale for order', o.id, affiliateError?.message || affiliateError);
      }
      
      if (result.wasNew) {
        console.log('Imported order from file (transactional):', filePath, '-> order.id=', o.id);
        emitirNovoPedido({ id: o.id, externalId, companyId: company });
      } else {
        console.log('Updated order from file (transactional):', filePath, '-> order.id=', o.id);
        emitirNovoPedido({ id: o.id, externalId, companyId: company, updated: true });
      }

      try { await moveToSubdir(filePath, 'processed'); } catch (e) { console.warn('FileWatcher: failed to move processed file (it may have been removed):', filePath, e?.message || e); }
    } catch (e) {
      console.error('FileWatcher: failed to create/update order transactionally', filePath, e?.message || e);
      // fallback attempt
      try {
  const created = await prisma.order.create({ data: { companyId: company, storeId: storeId || null, externalId, customerName: customerName || 'Importado', address: address || null, total: total || 0, payload } });
        if (items.length) {
          for (const it of items) {
            try { await prisma.orderItem.create({ data: { orderId: created.id, name: it.name || it.title || 'Item', quantity: it.quantity || it.qte || 1, price: it.price ?? it.unitPrice ?? 0 } }); } catch(_){}
          }
        }
        
        // Track affiliate sale if applicable (fallback case)
        try {
          await trackAffiliateSale(created, company);
        } catch (affiliateError) {
          console.warn('Failed to track affiliate sale for fallback order', created.id, affiliateError?.message || affiliateError);
        }
        
        emitirNovoPedido({ id: created.id, externalId, companyId: company });
        try { await moveToSubdir(filePath, 'processed'); } catch(_){}
      } catch (err) {
        console.error('FileWatcher: fallback create also failed', filePath, err?.message || err);
        try { await moveToSubdir(filePath, 'failed'); } catch(_){}
      }
    }
  } catch (e) {
    console.error('Error processing file', filePath, e?.message || e);
    try { await moveToSubdir(filePath, 'failed'); } catch(_){ console.warn('FileWatcher: could not move to failed, file may not exist:', filePath); }
  } finally {
    try { processing.delete(externalId); } catch(_){}
  }
}

// Schedule processing for a file with per-externalId debounce. This collapses
// multiple fs.watch events into a single processFile invocation.
function scheduleProcess(companyId, filePath, ms = DEFAULT_DEBOUNCE_MS) {
  try {
    const externalId = path.basename(filePath);
    // if already scheduled, clear and reschedule
    if (pendingTimers.has(externalId)) {
      clearTimeout(pendingTimers.get(externalId));
    }

    const t = setTimeout(() => {
      pendingTimers.delete(externalId);
      // call processFile but don't await here (watcher handler context)
      processFile(companyId, filePath).catch((err) => {
        console.error('scheduleProcess: processFile error for', filePath, err?.message || err);
      });
    }, ms);

    pendingTimers.set(externalId, t);
  } catch (e) {
    console.error('scheduleProcess failed', e?.message || e);
  }
}

async function moveToSubdir(filePath, subdir) {
  const dir = path.dirname(filePath);
  // Avoid creating nested processed/failed directories. If file already lives in the
  // target subdir, keep it there; otherwise create/use the subdir inside the current dir.
  const targetDir = (path.basename(dir) === subdir) ? dir : path.join(dir, subdir);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const base = path.basename(filePath);
  const dest = path.join(targetDir, `${Date.now()}-${base}`);
  try {
    await fs.promises.rename(filePath, dest);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      // file not found; ignore
      console.warn('moveToSubdir: file not found when trying to move:', filePath);
      return;
    }
    throw e;
  }
}

async function startWatching() {
  const cfg = await readConfig();
  for (const [companyId, p] of Object.entries(cfg)) {
    watchPath(companyId, p);
  }
}

function watchPath(companyId, folderPath) {
  try {
    if (!folderPath) return;
    if (!fs.existsSync(folderPath)) {
      console.warn('FileWatcher: configured path does not exist:', folderPath);
      return;
    }
    // avoid duplicate watchers
    if (watchers.has(companyId)) {
      try { watchers.get(companyId).close(); } catch(_){}
    }

    // Use recursive watch on platforms that support it (Windows/macOS) so files
    // dropped into subfolders are also detected. Node supports recursive on Windows/macOS.
    const watcherOptions = { persistent: true };
    if (process.platform === 'win32' || process.platform === 'darwin') watcherOptions.recursive = true;

    const w = fs.watch(folderPath, watcherOptions, (eventType, filename) => {
      if (!filename) return;
      if (!isSaiposFile(filename)) return;
      const full = path.join(folderPath, filename);
      // ignore files that are inside our processed/failed subfolders to avoid loops
      try {
        const rel = path.relative(folderPath, full) || '';
        const first = rel.split(path.sep)[0];
        if (first === 'processed' || first === 'failed') return;
      } catch (_) {}
      // schedule processing with debounce per externalId to collapse duplicate events
      scheduleProcess(companyId, full, DEFAULT_DEBOUNCE_MS);
    });
    watchers.set(companyId, w);
    console.log('FileWatcher: watching', folderPath, 'for company', companyId);
  } catch (e) {
    console.error('FileWatcher failed to watch path', folderPath, e?.message || e);
  }
}

async function addOrUpdateCompanyPath(companyId, folderPath) {
  try {
    ensurePrismaFileSource();
    if (folderPath) {
      await prisma.fileSource.upsert({
        where: { companyId },
        update: { path: folderPath },
        create: { companyId, path: folderPath },
      });
    } else {
      await prisma.fileSource.deleteMany({ where: { companyId } });
    }
  } catch (e) {
    console.error('Failed to upsert file source in DB', e?.message || e);
    throw e;
  }
  // restart watcher for this company
  if (watchers.has(companyId)) {
    try { watchers.get(companyId).close(); } catch(_){}
    watchers.delete(companyId);
  }
  if (folderPath) watchPath(companyId, folderPath);
  return true;
}

// Preview utility: given raw file content (string) and optional filename, return normalized payload or throw
async function previewNormalizedPayload(content, filename) {
  // Optionally allow AI-assisted parsing when enabled, otherwise reuse local parsing logic
  if (AI_PARSER_ENABLED) {
    try {
      // decode base64 first when possible to give the AI readable text
      let aiInput = null;
      try {
        const buf = Buffer.from(content, 'base64');
        const decoded = buf.toString('utf8');
  if (decoded && /[\p{L}<>\{\}\[\]]/u.test(decoded)) aiInput = decoded;
      } catch (_) {}
      if (!aiInput) {
        const maybe = extractJsonFromString(content);
        if (maybe) aiInput = JSON.stringify(maybe);
      }

      const aiRes = await parseSaiposWithAI(aiInput || content, filename || ('pasted-' + Date.now()));
      const aiParsed = aiRes?.parsed ?? null;
      const aiText = aiRes?.text ?? null;
      if (aiParsed && typeof aiParsed === 'object') {
        if (isValidNormalized(aiParsed)) return aiParsed;
        console.warn('previewNormalizedPayload: AI returned payload that seems empty, falling back to local parser');
        if (aiText) console.warn('previewNormalizedPayload: AI raw response:', String(aiText).slice(0,2000));
        try { console.warn('previewNormalizedPayload: AI input snippet:', String(aiInput || content).slice(0,2000)); } catch(_){}
      } else {
        console.warn('previewNormalizedPayload: AI parser returned no JSON object, falling back to local parser');
        if (aiText) console.warn('previewNormalizedPayload: AI raw response:', String(aiText).slice(0,2000));
        try { console.warn('previewNormalizedPayload: AI input snippet:', String(aiInput || content).slice(0,2000)); } catch(_){}
      }
    } catch (e) {
      console.warn('previewNormalizedPayload: AI parser failed, falling back to local parser', e?.message || e);
    }
  }

  // reuse parsing logic: try JSON, base64, or extract embedded JSON
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    try {
      const buf = Buffer.from(content, 'base64');
      const decoded = buf.toString('utf8');
      try {
        parsed = JSON.parse(decoded);
      } catch (err2) {
        const maybe = extractJsonFromString(decoded);
        if (maybe) parsed = maybe;
        else {
          const maybe2 = extractJsonFromString(content);
          if (maybe2) parsed = maybe2;
          else throw new Error('Unable to parse content as JSON or extract JSON from decoded content');
        }
      }
    } catch (err) {
      const maybe = extractJsonFromString(content);
      if (maybe) parsed = maybe;
      else throw new Error('Unable to parse content as JSON or base64 or extract embedded JSON');
    }
  }

  const externalId = filename || 'pasted-' + Date.now();
  const normalized = normalizeSaiposPayload(parsed, externalId);
  return normalized;
}

export { startWatching, addOrUpdateCompanyPath, readConfig, previewNormalizedPayload };
