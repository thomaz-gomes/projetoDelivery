import { prisma } from '../prisma.js';
import { evoSendText, evoSendLocation, normalizePhone, isBrServiceNumber } from '../wa.js';
import { emitirInboxNewMessage } from '../socketEmitters.js';
import { evoGetStatus } from '../wa.js';
import whatsappMetaAdapter from '../messaging/adapters/whatsappMeta.adapter.js';
import { MetaWindowExpiredError } from '../messaging/adapters/base.adapter.js';

// Previously we gated customer notifications behind ENABLE_IFOOD_WHATSAPP_NOTIFICATIONS.
// To ensure customers reliably receive messages for created/updated orders,
// notifications will attempt delivery when a connected WhatsApp instance exists
// and a valid customer phone is present. Toggle can still be controlled by
// disabling Evolution integration entirely (`EVOLUTION_ENABLED=false`).

function fmtCurrency(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// True when the company has explicitly disabled a given notification key
// (one of EM_PREPARO, SAIU_PARA_ENTREGA, ..., RIDER_ASSIGNED, CASHBACK_CREDIT).
function isNotifyDisabled(company, key) {
  const list = company?.orderNotifyDisabled;
  return Array.isArray(list) && list.includes(key);
}

// extrai coordenadas do payload do iFood (ou do model) e valida
function extractCoords(order) {
  const p = order?.payload?.delivery?.deliveryAddress?.coordinates || {};
  const latP = Number(p.latitude);
  const lngP = Number(p.longitude);
  if (Number.isFinite(latP) && Number.isFinite(lngP)) {
    // treat 0,0 as missing coordinates (some providers use 0,0 as placeholder)
    if (latP === 0 && lngP === 0) return { lat: null, lng: null };
    return { lat: latP, lng: lngP };
  }
  // fallback: campos do model (preenchidos pelo webhook)
  const lat = Number(order.latitude);
  const lng = Number(order.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (lat === 0 && lng === 0) return { lat: null, lng: null };
    return { lat, lng };
  }
  return { lat: null, lng: null };
}

function buildAddress(order) {
  const addr = order?.payload?.delivery?.deliveryAddress || {};
  const parts = [
    addr.formattedAddress,
    [addr.streetName, addr.streetNumber].filter(Boolean).join(', '),
    addr.complement,
    addr.neighborhood,
    addr.city,
    addr.state,
    addr.postalCode,
  ].filter(Boolean);
  const seen = new Set();
  return parts.filter(p => {
    const k = String(p).trim().toLowerCase();
    if (seen.has(k)) return false; seen.add(k); return true;
  }).join(' - ');
}

function buildMapsLinkFromCoords(lat, lng) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

function buildMapsLinkFallback(order) {
  const addr = buildAddress(order) || order.address || '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}

async function formatDisplayNumber(order) {
  // Prefer persisted or computed `displaySimple` (numeric short visual id),
  // format as #09 when available. If missing, compute a stable short number
  // by counting orders created up to this one on the same day.
  try {
    if (!order) return '';
    if (order.displaySimple != null && order.displaySimple !== '') {
      const s = String(order.displaySimple).padStart(2, '0');
      return `#${s}`;
    }
    if (order.displayId != null && order.displayId !== '') {
      return `#${String(order.displayId)}`;
    }

    // Try to compute displaySimple from DB when we have companyId and createdAt
    if (order.companyId && order.createdAt) {
      try {
        const d = new Date(order.createdAt);
        const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const count = await prisma.order.count({ where: { companyId: order.companyId, createdAt: { gte: startOfDay, lte: d } } });
        const s = String(count).padStart(2, '0');
        return `#${s}`;
      } catch (e) {
        // ignore and fallback
      }
    }

    if (order.id) return `#${String(order.id).slice(0,6)}`;
    return '';
  } catch (e) { return String(order.id || '').slice(0,6); }
}

// ---------------------------------------------------------------------------
// Outbound message persistence
// ---------------------------------------------------------------------------
// All notify functions below send WhatsApp text via evoSendText but used to
// stop there — the attendant's inbox never saw the system messages. We now
// persist each outbound text into the same Conversation/Message tables the
// inbox UI reads from, mirroring the webhook (inbound) and inbox.js (manual
// send) patterns.

// Build the variants of a normalized BR phone that we should look up before
// creating a fresh conversation, so a single customer is not split across
// multiple rows when the stored number is missing the DDI or the 9th digit.
function buildPhoneVariants(normalized) {
  const variants = new Set();
  if (!normalized) return [];
  variants.add(normalized);
  if (normalized.startsWith('55')) {
    const rest = normalized.slice(2);
    variants.add(rest); // without DDI
    if (rest.length === 11 && rest[2] === '9') {
      const ddd = rest.slice(0, 2);
      variants.add(`55${ddd}${rest.slice(3)}`); // with DDI, no 9th digit
      variants.add(`${ddd}${rest.slice(3)}`);   // without DDI and 9th digit
    } else if (rest.length === 10) {
      const ddd = rest.slice(0, 2);
      variants.add(`55${ddd}9${rest.slice(2)}`); // add 9th digit
      variants.add(`${ddd}9${rest.slice(2)}`);
    }
  }
  return [...variants];
}

async function persistOutboundWhatsappMessage({
  companyId,
  provider = 'EVOLUTION_WA',
  providerAccountId = null,
  instanceName = null,
  phone,
  text,
  externalId = null,
  customerId = null,
  contactName = null,
  menuId = null,
  storeId = null,
}) {
  if (!companyId || !phone || !text) return null;
  const normalized = String(phone).startsWith('55') ? String(phone) : normalizePhone(phone);
  if (!normalized) return null;
  const variants = buildPhoneVariants(normalized);

  try {
    // Match the (companyId, channel, channelContactId, providerAccountId)
    // unique key so the outbound lands in the same conversation as the
    // corresponding inbound — same channel and same WhatsApp account.
    let conversation = await prisma.conversation.findFirst({
      where: {
        companyId,
        channel: 'WHATSAPP',
        channelContactId: { in: variants },
        providerAccountId,
      },
    });

    if (!conversation) {
      try {
        conversation = await prisma.conversation.create({
          data: {
            companyId,
            storeId,
            menuId,
            channel: 'WHATSAPP',
            channelContactId: normalized,
            instanceName,
            provider,
            providerAccountId,
            customerId,
            contactName,
            status: 'OPEN',
            lastMessageAt: new Date(),
            unreadCount: 0, // outbound — does not count as unread for the attendant
          },
        });
      } catch (e) {
        if (e?.code === 'P2002') {
          // Race: another concurrent notify created the conversation; re-fetch.
          conversation = await prisma.conversation.findFirst({
            where: {
              companyId,
              channel: 'WHATSAPP',
              channelContactId: { in: variants },
              providerAccountId,
            },
          });
        } else {
          throw e;
        }
      }
    }

    if (!conversation) return null;

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        body: text,
        externalId,
        status: 'SENT',
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    try { emitirInboxNewMessage({ companyId, conversation, message }); } catch (_) { /* socket optional */ }

    return { conversation, message };
  } catch (e) {
    console.warn('[notify.persistOutboundWhatsappMessage] failed:', e?.message || e);
    return null;
  }
}

export async function pickConnectedInstance(companyId, { menuId, storeId } = {}) {
  // 1. Prioridade: instância vinculada ao cardápio
  if (menuId) {
    const menu = await prisma.menu.findUnique({
      where: { id: menuId },
      select: { whatsappInstance: true },
    });
    if (menu?.whatsappInstance?.status === 'CONNECTED') return menu.whatsappInstance;
  }

  // 2. Fallback: instância vinculada à loja
  if (storeId) {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { whatsappInstance: true },
    });
    if (store?.whatsappInstance?.status === 'CONNECTED') return store.whatsappInstance;
  }

  // 3. Fallback: qualquer instância conectada da empresa
  let inst = await prisma.whatsAppInstance.findFirst({
    where: { companyId, status: 'CONNECTED' },
    orderBy: { createdAt: 'desc' },
  });
  if (inst) return inst;

  const all = await prisma.whatsAppInstance.findMany({ where: { companyId } });
  for (const i of all) {
    try {
      const st = await evoGetStatus(i.instanceName);
      if (st?.status) {
        await prisma.whatsAppInstance.update({
          where: { instanceName: i.instanceName },
          data: { status: st.status },
        });
        if (st.status === 'CONNECTED') inst = i;
      }
    } catch { /* ignore */ }
  }
  if (inst?.status !== 'CONNECTED') {
    inst = await prisma.whatsAppInstance.findFirst({
      where: { companyId, status: 'CONNECTED' },
      orderBy: { createdAt: 'desc' },
    });
  }
  return inst;
}

