// src/routes/webhookEvolution.js
// Public webhook endpoint for Evolution API v2 events (no JWT auth)
import { Router } from 'express';
import { prisma } from '../prisma.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { evoSendText, evoSendMediaUrl, evoSendButtons } from '../wa.js';
import { renderQuickReplyVariables } from '../utils/quickReplyVars.js';
import { renderRemindLastOrderTemplate, buildReorderMagicLink } from '../services/reorderHelpers.js';

function isStoreOpen(store) {
  if (!store) return true;
  if (store.open24Hours) return true;
  const schedule = store.weeklySchedule;
  if (!schedule || !Array.isArray(schedule)) return true;

  const tz = store.timezone || 'America/Sao_Paulo';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const dayOfWeek = now.getDay();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const hhmm = `${hh}:${mm}`;

  const today = schedule.find(s => Number(s.day) === dayOfWeek);
  if (!today || !today.enabled) return false;
  if (!today.from || !today.to) return true;
  return hhmm >= today.from && hhmm <= today.to;
}

function detectMessageTypeFromMime(mime) {
  if (!mime) return 'DOCUMENT';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

// Accepts a QuickReply-like object: { body, mediaUrl, mediaMimeType, mediaFileName }.
// Sends media+caption if mediaUrl present, else text-only. Persists outbound Message.
async function sendAutoReply(conversation, instanceName, quickReply) {
  if (!quickReply) return;
  const hasBody = quickReply.body && quickReply.body.trim();
  const hasMedia = !!quickReply.mediaUrl;
  if (!hasBody && !hasMedia) return;

  // Resolve {{nome}} / {{cashback}} / {{endereco}} for the conversation's customer
  const resolvedBody = hasBody
    ? await renderQuickReplyVariables(quickReply.body.trim(), { conversation, companyId: conversation.companyId })
    : '';

  try {
    if (hasMedia) {
      const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || '';
      await evoSendMediaUrl({
        instanceName,
        to: conversation.channelContactId,
        mediaUrl: `${baseUrl}${quickReply.mediaUrl}`,
        filename: quickReply.mediaFileName || 'arquivo',
        mimeType: quickReply.mediaMimeType,
        caption: resolvedBody,
      });
    } else {
      await evoSendText({ instanceName, to: conversation.channelContactId, text: resolvedBody });
    }
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: hasMedia ? detectMessageTypeFromMime(quickReply.mediaMimeType) : 'TEXT',
        body: hasBody ? resolvedBody : null,
        mediaUrl: quickReply.mediaUrl || null,
        mediaMimeType: quickReply.mediaMimeType || null,
        mediaFileName: quickReply.mediaFileName || null,
        status: 'SENT',
      },
    });
  } catch (e) {
    console.warn('[auto-reply] send failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Registered-customer greeting + remind-last-order button
// ---------------------------------------------------------------------------
// Template + magic-link helpers live in services/reorderHelpers.js so the
// inbox "Perguntar ao cliente" action and this webhook produce the same
// body and the same JWT.

// Returns true when a registered-customer greeting + (optionally) the
// remind-last-order button were sent. Returns false when the conversation is
// not associated with a registered customer or the menu has no registered
// greeting configured — caller falls back to the regular greeting.
async function maybeSendRegisteredGreeting({ conversation, menu, instanceName }) {
  if (!menu?.registeredGreetingReply) return false;
  if (!conversation?.customerId) return false;
  const customer = await prisma.customer.findUnique({
    where: { id: conversation.customerId },
    select: { id: true, fullName: true },
  });
  if (!customer) return false;

  // Trigger: customer has at least ONE order in the base, regardless of
  // status (CONCLUIDO, EM_PREPARO, CANCELADO, etc.). The customer record
  // alone is not enough — a customer auto-created on the first inbound
  // message would otherwise also receive the registered greeting.
  const orderCount = await prisma.order.count({
    where: { customerId: customer.id, companyId: conversation.companyId },
  });
  if (orderCount === 0) return false;

  // 1. Send the registered greeting (resolves {{nome}} etc the same way the
  // default greeting does).
  await sendAutoReply(conversation, instanceName, menu.registeredGreetingReply);

  // 2. If remind-last-order is enabled, follow with an interactive button
  // that points at the magic-link reorder flow. The "last order" used here
  // is the most recent CONCLUIDO — repeating a cancelled or in-progress
  // order has no use for the customer.
  if (menu.remindLastOrderEnabled) {
    const lastOrder = await prisma.order.findFirst({
      where: { customerId: customer.id, companyId: conversation.companyId, status: 'CONCLUIDO' },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    if (!lastOrder) return true; // greeting sent, no completed order to repeat
    const text = renderRemindLastOrderTemplate(menu.remindLastOrderTemplate, { customer, order: lastOrder });
    try {
      await evoSendButtons({
        instanceName,
        to: conversation.channelContactId,
        description: text,
        buttons: [{ id: `reorder:${lastOrder.id}`, displayText: 'Repetir pedido' }],
      });
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          body: text,
          status: 'SENT',
        },
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });
    } catch (e) {
      console.warn('[automations] remind-last-order button send failed:', e?.message || e);
    }
  }
  return true;
}

// Detects an inbound interactive-button reply across the Evolution payload
// shapes seen in the wild. Returns { buttonId, displayText } or null.
function extractButtonReplyInfo(messageContent) {
  if (!messageContent || typeof messageContent !== 'object') return null;
  const br = messageContent.buttonsResponseMessage
    || messageContent.templateButtonReplyMessage
    || messageContent.interactiveResponseMessage
    || null;
  if (!br) return null;
  const buttonId =
    br.selectedButtonId ||
    br.selectedId ||
    br.body?.text ||
    br.nativeFlowResponseMessage?.paramsJson ||
    null;
  const displayText =
    br.selectedDisplayText ||
    br.selectedText ||
    null;
  if (!buttonId && !displayText) return null;
  return { buttonId: String(buttonId || ''), displayText: displayText ? String(displayText) : null };
}

// Handles a "Repetir pedido" button click: validates the order belongs to
// the conversation's customer/company, then sends a follow-up text message
// with the magic-link URL. Persists the outbound message so the attendant
// sees it in the inbox alongside the customer's tap.
async function handleReorderButtonReply({ conversation, instanceName, buttonReply }) {
  if (!buttonReply?.buttonId?.startsWith('reorder:')) return false;
  const orderId = buttonReply.buttonId.slice('reorder:'.length).trim();
  if (!orderId) return false;

  const order = await prisma.order.findFirst({
    where: { id: orderId, companyId: conversation.companyId },
    select: { id: true, customerId: true, companyId: true },
  });
  if (!order) return false;
  // Defense: require the conversation's customer to match the order's customer.
  if (conversation.customerId && order.customerId && conversation.customerId !== order.customerId) {
    return false;
  }

  const link = buildReorderMagicLink({
    companyId: order.companyId,
    orderId: order.id,
    customerId: order.customerId,
  });
  if (!link) {
    console.warn('[reorder] magic link not built — PUBLIC_FRONTEND_URL not set');
    return false;
  }

  const text = `Pronto! Toque no link abaixo para revisar e confirmar seu pedido:\n\n${link}\n\nO link é válido por 24h.`;
  try {
    await evoSendText({ instanceName, to: conversation.channelContactId, text });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        body: text,
        status: 'SENT',
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  } catch (e) {
    console.warn('[reorder] failed to send magic link:', e?.message || e);
  }
  return true;
}

function timeInRange(current, start, end) {
  // current, start, end are "HH:MM" strings
  if (start <= end) {
    return current >= start && current < end;
  }
  // overnight: e.g. 22:00–06:00
  return current >= start || current < end;
}

function pickGreetingByTime(rules, timezone) {
  if (!rules || !rules.length) return null;
  const tz = timezone || 'America/Sao_Paulo';
  const currentTime = new Date().toLocaleTimeString('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).substring(0, 5); // "HH:MM"

  const sorted = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const rule of sorted) {
    if (timeInRange(currentTime, rule.startTime, rule.endTime)) {
      const qr = rule.quickReply;
      if ((qr.body && qr.body.trim()) || qr.mediaUrl) {
        return qr;
      }
    }
  }
  return null;
}

async function runAutomations(conversation, incomingMessage, menuId, instanceName) {
  if (!menuId) return;
  const menu = await prisma.menu.findUnique({
    where: { id: menuId },
    select: {
      id: true,
      weeklySchedule: true,
      open24Hours: true,
      timezone: true,
      outOfHoursReply: { select: { body: true, mediaUrl: true, mediaMimeType: true, mediaFileName: true } },
      greetingReply: { select: { body: true, mediaUrl: true, mediaMimeType: true, mediaFileName: true } },
      registeredGreetingReply: { select: { body: true, mediaUrl: true, mediaMimeType: true, mediaFileName: true } },
      remindLastOrderEnabled: true,
      remindLastOrderTemplate: true,
      greetingTimeRules: {
        select: {
          startTime: true,
          endTime: true,
          sortOrder: true,
          quickReply: { select: { body: true, mediaUrl: true, mediaMimeType: true, mediaFileName: true } },
        },
      },
      store: { select: { company: { select: { evolutionEnabled: true } } } },
    },
  });
  if (!menu) { console.warn('[automations] menu not found:', menuId); return; }
  if (!menu.store?.company?.evolutionEnabled) { console.log('[automations] evolutionEnabled=false — skipping'); return; }

  // 1. Greeting on first contact or after 6h inactivity (takes priority over out-of-hours)
  const activeGreeting = menu.greetingTimeRules?.length
    ? (pickGreetingByTime(menu.greetingTimeRules, menu.timezone) ?? menu.greetingReply)
    : menu.greetingReply;

  if (activeGreeting) {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recentInbound = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        createdAt: { gte: sixHoursAgo },
        id: { not: incomingMessage.id },
      },
      select: { id: true },
    });
    if (!recentInbound) {
      // Registered customer greeting takes precedence when configured.
      const registeredHandled = await maybeSendRegisteredGreeting({ conversation, menu, instanceName });
      if (registeredHandled) return;
      await sendAutoReply(conversation, instanceName, activeGreeting);
      return; // greeting covers first contact — skip out-of-hours for this message
    }
  }

  // 2. Out-of-hours for subsequent messages when store is closed
  if (menu.outOfHoursReply && !isStoreOpen(menu)) {
    await sendAutoReply(conversation, instanceName, menu.outOfHoursReply);
    return;
  }

  // 3. Keyword→tag matching (uses existing tags as keywords)
  try {
    const allTags = await prisma.$queryRaw`
      SELECT DISTINCT unnest(tags) as tag
      FROM "Conversation"
      WHERE "companyId" = ${conversation.companyId} AND array_length(tags, 1) > 0
    `;
    const bodyLower = String(incomingMessage.body || '').toLowerCase();
    if (bodyLower) {
      const matched = allTags
        .map(r => r.tag)
        .filter(t => t && bodyLower.includes(String(t).toLowerCase()));
      if (matched.length) {
        const currentTags = conversation.tags || [];
        const newTags = [...new Set([...currentTags, ...matched])];
        if (newTags.length !== currentTags.length) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { tags: newTags },
          });
        }
      }
    }
  } catch (e) {
    console.warn('[automation] keyword match failed:', e.message);
  }
}

