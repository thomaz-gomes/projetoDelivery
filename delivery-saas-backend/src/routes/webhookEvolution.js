// src/routes/webhookEvolution.js
// Public webhook endpoint for Evolution API v2 events (no JWT auth)
import { Router } from 'express';
import { prisma } from '../prisma.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
    include: { stores: { select: { id: true } } },
  });
  if (!waInstance) {
    console.warn(`[webhookEvolution] Unknown instance: ${instanceName}`);
    return;
  }

  const companyId = waInstance.companyId;
  const storeId = waInstance.stores.length > 0 ? waInstance.stores[0].id : null;

  // Find or create Conversation
  let conversation = await prisma.conversation.findUnique({
    where: {
      company_channel_contact: {
        companyId,
        channel: 'WHATSAPP',
        channelContactId: phone,
      },
    },
  });

  // Auto-link customer if phone matches
  let customerId = conversation?.customerId || null;
  if (!customerId) {
    const customer = await prisma.customer.findFirst({
      where: { companyId, whatsapp: phone },
      select: { id: true },
    });
    if (customer) customerId = customer.id;
  }

  // Auto-create customer on first inbound message
  const isFromMe = !!key.fromMe;
  const pushName = msg.pushName || null;
  if (!customerId && !isFromMe) {
    try {
      const newCustomer = await prisma.customer.create({
        data: {
          companyId,
          fullName: pushName || phone,
          whatsapp: phone,
        },
      });
      customerId = newCustomer.id;
    } catch (e) {
      if (e.code === 'P2002') {
        const existing = await prisma.customer.findFirst({
          where: { companyId, whatsapp: phone },
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
        channel: 'WHATSAPP',
        channelContactId: phone,
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

  // Download media if present
  let localMediaUrl = null;
  if (evoMediaUrl && type !== 'TEXT' && type !== 'LOCATION') {
    try {
      localMediaUrl = await downloadMedia(evoMediaUrl, companyId, mediaMimeType);
    } catch (err) {
      console.error('[webhookEvolution] Media download failed:', err.message);
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

  if (direction === 'INBOUND') {
    updateData.unreadCount = { increment: 1 };
    // Reopen if closed
    if (conversation.status === 'CLOSED') {
      updateData.status = 'OPEN';
    }
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: updateData,
  });

  // Emit Socket.IO event
  const io = req.app.get('io');
  if (io) {
    io.to(`company_${companyId}`).emit('inbox:new-message', {
      conversationId: conversation.id,
      message,
    });
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

async function downloadMedia(url, companyId, mimeType) {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ext = mimeToExtension(mimeType);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const relDir = `uploads/inbox/${companyId}/${yearMonth}`;
  const absDir = path.join(process.cwd(), 'public', relDir);

  // Ensure directory exists
  fs.mkdirSync(absDir, { recursive: true });

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  const filePath = path.join(absDir, filename);
  fs.writeFileSync(filePath, response.data);

  // Return public-accessible path
  return `/${relDir}/${filename}`;
}

export default router;