// Resolve which WhatsApp channel (Evolution or Meta) should send a notification.
// Order of preference:
//   1. Mirror the channel the customer most recently used (Conversation.provider).
//   2. Menu.primaryChannel (manual config when both Evolution and Meta linked).
//   3. Evolution-first default (backward compatibility).
//   4. Company-level fallback via legacy pickConnectedInstance.
//
// Returns { provider, account, fallbackEvolution } or null. The
// fallbackEvolution is set whenever the chosen provider is Meta AND an
// Evolution instance is also available on the same menu — used by
// sendNotificationText to recover when Meta hits the 24h window error.
async function pickNotificationChannel({ companyId, menuId, storeId, customerId }) {
  let menu = null;
  if (menuId) {
    menu = await prisma.menu.findUnique({
      where: { id: menuId },
      include: { whatsappInstance: true, metaWaAccount: true },
    });
  }
  const menuEvo = menu?.whatsappInstance?.status === 'CONNECTED' ? menu.whatsappInstance : null;
  const menuMeta = menu?.metaWaAccount || null;

  // 1. Mirror origin
  if (customerId) {
    const conv = await prisma.conversation.findFirst({
      where: {
        companyId,
        customerId,
        channel: 'WHATSAPP',
        ...(menuId ? { menuId } : storeId ? { storeId } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { provider: true },
    });
    if (conv?.provider === 'META_WA' && menuMeta) {
      return { provider: 'META_WA', account: menuMeta, fallbackEvolution: menuEvo };
    }
    if (conv?.provider === 'EVOLUTION_WA' && menuEvo) {
      return { provider: 'EVOLUTION_WA', account: menuEvo, fallbackEvolution: null };
    }
  }

  // 2. Manual preference
  if (menu?.primaryChannel === 'META_WA' && menuMeta) {
    return { provider: 'META_WA', account: menuMeta, fallbackEvolution: menuEvo };
  }
  if (menu?.primaryChannel === 'EVOLUTION_WA' && menuEvo) {
    return { provider: 'EVOLUTION_WA', account: menuEvo, fallbackEvolution: null };
  }

  // 3. Evolution-first default
  if (menuEvo) return { provider: 'EVOLUTION_WA', account: menuEvo, fallbackEvolution: null };
  if (menuMeta) return { provider: 'META_WA', account: menuMeta, fallbackEvolution: null };

  // 4. Legacy company-wide Evolution fallback — só roda quando NÃO há menuId.
  // Quando o pedido está vinculado a um cardápio específico (caso de orders
  // do iFood / cardápio próprio), enviar pela instância de OUTRO cardápio
  // ou loja gera atribuição errada da conversa no inbox (a conversa fica
  // ligada ao providerAccount usado, que pertence ao outro cardápio). Se
  // o cardápio do pedido não tem nenhuma instância vinculada (Evolution
  // nem Meta), preferimos NÃO enviar a recair em outro canal — operador
  // precisa configurar WhatsApp para o cardápio em questão.
  if (!menuId) {
    const legacy = await pickConnectedInstance(companyId, { storeId });
    if (legacy) return { provider: 'EVOLUTION_WA', account: legacy, fallbackEvolution: null };
  }

  return null;
}

// Send a TEXT notification via the provider chosen by pickNotificationChannel.
// If Meta returns MetaWindowExpiredError and a fallback Evolution instance is
// available, automatically retry via Evolution so the customer still gets the
// message. Returns { provider, providerAccountId, instanceName, externalId,
// fallbackUsed? } describing what actually went out — caller uses this to
// persist the OUTBOUND Message in the right Conversation.
async function sendNotificationText({ provider, account, to, text, fallbackEvolution = null }) {
  if (provider === 'META_WA') {
    try {
      const result = await whatsappMetaAdapter.sendMessage(account, to, { type: 'TEXT', text });
      return {
        provider: 'META_WA',
        providerAccountId: account.id,
        instanceName: null,
        externalId: result?.externalId || null,
      };
    } catch (err) {
      if (err instanceof MetaWindowExpiredError && fallbackEvolution) {
        console.warn('[notify] Meta 24h window expired — falling back to Evolution', { to });
        await evoSendText({ instanceName: fallbackEvolution.instanceName, to, text });
        return {
          provider: 'EVOLUTION_WA',
          providerAccountId: fallbackEvolution.id,
          instanceName: fallbackEvolution.instanceName,
          externalId: null,
          fallbackUsed: true,
        };
      }
      throw err;
    }
  }
  // EVOLUTION_WA
  await evoSendText({ instanceName: account.instanceName, to, text });
  return {
    provider: 'EVOLUTION_WA',
    providerAccountId: account.id,
    instanceName: account.instanceName,
    externalId: null,
  };
}

export async function notifyRiderAssigned(orderId, { overridePhone } = {}) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { rider: true, company: true, customer: true, menu: { select: { name: true } }, store: { select: { name: true } } },
    });
    if (!order) return;

    // Respect company-level evolution toggle: if disabled, do not send notifications
    if (!order.company || !order.company.evolutionEnabled) {
      console.log('[notifyRiderAssigned] Evolution notifications disabled for company', order.companyId);
      return;
    }

    if (isNotifyDisabled(order.company, 'RIDER_ASSIGNED')) {
      console.log('[notifyRiderAssigned] notification disabled');
      return;
    }

    // Rider notification goes to the rider's phone, so no customerId is
    // passed: mirror-origin doesn't apply for a third-party recipient.
    const channel = await pickNotificationChannel({
      companyId: order.companyId,
      menuId: order.menuId,
      storeId: order.storeId,
    });
    if (!channel) {
      console.warn('[notifyRiderAssigned] Sem canal WhatsApp configurado para company', order.companyId);
      return;
    }

    const phone = normalizePhone(overridePhone || order.rider?.whatsapp);
    if (!phone) {
      console.warn('[notifyRiderAssigned] Sem telefone do entregador para order', order.id);
      return;
    }

    const { lat, lng } = extractCoords(order);
    const addressText = buildAddress(order) || order.address || '-';
    const locator = order?.payload?.delivery?.deliveryAddress?.reference || '';

    // Mensagem de texto com link para Google Maps (coords primeiro, fallback endereço)
    const mapsLink = (Number.isFinite(lat) && Number.isFinite(lng))
      ? buildMapsLinkFromCoords(lat, lng)
      : (addressText && addressText !== '-' ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}` : '-');

    // Forma de pagamento (vários campos possíveis conforme payload/db)
    const paymentMethod = order?.payment?.method || order?.payment?.methodCode || order?.payload?.payment?.method || order?.payload?.payment?.methodCode || '';

    // Telefone a ser mostrado ao motoboy; se pedido vier do iFood, mostrar 0800
    const maybeSource = String(order.source || order.integration || order?.payload?.source || '').toLowerCase();
    const isIfood = maybeSource.includes('ifood') || Boolean(order?.payload?.ifood);
    // Build contact string for rider: always show 0800 for iFood orders,
    // but also include the customer's WhatsApp when available so the
    // rider can contact the customer directly if needed.
    const custWhatsapp = (order.customer && order.customer.whatsapp) || order.customerPhone || order?.payload?.customer?.phone?.number || '';
    const parts = [];
    if (isIfood) parts.push('0800');
    if (custWhatsapp) parts.push(custWhatsapp);
    const contactToShow = parts.length ? parts.join(' - ') : '-';

    const orderLabel = (await formatDisplayNumber(order)) || (order.displayId || order.id.slice(0, 6));
    const customerName = order.customerName || order.customerFullName || '-';
    // {{loja}} resolves to the menu (cardápio) name first — that's the brand
    // customers know from the public site. Store and company names are
    // fallbacks for legacy orders without a menu link.
    const shopName = order.menu?.name || order.store?.name || order.company?.name || 'sua loja';

    const DEFAULT_RIDER_TEMPLATE =
`*🚨 Nova entrega atribuída* 🚀