const router = Router();

// ─── Security ───────────────────────────────────────────────────────────────
// Evolution API v2 does NOT send apikey header on webhook calls.
// Validation is done inside handlers by checking instanceName exists in our DB.
// If apikey header IS present (e.g. manual test), validate it as extra layer.
router.use((req, res, next) => {
  const expected = process.env.EVOLUTION_API_API_KEY;
  const provided = req.headers['apikey'] || req.headers['Apikey'] || req.query.apikey;
  if (provided && expected && provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ─── Main webhook handler ───────────────────────────────────────────────────
// Evolution API v2 appends event name to URL when webhookByEvents is true
// e.g. /webhook/evolution/messages-upsert
// Handle both / and /:eventName with a shared handler
async function webhookHandler(req, res) {
  try {
    const body = req.body || {};
    const event = body.event;
    const instanceName = body.instance || body.instanceName;

    if (!event || !instanceName) {
      return res.status(200).json({ ignored: true, reason: 'missing event or instance' });
    }

    switch (event) {
      case 'messages.upsert':
      case 'MESSAGES_UPSERT':
        await handleMessagesUpsert(req, body, instanceName);
        break;
      case 'messages.update':
      case 'MESSAGES_UPDATE':
        await handleMessagesUpdate(req, body, instanceName);
        break;
      case 'connection.update':
      case 'CONNECTION_UPDATE':
        await handleConnectionUpdate(body, instanceName);
        break;
      default:
        // Ignore unknown events silently
        break;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhookEvolution] Error processing webhook:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

router.post('/', webhookHandler);
router.post('/:eventName', webhookHandler);

// ─── MESSAGES_UPSERT ────────────────────────────────────────────────────────
async function handleMessagesUpsert(req, body, instanceName) {
  const data = body.data || body;
  // Evolution v2 may send a single message object or an array
  const messages = Array.isArray(data) ? data : [data];

  for (const msg of messages) {
    try {
      await processSingleMessage(req, msg, instanceName);
    } catch (err) {
      console.error('[webhookEvolution] Error processing message:', err);
    }
  }
}

async function processSingleMessage(req, msg, instanceName) {
  const key = msg.key || {};
  const remoteJid = key.remoteJid || '';

  // Skip group, broadcast, and status messages
  if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast') || remoteJid === 'status@broadcast') {
    return;
  }

  // Skip protocol and reaction messages
  const messageContent = msg.message || {};
  if (messageContent.protocolMessage || messageContent.reactionMessage) {
    return;
  }

  // Extract phone from remoteJid
  const phone = remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '');
  if (!phone) return;

  // Look up WhatsAppInstance
  const waInstance = await prisma.whatsAppInstance.findUnique({
    where: { instanceName },
    include: {
      menus: { select: { id: true, storeId: true }, take: 1 },
      stores: { select: { id: true }, take: 1 },
    },
  });
  if (!waInstance) {
    console.warn(`[webhookEvolution] Unknown instance: ${instanceName}`);
    return;
  }

  const companyId = waInstance.companyId;
  // Prefer menu-based linkage; fall back to legacy store-based linkage
  const menuId = waInstance.menus.length > 0 ? waInstance.menus[0].id : null;
  const storeId = menuId
    ? (waInstance.menus[0].storeId || null)
    : (waInstance.stores.length > 0 ? waInstance.stores[0].id : null);

  // Normalize phone: always store with DDI 55
  // Brazilian mobile numbers: WhatsApp may send without the 9th digit
  // e.g. WA sends 557391429676 but system has 5573991429676 (with extra 9)
  const normalizedPhone = phone.startsWith('55') ? phone : '55' + phone;
  const phoneVariants = new Set([phone, normalizedPhone]);
  if (phone.startsWith('55')) phoneVariants.add(phone.slice(2));

  // Build variants with/without the 9th digit for Brazilian mobile numbers
  // Format: 55 + DDD(2) + 9? + number(8) → total 12 or 13 digits
  const withoutDDI = normalizedPhone.slice(2); // remove 55
  const ddd = withoutDDI.slice(0, 2);
  const rest = withoutDDI.slice(2);
  if (rest.length === 8) {
    // WA sent without 9 → add 9: 55 + DDD + 9 + 8digits
    const withNine = `55${ddd}9${rest}`;
    phoneVariants.add(withNine);
    phoneVariants.add(withNine.slice(2)); // without DDI
  } else if (rest.length === 9 && rest.startsWith('9')) {
    // WA sent with 9 → also search without: 55 + DDD + 8digits
    const withoutNine = `55${ddd}${rest.slice(1)}`;
    phoneVariants.add(withoutNine);
    phoneVariants.add(withoutNine.slice(2)); // without DDI
  }
  const phoneVariantsArr = [...phoneVariants];

  // Find or create Conversation (search with phone variants)
  let conversation = await prisma.conversation.findFirst({
    where: {
      companyId,
      channel: 'WHATSAPP',
      channelContactId: { in: phoneVariantsArr },
    },
  });

  // Auto-link customer if phone matches (try all variants: with/without DDI, with/without 9th digit)
  let customerId = conversation?.customerId || null;
  if (!customerId) {
    const customer = await prisma.customer.findFirst({
      where: { companyId, whatsapp: { in: phoneVariantsArr } },
      select: { id: true, whatsapp: true },
    });
    if (customer) {
      customerId = customer.id;
      // Normalize stored whatsapp to full format with DDI + 9 digit
      if (customer.whatsapp !== normalizedPhone) {
        await prisma.customer.update({ where: { id: customer.id }, data: { whatsapp: normalizedPhone } }).catch(() => {});
      }
    }
  }

  // Auto-create customer on first inbound message
  const isFromMe = !!key.fromMe;
  const pushName = msg.pushName || null;
  if (!customerId && !isFromMe) {
    try {
      const newCustomer = await prisma.customer.create({
        data: {
          companyId,
          fullName: pushName || null,
          whatsapp: normalizedPhone,
        },
      });
      customerId = newCustomer.id;
    } catch (e) {
      if (e.code === 'P2002') {
        const existing = await prisma.customer.findFirst({
          where: { companyId, whatsapp: { in: phoneVariantsArr } },
          select: { id: true },
        });
        if (existing) customerId = existing.id;
      } else {
        console.warn('[webhook-evolution] Failed to auto-create customer:', e.message);
      }
    }
  }

  // Extract contact name from pushName
  const contactName = msg.pushName || null;

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        companyId,
        storeId,
        menuId,
        channel: 'WHATSAPP',
        channelContactId: normalizedPhone,
        instanceName,
        customerId,
        contactName,
        status: 'OPEN',
        lastMessageAt: new Date(),
        unreadCount: key.fromMe ? 0 : 1,
      },
    });
  }

  // Determine message type and extract body/media
  const { type, body: textBody, mediaUrl: evoMediaUrl, mediaMimeType, mediaFileName } = extractMessageInfo(messageContent);

  // Build external ID from message key
  const externalId = key.id || null;

  // Check for duplicate
  if (externalId) {
    const existing = await prisma.message.findFirst({
      where: { externalId },
    });
    if (existing) return;
  }

  // Download media via Evolution API decryption (URLs are encrypted WhatsApp blobs)
  let localMediaUrl = null;
  if (type !== 'TEXT' && type !== 'LOCATION') {
    try {
      // Try base64 already in payload first (when webhookBase64: true)
      const inlineBase64 =
        messageContent.base64 ||
        messageContent.imageMessage?.base64 ||
        messageContent.audioMessage?.base64 ||
        messageContent.videoMessage?.base64 ||
        messageContent.documentMessage?.base64 ||
        messageContent.documentWithCaptionMessage?.message?.documentMessage?.base64 ||
        messageContent.stickerMessage?.base64 ||
        msg.base64 ||
        null;

      if (inlineBase64) {
        localMediaUrl = await saveBase64Media(inlineBase64, companyId, mediaMimeType);
      } else {
        // Fall back to Evolution API decryption endpoint
        localMediaUrl = await downloadMediaViaEvolution(instanceName, msg, companyId, mediaMimeType);
      }
    } catch (err) {
      console.error('[webhookEvolution] Media download failed:', err.response?.data || err.message);
    }
  }

  const direction = key.fromMe ? 'OUTBOUND' : 'INBOUND';

  // Extract location data
  const locationMsg = messageContent.locationMessage;
  const latitude = locationMsg ? locationMsg.degreesLatitude : null;
  const longitude = locationMsg ? locationMsg.degreesLongitude : null;

  // Persist Message
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      externalId,
      direction,
      type,
      body: textBody || null,
      mediaUrl: localMediaUrl || null,
      mediaMimeType: mediaMimeType || null,
      mediaFileName: mediaFileName || null,
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
      status: direction === 'OUTBOUND' ? 'SENT' : 'DELIVERED',
    },
  });

  // Update conversation
  const updateData = {
    lastMessageAt: new Date(),
    instanceName,
  };

  // Update contactName if we got a pushName and conversation doesn't have one
  if (contactName && !conversation.contactName) {
    updateData.contactName = contactName;
  }

  // Link customer if found and not already linked
  if (customerId && !conversation.customerId) {
    updateData.customerId = customerId;
  }

  // Link store if resolved and not already linked
  if (storeId && !conversation.storeId) {
    updateData.storeId = storeId;
  }
  // Link menu if resolved and not already linked
  if (menuId && !conversation.menuId) {
    updateData.menuId = menuId;
  }

  if (direction === 'INBOUND') {
    updateData.unreadCount = { increment: 1 };
    // Reopen if closed
    if (conversation.status === 'CLOSED') {
      updateData.status = 'OPEN';
    }
  }

  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: updateData,
    include: {
      customer: { select: { id: true, fullName: true, whatsapp: true } },
      assignedUser: { select: { id: true, name: true } },
      store: { select: { id: true, name: true } },
    },
  });

  // Emit Socket.IO event with full conversation data.
  // Use room-scoped emit AND a broadcast fallback so it works even if a
  // socket failed to join the company room. Frontend filters by companyId.
  const io = req.app.get('io');
  if (io) {
    const room = `company_${companyId}`;
    const roomSockets = io.sockets.adapter.rooms.get(room);
    const roomSize = roomSockets ? roomSockets.size : 0;
    const roomIds = roomSockets ? [...roomSockets].join(',') : '';
    const totalConnected = io.sockets.sockets.size;
    console.log(`[inbox] emit inbox:new-message → room=${room} sockets=${roomSize} ids=[${roomIds}] totalConnected=${totalConnected} convId=${conversation.id}`);

    const payload = {
      conversationId: conversation.id,
      message,
      conversation: updatedConversation,
      companyId, // included so broadcast fallback can be filtered client-side
    };

    io.to(room).emit('inbox:new-message', payload);

    // Defense in depth: also broadcast so any frontend client (regardless of
    // room membership) can pick it up. Client must filter by companyId.
    io.emit('inbox:new-message:broadcast', payload);
  }

  // Run automations pipeline (best-effort, non-blocking).
  const effectiveMenuId = updatedConversation.menuId || menuId;
  if (direction === 'INBOUND' && effectiveMenuId) {
    // Detect an interactive-button reply (e.g. "Repetir pedido"). When a
    // recognised reorder button is tapped we send the follow-up magic link
    // and skip the regular greeting/keyword automation pipeline so the
    // customer is not greeted twice in the same minute.
    const buttonReply = extractButtonReplyInfo(messageContent);
    if (buttonReply) {
      handleReorderButtonReply({ conversation: updatedConversation, instanceName, buttonReply })
        .then((handled) => {
          if (!handled) {
            return runAutomations(updatedConversation, message, effectiveMenuId, instanceName);
          }
        })
        .catch(e => console.error('[reorder] error:', e));
    } else {
      runAutomations(updatedConversation, message, effectiveMenuId, instanceName).catch(e =>
        console.error('[automations] failed:', e)
      );
    }
  }
}