*Pedido:* {{pedido}}
*Cliente:* {{cliente}}
*Endereço:* {{endereco}}
*Mapa:* {{mapa}}
*Localizador:* {{localizador}}
*Pagamento:* {{pagamento}}
*Contato:* {{contato}}`;

    const templates = (order.company?.orderNotifyTemplates && typeof order.company.orderNotifyTemplates === 'object')
      ? order.company.orderNotifyTemplates
      : {};
    const stored = Object.prototype.hasOwnProperty.call(templates, 'RIDER_ASSIGNED')
      ? String(templates.RIDER_ASSIGNED)
      : null;
    const raw = (stored && stored.trim()) ? stored : DEFAULT_RIDER_TEMPLATE;

    const text = raw
      .replace(/\{\{pedido\}\}/g, orderLabel)
      .replace(/\{\{cliente\}\}/g, customerName)
      .replace(/\{\{nome\}\}/g, customerName)
      .replace(/\{\{loja\}\}/g, shopName)
      .replace(/\{\{endereco\}\}/g, addressText)
      .replace(/\{\{mapa\}\}/g, mapsLink)
      .replace(/\{\{localizador\}\}/g, locator || '-')
      .replace(/\{\{pagamento\}\}/g, paymentMethod || '-')
      .replace(/\{\{contato\}\}/g, contactToShow);

    console.log('[notifyRiderAssigned] sending text', { provider: channel.provider, to: phone, snippet: String(text).slice(0,120) });
    let sent = null;
    try {
      sent = await sendNotificationText({
        provider: channel.provider,
        account: channel.account,
        to: phone,
        text,
        fallbackEvolution: channel.fallbackEvolution,
      });
      console.log('[notifyRiderAssigned] send result', { provider: sent.provider, fallbackUsed: !!sent.fallbackUsed });
      await persistOutboundWhatsappMessage({
        companyId: order.companyId,
        provider: sent.provider,
        providerAccountId: sent.providerAccountId,
        instanceName: sent.instanceName,
        phone,
        text,
        externalId: sent.externalId,
        customerId: order.customerId || null,
        contactName: order.customerName || null,
        menuId: order.menuId || null,
        storeId: order.storeId || null,
      });
    } catch (e) {
      console.error('[notifyRiderAssigned] sendText erro:', e.response?.data || e.message || String(e));
    }

    // PIN de localização (se coords válidas). Usa o mesmo canal do envio do texto.
    if (sent && Number.isFinite(lat) && Number.isFinite(lng)) {
      try {
        if (sent.provider === 'META_WA') {
          await whatsappMetaAdapter.sendMessage(channel.account, phone, {
            type: 'LOCATION',
            latitude: lat,
            longitude: lng,
            address: addressText,
          });
        } else {
          await evoSendLocation({
            instanceName: sent.instanceName,
            to: phone,
            latitude: lat,
            longitude: lng,
            address: addressText,
          });
        }
      } catch (e) {
        // Nem toda build / adapter suporta location; log e segue.
        console.warn('[notifyRiderAssigned] sendLocation falhou (ok se não suportar):', e.response?.data || e.message || String(e));
      }
    }
  } catch (e) {
    console.error('[notifyRiderAssigned] erro:', e.response?.data || e.message || e);
  }
}

export async function notifyCustomerStatus(orderId, newStatus) {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { company: true, store: true, menu: { select: { name: true } } } });
    if (!order) return;

    // Respect company-level evolution toggle: if disabled, do not send notifications
    if (!order.company || !order.company.evolutionEnabled) {
      console.log('[notifyCustomerStatus] Evolution notifications disabled for company', order.companyId);
      return;
    }

    if (isNotifyDisabled(order.company, newStatus)) {
      console.log('[notifyCustomerStatus] notification disabled for status', newStatus);
      return;
    }

    const phone = normalizePhone(
      order.customerPhone ||
      order?.payload?.customer?.phone?.number || ''
    );
    if (!phone) return;
    if (isBrServiceNumber(phone)) {
      console.log('[notifyCustomerStatus] skipping non-WhatsApp service number', phone);
      return;
    }

    const channel = await pickNotificationChannel({
      companyId: order.companyId,
      menuId: order.menuId,
      storeId: order.storeId,
      customerId: order.customerId || null,
    });
    if (!channel) {
      console.warn('[notifyCustomerStatus] Sem canal WhatsApp configurado para company', order.companyId);
      return;
    }

    const statusPt = {
      EM_PREPARO: 'em preparo',
      SAIU_PARA_ENTREGA: 'saiu para entrega',
      CONFIRMACAO_PAGAMENTO: 'em confirmação de pagamento',
      CONCLUIDO: 'concluído',
      CANCELADO: 'cancelado',
    }[newStatus] || newStatus;

    const customerName = order.customerName || order.customerFullName || '';
    // {{loja}} prefers the menu (cardápio) name — that's the brand the
    // customer associates with this order. Store/company are fallbacks.
    const shopName = order.menu?.name || order.store?.name || order.company?.name || 'sua loja';
    const shortId = (await formatDisplayNumber(order)) || order.displayId || String(order.id).slice(0, 8);

    const { lat, lng } = extractCoords(order);

    const DEFAULT_TEMPLATE =
`Olá {{nome}}, aqui é o atendente virtual do *{{loja}}* 👋