// ─── MESSAGES_UPDATE (status updates) ───────────────────────────────────────
async function handleMessagesUpdate(req, body, instanceName) {
  const data = body.data || body;
  const updates = Array.isArray(data) ? data : [data];

  for (const update of updates) {
    try {
      const key = update.key || {};
      const externalId = key.id;
      if (!externalId) continue;

      // Map Evolution status codes: 2=SENT, 3=DELIVERED, 4=READ, 5=READ
      const statusCode = update.status || update.update?.status;
      const statusMap = { 2: 'SENT', 3: 'DELIVERED', 4: 'READ', 5: 'READ' };
      const newStatus = statusMap[statusCode];
      if (!newStatus) continue;

      const message = await prisma.message.findFirst({
        where: { externalId },
        include: { conversation: { select: { companyId: true } } },
      });
      if (!message) continue;

      await prisma.message.update({
        where: { id: message.id },
        data: { status: newStatus },
      });

      // Emit Socket.IO event
      const io = req.app.get('io');
      if (io) {
        io.to(`company_${message.conversation.companyId}`).emit('inbox:message-status', {
          messageId: message.id,
          conversationId: message.conversationId,
          status: newStatus,
        });
      }
    } catch (err) {
      console.error('[webhookEvolution] Error processing message update:', err);
    }
  }
}

// ─── CONNECTION_UPDATE ──────────────────────────────────────────────────────
async function handleConnectionUpdate(body, instanceName) {
  const data = body.data || body;
  const state = (data.state || data.status || '').toUpperCase();

  const stateMap = {
    OPEN: 'CONNECTED',
    CONNECTED: 'CONNECTED',
    CLOSE: 'DISCONNECTED',
    CLOSED: 'DISCONNECTED',
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'QRCODE',
    QRCODE: 'QRCODE',
  };

  const newStatus = stateMap[state];
  if (!newStatus) return;

  await prisma.whatsAppInstance.update({
    where: { instanceName },
    data: { status: newStatus },
  }).catch((err) => {
    console.warn(`[webhookEvolution] Could not update instance status for ${instanceName}:`, err.message);
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractMessageInfo(messageContent) {
  let type = 'TEXT';
  let body = null;
  let mediaUrl = null;
  let mediaMimeType = null;
  let mediaFileName = null;

  if (messageContent.imageMessage) {
    type = 'IMAGE';
    body = messageContent.imageMessage.caption || null;
    mediaUrl = messageContent.imageMessage.url;
    mediaMimeType = messageContent.imageMessage.mimetype || 'image/jpeg';
  } else if (messageContent.audioMessage) {
    type = 'AUDIO';
    mediaUrl = messageContent.audioMessage.url;
    mediaMimeType = messageContent.audioMessage.mimetype || 'audio/ogg';
  } else if (messageContent.videoMessage) {
    type = 'VIDEO';
    body = messageContent.videoMessage.caption || null;
    mediaUrl = messageContent.videoMessage.url;
    mediaMimeType = messageContent.videoMessage.mimetype || 'video/mp4';
  } else if (messageContent.documentWithCaptionMessage) {
    type = 'DOCUMENT';
    const docMsg = messageContent.documentWithCaptionMessage.message?.documentMessage || {};
    body = docMsg.caption || null;
    mediaUrl = docMsg.url;
    mediaMimeType = docMsg.mimetype || 'application/octet-stream';
    mediaFileName = docMsg.fileName || null;
  } else if (messageContent.documentMessage) {
    type = 'DOCUMENT';
    body = messageContent.documentMessage.caption || null;
    mediaUrl = messageContent.documentMessage.url;
    mediaMimeType = messageContent.documentMessage.mimetype || 'application/octet-stream';
    mediaFileName = messageContent.documentMessage.fileName || null;
  } else if (messageContent.locationMessage) {
    type = 'LOCATION';
    const loc = messageContent.locationMessage;
    body = loc.name || loc.address || `${loc.degreesLatitude},${loc.degreesLongitude}`;
  } else if (messageContent.stickerMessage) {
    type = 'STICKER';
    mediaUrl = messageContent.stickerMessage.url;
    mediaMimeType = messageContent.stickerMessage.mimetype || 'image/webp';
  } else {
    // Text messages
    body =
      messageContent.conversation ||
      messageContent.extendedTextMessage?.text ||
      null;
  }

  return { type, body, mediaUrl, mediaMimeType, mediaFileName };
}

function mimeToExtension(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/mpeg': 'mp3',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  return map[mime] || mime?.split('/')?.[1] || 'bin';
}

// Build a target file path and ensure the directory exists
function buildMediaTarget(companyId, mimeType) {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ext = mimeToExtension(mimeType);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const relDir = `uploads/inbox/${companyId}/${yearMonth}`;
  const absDir = path.join(process.cwd(), 'public', relDir);
  fs.mkdirSync(absDir, { recursive: true });
  return {
    filePath: path.join(absDir, filename),
    publicUrl: `/public/${relDir}/${filename}`,
  };
}

// Save inline base64 from webhook payload
async function saveBase64Media(base64, companyId, mimeType) {
  const { filePath, publicUrl } = buildMediaTarget(companyId, mimeType);
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(filePath, buffer);
  return publicUrl;
}

// Decrypt media via Evolution API endpoint
async function downloadMediaViaEvolution(instanceName, msg, companyId, mimeType) {
  const baseURL = process.env.EVOLUTION_API_BASE_URL;
  const apiKey = process.env.EVOLUTION_API_API_KEY;
  if (!baseURL || !apiKey) throw new Error('Evolution API not configured');

  // Evolution API v2: POST /chat/getBase64FromMediaMessage/{instance}
  // Body: { message: { key }, convertToMp4: false }
  const url = `${baseURL.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`;
  const { data } = await axios.post(
    url,
    { message: { key: msg.key }, convertToMp4: false },
    { headers: { apikey: apiKey, 'Content-Type': 'application/json' }, timeout: 30000 }
  );

  const base64 = data?.base64 || data?.media || data?.mediaBase64 || null;
  if (!base64) throw new Error('No base64 returned from Evolution API');

  return await saveBase64Media(base64, companyId, data?.mimetype || mimeType);
}

export default router;