*Seu pedido foi atualizado:* *{{status}}* 🎯

Fique tranquilo(a) que vou enviar as atualizações do status do seu pedido por aqui. 😄

*️⃣ Nº do pedido:* {{pedido}}`;

    const templates = (order.company?.orderNotifyTemplates && typeof order.company.orderNotifyTemplates === 'object')
      ? order.company.orderNotifyTemplates
      : {};

    // Empty string = use default (not suppress). Backend no longer saves blank
    // templates, but legacy DB rows may still have empty strings.
    const stored = Object.prototype.hasOwnProperty.call(templates, newStatus)
      ? String(templates[newStatus])
      : null;
    const raw = (stored && stored.trim()) ? stored : DEFAULT_TEMPLATE;

    const text = raw
      .replace(/\{\{nome\}\}/g, customerName)
      .replace(/\{\{loja\}\}/g, shopName)
      .replace(/\{\{status\}\}/g, statusPt)
      .replace(/\{\{pedido\}\}/g, shortId);

    console.log('[notifyCustomerStatus] sending text', { provider: channel.provider, to: phone, snippet: String(text).slice(0,120) });
    try {
      const sent = await sendNotificationText({
        provider: channel.provider,
        account: channel.account,
        to: phone,
        text,
        fallbackEvolution: channel.fallbackEvolution,
      });
      console.log('[notifyCustomerStatus] send result', { provider: sent.provider, fallbackUsed: !!sent.fallbackUsed });
      await persistOutboundWhatsappMessage({
        companyId: order.companyId,
        provider: sent.provider,
        providerAccountId: sent.providerAccountId,
        instanceName: sent.instanceName,
        phone,
        text,
        externalId: sent.externalId,
        customerId: order.customerId || null,
        contactName: order.customerName || null,
        menuId: order.menuId || null,
        storeId: order.storeId || null,
      });
    } catch (e) {
      console.error('[notifyCustomerStatus] sendText erro:', e.response?.data || e.message || String(e));
    }

    // Not sending location PIN to customers by design — only riders receive PINs.
  } catch (e) {
    console.error('[notifyCustomerStatus] erro:', e.response?.data || e.message || e);
  }
}

export async function notifyCustomerOrderSummary(orderId) {
  // previously gated by ENABLE_IFOOD_WHATSAPP_NOTIFICATIONS; allow attempts
  // to send order summaries when a WhatsApp instance is available and the
  // order includes a customer phone number.
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, company: true, store: true, menu: { select: { name: true } } } });
    if (!order) return;

    // Respect company-level evolution toggle: if disabled, do not send notifications
    if (!order.company || !order.company.evolutionEnabled) {
      console.log('[notifyCustomerOrderSummary] Evolution notifications disabled for company', order.companyId);
      return;
    }

    if (isNotifyDisabled(order.company, 'ORDER_SUMMARY')) {
      console.log('[notifyCustomerOrderSummary] notification disabled');
      return;
    }

    const phone = normalizePhone(
      order.customerPhone ||
      order?.payload?.customer?.phone?.number || ''
    );
    if (!phone) return;
    if (isBrServiceNumber(phone)) {
      console.log('[notifyCustomerOrderSummary] skipping non-WhatsApp service number', phone);
      return;
    }

    const channel = await pickNotificationChannel({
      companyId: order.companyId,
      menuId: order.menuId,
      storeId: order.storeId,
      customerId: order.customerId || null,
    });
    if (!channel) {
      console.warn('[notifyCustomerOrderSummary] Sem canal WhatsApp configurado para company', order.companyId);
      return;
    }

    const customerName = order.customerName || order.customerFullName || '';
    // Prefer the menu (cardápio) name — matches the brand the customer
    // ordered from. Falls back to store, then company for legacy orders.
    const shopName = order.menu?.name || order.store?.name || order.company?.name || 'sua loja';
      const shortId = (await formatDisplayNumber(order)) || order.displayId || String(order.id).slice(0,8);

    const lines = [];
    lines.push(`Olá ${customerName || ''}, aqui é o atendente virtual do *${shopName}* 👋`);
    lines.push('');
    lines.push('*✅ Pedido recebido e em preparo*');
    lines.push('Vim te avisar que seu pedido foi realizado com sucesso e já está em preparo.');
    lines.push('');
    lines.push('Fique tranquilo(a) que vou enviar as atualizações do status do seu pedido por aqui. 😄');
    lines.push('');
      lines.push(`*️⃣ Nº do pedido:* ${shortId}`);
    lines.push('');
    lines.push('*Itens:*');
    for (const it of order.items || []) {
      lines.push(`➡ *${it.quantity}x ${it.name}*`);
      if (it.notes) {
        const notes = String(it.notes).split('\n').map(s => s.trim()).filter(Boolean);
        for (const n of notes) lines.push(`-${n}`);
      }
      if (it.options && Array.isArray(it.options)) {
        for (const opt of it.options) {
          const on = opt.name || (opt.optionName) || null;
          if (on) lines.push(`- ${on}`);
        }
      }
    }

    // Order-level notes / obs
    const obs = order.notes || order.payload?.notes || order.payload?.rawPayload?.notes || null;
    if (obs) {
      lines.push('\n*OBS:* ' + String(obs));
    }

    // Payment method
    const paymentMethod = order?.payment?.method || order?.payment?.methodCode || order?.payload?.payment?.method || order?.payload?.payment?.methodCode || '';
    if (paymentMethod) lines.push('\n💸 *' + paymentMethod + '*');

    // ETA (best-effort)
    const eta = order.payload?.eta || order.payload?.estimatedDelivery || order.payload?.delivery?.estimatedTime || order.payload?.delivery?.timeWindow || null;
    if (eta) lines.push('\n🕢 *Tempo de entrega:* ' + String(eta));

    const addr = buildAddress(order) || order.address || '';
    if (addr) lines.push('\n🛵 *Local de entrega:* ' + addr);

    lines.push('\n*Total do pedido:* ' + fmtCurrency(order.total || 0));

    const text = lines.join('\n');

    console.log('[notifyCustomerOrderSummary] sending text', { provider: channel.provider, to: phone, snippet: String(text).slice(0,140) });
    try {
      const sent = await sendNotificationText({
        provider: channel.provider,
        account: channel.account,
        to: phone,
        text,
        fallbackEvolution: channel.fallbackEvolution,
      });
      console.log('[notifyCustomerOrderSummary] send result', { provider: sent.provider, fallbackUsed: !!sent.fallbackUsed });
      await persistOutboundWhatsappMessage({
        companyId: order.companyId,
        provider: sent.provider,
        providerAccountId: sent.providerAccountId,
        instanceName: sent.instanceName,
        phone,
        text,
        externalId: sent.externalId,
        customerId: order.customerId || null,
        contactName: order.customerName || null,
        menuId: order.menuId || null,
        storeId: order.storeId || null,
      });
    } catch (e) {
      console.error('[notifyCustomerOrderSummary] sendText erro:', e.response?.data || e.message || String(e));
    }
  } catch (e) {
    console.error('[notifyCustomerOrderSummary] erro:', e.response?.data || e.message || e);
  }
}

export async function notifyCashbackCredit(clientId, companyId, amount, newBalance) {
  try {
    const [customer, company] = await Promise.all([
      prisma.customer.findUnique({ where: { id: clientId }, select: { fullName: true, whatsapp: true } }),
      prisma.company.findUnique({ where: { id: companyId }, select: { name: true, evolutionEnabled: true, orderNotifyTemplates: true, orderNotifyDisabled: true } }),
    ]);
    if (!company?.evolutionEnabled) return;
    if (isNotifyDisabled(company, 'CASHBACK_CREDIT')) {
      console.log('[notifyCashbackCredit] notification disabled');
      return;
    }
    const phone = normalizePhone(customer?.whatsapp || '');
    if (!phone) return;
    if (isBrServiceNumber(phone)) {
      console.log('[notifyCashbackCredit] skipping non-WhatsApp service number', phone);
      return;
    }
    // Try to resolve menuId/storeId from the customer's last order — this
    // lets pickNotificationChannel mirror the channel the customer used and
    // respect the menu's primaryChannel preference. Falls back to company-
    // wide selection if no prior order context.
    let lastOrderMenuId = null;
    let lastOrderStoreId = null;
    try {
      const lastOrder = await prisma.order.findFirst({
        where: { customerId: clientId, companyId },
        orderBy: { createdAt: 'desc' },
        select: { menuId: true, storeId: true },
      });
      lastOrderMenuId = lastOrder?.menuId || null;
      lastOrderStoreId = lastOrder?.storeId || null;
    } catch (_) { /* best-effort */ }

    const channel = await pickNotificationChannel({
      companyId,
      menuId: lastOrderMenuId,
      storeId: lastOrderStoreId,
      customerId: clientId,
    });
    if (!channel) {
      console.warn('[notifyCashbackCredit] Sem canal WhatsApp configurado para company', companyId);
      return;
    }

    const DEFAULT_CASHBACK_TEMPLATE =
`Olá {{nome}}, aqui é o atendente virtual do *{{loja}}* 👋

🎉 *Você ganhou cashback!*

*Valor ganho:* {{ganhou}}
*Seu saldo total:* {{saldo}}

Use seu cashback no próximo pedido. 😊`;

    const templates = (company?.orderNotifyTemplates && typeof company.orderNotifyTemplates === 'object')
      ? company.orderNotifyTemplates
      : {};
    const raw = Object.prototype.hasOwnProperty.call(templates, 'CASHBACK_CREDIT')
      ? String(templates['CASHBACK_CREDIT'])
      : DEFAULT_CASHBACK_TEMPLATE;

    if (!raw.trim()) return;

    // Display name for the {{loja}} placeholder: prefer the cardápio from
    // the customer's last order (matches the brand they remember), fall
    // back to company name when no order context exists.
    let menuName = null;
    if (lastOrderMenuId || lastOrderStoreId) {
      try {
        const orderCtx = await prisma.order.findFirst({
          where: { customerId: clientId, companyId },
          orderBy: { createdAt: 'desc' },
          select: { menu: { select: { name: true } }, store: { select: { name: true } } },
        });
        menuName = orderCtx?.menu?.name || orderCtx?.store?.name || null;
      } catch (_) { /* best-effort */ }
    }

    const text = raw
      .replace(/\{\{nome\}\}/g, customer?.fullName || '')
      .replace(/\{\{loja\}\}/g, menuName || company?.name || 'sua loja')
      .replace(/\{\{ganhou\}\}/g, fmtCurrency(amount))
      .replace(/\{\{saldo\}\}/g, fmtCurrency(newBalance));

    console.log('[notifyCashbackCredit] sending text', { provider: channel.provider, to: phone, snippet: String(text).slice(0, 120) });
    try {
      const sent = await sendNotificationText({
        provider: channel.provider,
        account: channel.account,
        to: phone,
        text,
        fallbackEvolution: channel.fallbackEvolution,
      });
      await persistOutboundWhatsappMessage({
        companyId,
        provider: sent.provider,
        providerAccountId: sent.providerAccountId,
        instanceName: sent.instanceName,
        phone,
        text,
        externalId: sent.externalId,
        customerId: customer?.id || null,
        contactName: customer?.fullName || null,
        menuId: lastOrderMenuId,
        storeId: lastOrderStoreId,
      });
    } catch (e) {
      console.error('[notifyCashbackCredit] sendText erro:', e.response?.data || e.message || String(e));
    }
  } catch (e) {
    console.error('[notifyCashbackCredit] erro:', e.response?.data || e.message || e);
  }
}