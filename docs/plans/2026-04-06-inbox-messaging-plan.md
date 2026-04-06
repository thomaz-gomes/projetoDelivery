# Inbox de Atendimento Multicanal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a real-time messaging inbox integrated with Evolution API v2 (WhatsApp) that allows attendants to receive, reply, manage conversations, and quickly create orders/customers.

**Architecture:** Socket-First — Evolution API v2 webhooks → Express backend persists messages → Socket.IO emits to frontend in real-time. REST endpoints for history, CRUD operations, and media upload. Pinia store + Socket.IO on frontend for reactive UI.

**Tech Stack:** Express.js, Prisma/PostgreSQL, Socket.IO, multer, Evolution API v2, Vue 3 Composition API, Pinia, Bootstrap 5, Bootstrap Icons.

---

### Task 1: Prisma Schema — New Models & Enums

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add enums at the end of the schema file (before closing)**

Add these enums after the existing `MenuEventType` enum:

```prisma
enum Channel {
  WHATSAPP
  FACEBOOK
  INSTAGRAM
}

enum ConversationStatus {
  OPEN
  CLOSED
  ARCHIVED
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum MessageType {
  TEXT
  IMAGE
  AUDIO
  VIDEO
  DOCUMENT
  LOCATION
  STICKER
}

enum MessageStatus {
  PENDING
  SENT
  DELIVERED
  READ
  FAILED
}
```

**Step 2: Add the Conversation model**

```prisma
model Conversation {
  id               String             @id @default(uuid())
  companyId        String
  company          Company            @relation(fields: [companyId], references: [id])
  storeId          String?
  store            Store?             @relation(fields: [storeId], references: [id])
  channel          Channel
  channelContactId String
  instanceName     String?
  customerId       String?
  customer         Customer?          @relation(fields: [customerId], references: [id])
  assignedUserId   String?
  assignedUser     User?              @relation("ConversationAssignee", fields: [assignedUserId], references: [id])
  status           ConversationStatus @default(OPEN)
  lastMessageAt    DateTime?
  unreadCount      Int                @default(0)
  contactName      String?
  contactAvatarUrl String?
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt
  messages         Message[]

  @@unique([companyId, channel, channelContactId], name: "company_channel_contact")
  @@index([companyId, status, lastMessageAt])
  @@index([storeId, status])
}
```

**Step 3: Add the Message model**

```prisma
model Message {
  id              String           @id @default(uuid())
  conversationId  String
  conversation    Conversation     @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  externalId      String?
  direction       MessageDirection
  type            MessageType
  body            String?
  mediaUrl        String?
  mediaMimeType   String?
  mediaFileName   String?
  latitude        Float?
  longitude       Float?
  quotedMessageId String?
  status          MessageStatus    @default(SENT)
  createdAt       DateTime         @default(now())

  @@index([conversationId, createdAt])
  @@index([externalId])
}
```

**Step 4: Add the QuickReply model**

```prisma
model QuickReply {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  shortcut  String
  title     String
  body      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([companyId, shortcut])
  @@index([companyId])
}
```

**Step 5: Add relation fields to existing models**

In the `Company` model, add:
```prisma
  conversations    Conversation[]
  quickReplies     QuickReply[]
```

In the `Store` model, add:
```prisma
  conversations    Conversation[]
```

In the `Customer` model, add:
```prisma
  conversations    Conversation[]
```

In the `User` model, add:
```prisma
  assignedConversations Conversation[] @relation("ConversationAssignee")
```

**Step 6: Run prisma db push**

```bash
cd delivery-saas-backend && npx prisma db push
```

Expected: Schema synced, new tables created.

**Step 7: Regenerate Prisma client**

```bash
cd delivery-saas-backend && npx prisma generate
```

Expected: Prisma Client generated successfully.

**Step 8: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(inbox): add Conversation, Message, QuickReply models and enums"
```

---

### Task 2: Backend — Evolution API Webhook Handler

**Files:**
- Create: `delivery-saas-backend/src/routes/webhookEvolution.js`
- Modify: `delivery-saas-backend/src/index.js`

**Step 1: Create the webhook route file**

Create `delivery-saas-backend/src/routes/webhookEvolution.js`:

```javascript
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

const prisma = new PrismaClient();
const router = Router();

const EVOLUTION_API_KEY = process.env.EVOLUTION_API_API_KEY || '';

// Validate webhook authenticity
function validateApiKey(req, res, next) {
  const key = req.headers.apikey || req.query.apikey || '';
  if (EVOLUTION_API_KEY && key !== EVOLUTION_API_KEY) {
    return res.status(401).json({ message: 'Invalid apikey' });
  }
  next();
}

// Download media from Evolution API temporary URL
async function downloadMedia(url, companyId) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const ext = contentType.split('/')[1]?.split(';')[0] || 'bin';
    const now = new Date();
    const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dir = path.join(process.cwd(), 'public', 'uploads', 'inbox', companyId, monthDir);
    await fs.promises.mkdir(dir, { recursive: true });

    const filename = `${crypto.randomUUID()}.${ext}`;
    const filePath = path.join(dir, filename);
    await fs.promises.writeFile(filePath, Buffer.from(response.data));

    return {
      mediaUrl: `/public/uploads/inbox/${companyId}/${monthDir}/${filename}`,
      mediaMimeType: contentType,
    };
  } catch (e) {
    console.error('[webhook-evolution] Failed to download media:', e.message);
    return { mediaUrl: null, mediaMimeType: null };
  }
}

// Resolve storeId from instance
async function resolveStoreId(instanceName) {
  const inst = await prisma.whatsAppInstance.findUnique({
    where: { instanceName },
    include: { stores: { select: { id: true }, take: 1 } },
  });
  return inst?.stores?.[0]?.id || null;
}

// Map Evolution message type to our MessageType enum
function mapMessageType(msg) {
  if (msg.message?.imageMessage) return 'IMAGE';
  if (msg.message?.audioMessage) return 'AUDIO';
  if (msg.message?.videoMessage) return 'VIDEO';
  if (msg.message?.documentMessage || msg.message?.documentWithCaptionMessage) return 'DOCUMENT';
  if (msg.message?.locationMessage) return 'LOCATION';
  if (msg.message?.stickerMessage) return 'STICKER';
  return 'TEXT';
}

// Extract text body from Evolution message
function extractBody(msg) {
  return msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption
    || msg.message?.documentMessage?.caption
    || msg.message?.documentWithCaptionMessage?.message?.documentMessage?.caption
    || null;
}

// Extract media URL from Evolution message
function extractMediaUrl(msg) {
  return msg.message?.imageMessage?.url
    || msg.message?.audioMessage?.url
    || msg.message?.videoMessage?.url
    || msg.message?.documentMessage?.url
    || msg.message?.documentWithCaptionMessage?.message?.documentMessage?.url
    || msg.message?.stickerMessage?.url
    || null;
}

// Extract media filename
function extractMediaFileName(msg) {
  return msg.message?.documentMessage?.fileName
    || msg.message?.documentWithCaptionMessage?.message?.documentMessage?.fileName
    || null;
}

// Extract location
function extractLocation(msg) {
  const loc = msg.message?.locationMessage;
  if (!loc) return { latitude: null, longitude: null };
  return { latitude: loc.degreesLatitude, longitude: loc.degreesLongitude };
}

// MESSAGES_UPSERT handler
async function handleMessagesUpsert(instanceName, data, io) {
  const messages = Array.isArray(data) ? data : [data];

  for (const msg of messages) {
    try {
      // Skip status messages and protocol messages
      if (msg.key?.fromMe === undefined) continue;
      if (msg.key?.remoteJid?.endsWith('@g.us')) continue; // skip group messages
      if (msg.key?.remoteJid?.endsWith('@broadcast')) continue;
      if (msg.messageType === 'protocolMessage' || msg.messageType === 'reactionMessage') continue;

      const remoteJid = msg.key.remoteJid;
      const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
      const isFromMe = msg.key.fromMe;
      const pushName = msg.pushName || null;

      // Find the instance in DB
      const instance = await prisma.whatsAppInstance.findUnique({
        where: { instanceName },
        select: { companyId: true },
      });
      if (!instance) {
        console.warn(`[webhook-evolution] Instance not found: ${instanceName}`);
        continue;
      }
      const companyId = instance.companyId;
      const storeId = await resolveStoreId(instanceName);

      // Find or create conversation
      let conversation = await prisma.conversation.findUnique({
        where: { company_channel_contact: { companyId, channel: 'WHATSAPP', channelContactId: phone } },
      });

      // Try to match customer by whatsapp number
      let customerId = conversation?.customerId || null;
      if (!customerId) {
        const customer = await prisma.customer.findUnique({
          where: { company_whatsapp: { companyId, whatsapp: phone } },
          select: { id: true },
        });
        customerId = customer?.id || null;
      }

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            companyId,
            storeId,
            channel: 'WHATSAPP',
            channelContactId: phone,
            instanceName,
            customerId,
            status: 'OPEN',
            lastMessageAt: new Date(),
            unreadCount: isFromMe ? 0 : 1,
            contactName: pushName,
          },
        });
      } else {
        // Update conversation
        const updateData = {
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        };
        if (!isFromMe) {
          updateData.unreadCount = { increment: 1 };
          if (conversation.status === 'CLOSED') updateData.status = 'OPEN';
        }
        if (pushName && !conversation.contactName) updateData.contactName = pushName;
        if (customerId && !conversation.customerId) updateData.customerId = customerId;

        conversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: updateData,
        });
      }

      // Determine message type and download media if needed
      const type = mapMessageType(msg);
      const body = extractBody(msg);
      const evoMediaUrl = extractMediaUrl(msg);
      const { latitude, longitude } = extractLocation(msg);
      const mediaFileName = extractMediaFileName(msg);

      let localMedia = { mediaUrl: null, mediaMimeType: null };
      if (evoMediaUrl && type !== 'TEXT' && type !== 'LOCATION') {
        localMedia = await downloadMedia(evoMediaUrl, companyId);
      }

      // Check for duplicate by externalId
      const externalId = msg.key?.id || null;
      if (externalId) {
        const existing = await prisma.message.findFirst({ where: { externalId } });
        if (existing) continue; // skip duplicate
      }

      // Persist message
      const savedMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          externalId,
          direction: isFromMe ? 'OUTBOUND' : 'INBOUND',
          type,
          body,
          mediaUrl: localMedia.mediaUrl,
          mediaMimeType: localMedia.mediaMimeType,
          mediaFileName,
          latitude,
          longitude,
          status: 'DELIVERED',
        },
      });

      // Emit via Socket.IO
      if (io) {
        const payload = {
          conversationId: conversation.id,
          message: savedMessage,
          conversation: {
            id: conversation.id,
            channelContactId: conversation.channelContactId,
            contactName: conversation.contactName || pushName,
            channel: conversation.channel,
            storeId: conversation.storeId,
            customerId: conversation.customerId,
            status: conversation.status,
            lastMessageAt: conversation.lastMessageAt,
            unreadCount: conversation.unreadCount,
          },
        };
        io.to(`company_${companyId}`).emit('inbox:new-message', payload);
      }
    } catch (e) {
      console.error('[webhook-evolution] Error processing message:', e);
    }
  }
}

// MESSAGES_UPDATE handler (status updates: delivered, read)
async function handleMessagesUpdate(instanceName, data, io) {
  const updates = Array.isArray(data) ? data : [data];

  for (const upd of updates) {
    try {
      const externalId = upd.key?.id;
      if (!externalId) continue;

      const statusMap = { 2: 'SENT', 3: 'DELIVERED', 4: 'READ', 5: 'READ' };
      const newStatus = statusMap[upd.update?.status] || null;
      if (!newStatus) continue;

      const msg = await prisma.message.findFirst({ where: { externalId } });
      if (!msg) continue;

      await prisma.message.update({
        where: { id: msg.id },
        data: { status: newStatus },
      });

      if (io) {
        const conv = await prisma.conversation.findUnique({
          where: { id: msg.conversationId },
          select: { companyId: true },
        });
        if (conv) {
          io.to(`company_${conv.companyId}`).emit('inbox:message-status', {
            messageId: msg.id,
            conversationId: msg.conversationId,
            status: newStatus,
          });
        }
      }
    } catch (e) {
      console.error('[webhook-evolution] Error updating message status:', e);
    }
  }
}

// CONNECTION_UPDATE handler
async function handleConnectionUpdate(instanceName, data) {
  try {
    const state = (data?.state || data?.status || '').toUpperCase();
    const statusMap = { OPEN: 'CONNECTED', CLOSE: 'DISCONNECTED', CONNECTING: 'QRCODE' };
    const status = statusMap[state] || state || 'UNKNOWN';

    await prisma.whatsAppInstance.updateMany({
      where: { instanceName },
      data: { status },
    });
  } catch (e) {
    console.error('[webhook-evolution] Error updating connection:', e);
  }
}

// Main webhook endpoint
router.post('/', validateApiKey, async (req, res) => {
  try {
    const { event, instance, data } = req.body || {};
    const instanceName = instance?.instanceName || instance || null;

    if (!event || !instanceName) {
      return res.status(400).json({ message: 'Missing event or instance' });
    }

    // Get io instance from app
    const io = req.app.get('io');

    console.log(`[webhook-evolution] ${event} from ${instanceName}`);

    switch (event) {
      case 'messages.upsert':
        await handleMessagesUpsert(instanceName, data, io);
        break;
      case 'messages.update':
        await handleMessagesUpdate(instanceName, data, io);
        break;
      case 'connection.update':
        await handleConnectionUpdate(instanceName, data);
        break;
      default:
        console.log(`[webhook-evolution] Unhandled event: ${event}`);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[webhook-evolution] Webhook error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
```

**Step 2: Mount the webhook route in index.js**

In `delivery-saas-backend/src/index.js`, add the import near the other route imports:

```javascript
import webhookEvolutionRouter from './routes/webhookEvolution.js';
```

Mount it **before** the auth middleware (it's a public endpoint):

```javascript
app.use('/webhook/evolution', webhookEvolutionRouter);
```

Also, store the `io` instance on the app so routes can access it:

After `io = new Server(server, ...)` in the `attachSocket` function, add:

```javascript
app.set('io', io);
```

**Step 3: Register webhook on instance creation**

In `delivery-saas-backend/src/routes/whatsapp/wa.js`, after a successful instance creation, add webhook registration:

```javascript
// After instance is created and saved to DB, register the webhook
const backendUrl = process.env.BACKEND_URL || process.env.BASE_URL || '';
if (backendUrl) {
  try {
    await axios.put(
      `${process.env.EVOLUTION_API_BASE_URL}/webhook/set/${encodeURIComponent(instanceName)}`,
      {
        url: `${backendUrl}/webhook/evolution`,
        webhook_by_events: true,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
      },
      { headers: { apikey: process.env.EVOLUTION_API_API_KEY } }
    );
    console.log(`[wa] Webhook registered for ${instanceName}`);
  } catch (e) {
    console.warn(`[wa] Failed to register webhook for ${instanceName}:`, e.message);
  }
}
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/webhookEvolution.js delivery-saas-backend/src/index.js delivery-saas-backend/src/routes/whatsapp/wa.js
git commit -m "feat(inbox): add Evolution API v2 webhook handler for incoming messages"
```

---

### Task 3: Backend — Inbox REST API

**Files:**
- Create: `delivery-saas-backend/src/routes/inbox.js`
- Modify: `delivery-saas-backend/src/index.js`

**Step 1: Create the inbox routes file**

Create `delivery-saas-backend/src/routes/inbox.js`:

```javascript
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authMiddleware, requireRole } from '../auth.js';
import { evoSendText, evoSendDocument, evoSendMediaUrl, evoSendLocation } from '../wa.js';

const prisma = new PrismaClient();
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(authMiddleware);

// ─── LIST CONVERSATIONS ─────────────────────────────────────────────────────
router.get('/conversations', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { storeId, status, search, cursor, limit: rawLimit } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 100);

    const where = { companyId };
    if (storeId) where.storeId = storeId;
    if (status) where.status = status.toUpperCase();
    if (search) {
      where.OR = [
        { contactName: { contains: search, mode: 'insensitive' } },
        { channelContactId: { contains: search } },
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (cursor) where.lastMessageAt = { lt: new Date(cursor) };

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      include: {
        customer: { select: { id: true, fullName: true, whatsapp: true } },
        assignedUser: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    res.json(conversations);
  } catch (e) {
    console.error('[inbox] Error listing conversations:', e);
    res.status(500).json({ message: 'Erro ao listar conversas', error: e.message });
  }
});

// ─── GET CONVERSATION DETAIL ─────────────────────────────────────────────────
router.get('/conversations/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        customer: { select: { id: true, fullName: true, whatsapp: true, phone: true, email: true, cpf: true } },
        assignedUser: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
      },
    });
    if (!conversation) return res.status(404).json({ message: 'Conversa não encontrada' });
    res.json(conversation);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar conversa', error: e.message });
  }
});

// ─── GET MESSAGES (paginated) ────────────────────────────────────────────────
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { cursor, limit: rawLimit } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 100);

    // Verify conversation belongs to company
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!conv) return res.status(404).json({ message: 'Conversa não encontrada' });

    const where = { conversationId: req.params.id };
    if (cursor) where.createdAt = { lt: new Date(cursor) };

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json(messages);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar mensagens', error: e.message });
  }
});

// ─── SEND MESSAGE ────────────────────────────────────────────────────────────
router.post('/conversations/:id/send', upload.single('media'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { type, body, quotedMessageId } = req.body;

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!conversation) return res.status(404).json({ message: 'Conversa não encontrada' });
    if (conversation.channel !== 'WHATSAPP') {
      return res.status(400).json({ message: 'Canal não suportado para envio' });
    }

    const instanceName = conversation.instanceName;
    const to = conversation.channelContactId;

    let mediaUrl = null;
    let mediaMimeType = null;
    let mediaFileName = null;

    // Handle media upload
    if (req.file) {
      const now = new Date();
      const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const dir = path.join(process.cwd(), 'public', 'uploads', 'inbox', companyId, monthDir);
      await fs.promises.mkdir(dir, { recursive: true });

      const ext = path.extname(req.file.originalname) || '.bin';
      const filename = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(dir, filename);
      await fs.promises.writeFile(filePath, req.file.buffer);

      mediaUrl = `/public/uploads/inbox/${companyId}/${monthDir}/${filename}`;
      mediaMimeType = req.file.mimetype;
      mediaFileName = req.file.originalname;
    }

    // Send via Evolution API
    let evoResult;
    const msgType = (type || 'TEXT').toUpperCase();

    if (msgType === 'TEXT') {
      evoResult = await evoSendText({ instanceName, to, text: body });
    } else if (msgType === 'LOCATION') {
      const { latitude, longitude } = req.body;
      evoResult = await evoSendLocation({ instanceName, to, latitude: parseFloat(latitude), longitude: parseFloat(longitude) });
    } else if (req.file) {
      // For media, build absolute URL for Evolution API
      const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      evoResult = await evoSendMediaUrl({
        instanceName,
        to,
        mediaUrl: `${baseUrl}${mediaUrl}`,
        filename: mediaFileName,
        mimeType: mediaMimeType,
        caption: body || '',
      });
    }

    // Persist message
    const savedMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        externalId: evoResult?.key?.id || null,
        direction: 'OUTBOUND',
        type: msgType,
        body,
        mediaUrl,
        mediaMimeType,
        mediaFileName,
        latitude: msgType === 'LOCATION' ? parseFloat(req.body.latitude) : null,
        longitude: msgType === 'LOCATION' ? parseFloat(req.body.longitude) : null,
        quotedMessageId: quotedMessageId || null,
        status: 'SENT',
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    // Emit via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`company_${companyId}`).emit('inbox:message-sent', {
        conversationId: conversation.id,
        message: savedMessage,
      });
    }

    res.json({ ok: true, message: savedMessage });
  } catch (e) {
    console.error('[inbox] Error sending message:', e);
    res.status(500).json({ message: 'Erro ao enviar mensagem', error: e.message });
  }
});

// ─── UPDATE CONVERSATION (status, assign) ────────────────────────────────────
router.patch('/conversations/:id', requireRole('ADMIN', 'ATTENDANT'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { status, assignedUserId } = req.body;

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!conv) return res.status(404).json({ message: 'Conversa não encontrada' });

    const data = {};
    if (status) data.status = status.toUpperCase();
    if (assignedUserId !== undefined) data.assignedUserId = assignedUserId || null;

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data,
      include: {
        assignedUser: { select: { id: true, name: true } },
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`company_${companyId}`).emit('inbox:conversation-updated', { conversation: updated });
    }

    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar conversa', error: e.message });
  }
});

// ─── MARK AS READ ────────────────────────────────────────────────────────────
router.patch('/conversations/:id/read', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!conv) return res.status(404).json({ message: 'Conversa não encontrada' });

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { unreadCount: 0 },
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao marcar como lida', error: e.message });
  }
});

// ─── LINK CUSTOMER ───────────────────────────────────────────────────────────
router.post('/conversations/:id/link-customer', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { customerId } = req.body;

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!conv) return res.status(404).json({ message: 'Conversa não encontrada' });

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true, fullName: true },
    });
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { customerId },
      include: { customer: { select: { id: true, fullName: true, whatsapp: true } } },
    });

    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao vincular cliente', error: e.message });
  }
});

// ─── QUICK REPLIES CRUD ─────────────────────────────────────────────────────
router.get('/quick-replies', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const replies = await prisma.quickReply.findMany({
      where: { companyId },
      orderBy: { shortcut: 'asc' },
    });
    res.json(replies);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar respostas rápidas', error: e.message });
  }
});

router.post('/quick-replies', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { shortcut, title, body } = req.body;
    if (!shortcut || !title || !body) {
      return res.status(400).json({ message: 'shortcut, title e body são obrigatórios' });
    }

    const reply = await prisma.quickReply.create({
      data: { companyId, shortcut: shortcut.startsWith('/') ? shortcut : `/${shortcut}`, title, body },
    });
    res.status(201).json(reply);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Atalho já existe' });
    res.status(500).json({ message: 'Erro ao criar resposta rápida', error: e.message });
  }
});

router.put('/quick-replies/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { shortcut, title, body } = req.body;

    const existing = await prisma.quickReply.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Resposta rápida não encontrada' });

    const updated = await prisma.quickReply.update({
      where: { id: existing.id },
      data: {
        ...(shortcut && { shortcut: shortcut.startsWith('/') ? shortcut : `/${shortcut}` }),
        ...(title && { title }),
        ...(body && { body }),
      },
    });
    res.json(updated);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Atalho já existe' });
    res.status(500).json({ message: 'Erro ao atualizar resposta rápida', error: e.message });
  }
});

router.delete('/quick-replies/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.quickReply.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Resposta rápida não encontrada' });

    await prisma.quickReply.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao remover resposta rápida', error: e.message });
  }
});

export default router;
```

**Step 2: Mount the inbox routes in index.js**

In `delivery-saas-backend/src/index.js`, add:

```javascript
import inboxRouter from './routes/inbox.js';
```

Mount with module requirement:

```javascript
app.use('/inbox', requireModule('WHATSAPP'), inboxRouter);
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/inbox.js delivery-saas-backend/src/index.js
git commit -m "feat(inbox): add inbox REST API with conversations, messages, send, quick replies"
```

---

### Task 4: Backend — Socket.IO Room for Inbox

**Files:**
- Modify: `delivery-saas-backend/src/index.js`

**Step 1: Add inbox room join on identify**

In the `attachSocket` function in `index.js`, inside the `socket.on('identify', ...)` handler, after `socket.user = user` and `socket.join(company_${...})`, the socket already joins the company room. Since we emit inbox events to `company_{companyId}`, no additional room setup is needed — the existing `company_` room is reused.

No code changes needed for this step. The events `inbox:new-message`, `inbox:message-sent`, `inbox:message-status`, `inbox:conversation-updated` are all emitted to `company_{companyId}` which the socket already joins.

**Step 2: Commit** (skip if no changes)

---

### Task 5: Frontend — Pinia Inbox Store

**Files:**
- Create: `delivery-saas-frontend/src/stores/inbox.js`

**Step 1: Create the inbox store**

```javascript
import { defineStore } from 'pinia';
import api from '../api';

export const useInboxStore = defineStore('inbox', {
  state: () => ({
    conversations: [],
    activeConversationId: null,
    messages: {}, // { [conversationId]: Message[] }
    unreadTotal: 0,
    quickReplies: [],
    loading: false,
    filters: {
      storeId: null,
      status: 'OPEN',
      search: '',
    },
  }),

  getters: {
    activeConversation(state) {
      return state.conversations.find(c => c.id === state.activeConversationId) || null;
    },
    activeMessages(state) {
      if (!state.activeConversationId) return [];
      return state.messages[state.activeConversationId] || [];
    },
    filteredConversations(state) {
      return state.conversations; // already filtered by API query
    },
  },

  actions: {
    async fetchConversations() {
      this.loading = true;
      try {
        const params = {};
        if (this.filters.storeId) params.storeId = this.filters.storeId;
        if (this.filters.status) params.status = this.filters.status;
        if (this.filters.search) params.search = this.filters.search;

        const { data } = await api.get('/inbox/conversations', { params });
        if (Array.isArray(data)) {
          this.conversations = data;
        } else {
          console.warn('Unexpected /inbox/conversations response', data);
          this.conversations = [];
        }
        this.recalcUnread();
      } finally {
        this.loading = false;
      }
    },

    async fetchMessages(conversationId, cursor = null) {
      const params = { limit: 50 };
      if (cursor) params.cursor = cursor;

      const { data } = await api.get(`/inbox/conversations/${conversationId}/messages`, { params });
      const msgs = Array.isArray(data) ? data : [];

      if (cursor && this.messages[conversationId]) {
        // Append older messages
        this.messages[conversationId] = [...this.messages[conversationId], ...msgs];
      } else {
        // Messages come in desc order from API, reverse for display (oldest first)
        this.messages[conversationId] = msgs.reverse();
      }
      return msgs;
    },

    async sendMessage(conversationId, { type, body, mediaFile, quotedMessageId, latitude, longitude }) {
      const formData = new FormData();
      formData.append('type', type || 'TEXT');
      if (body) formData.append('body', body);
      if (mediaFile) formData.append('media', mediaFile);
      if (quotedMessageId) formData.append('quotedMessageId', quotedMessageId);
      if (latitude) formData.append('latitude', latitude);
      if (longitude) formData.append('longitude', longitude);

      const { data } = await api.post(`/inbox/conversations/${conversationId}/send`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },

    async markAsRead(conversationId) {
      await api.patch(`/inbox/conversations/${conversationId}/read`);
      const conv = this.conversations.find(c => c.id === conversationId);
      if (conv) {
        conv.unreadCount = 0;
        this.recalcUnread();
      }
    },

    async updateConversation(conversationId, updates) {
      const { data } = await api.patch(`/inbox/conversations/${conversationId}`, updates);
      const idx = this.conversations.findIndex(c => c.id === conversationId);
      if (idx >= 0) this.conversations[idx] = { ...this.conversations[idx], ...data };
      return data;
    },

    async linkCustomer(conversationId, customerId) {
      const { data } = await api.post(`/inbox/conversations/${conversationId}/link-customer`, { customerId });
      const idx = this.conversations.findIndex(c => c.id === conversationId);
      if (idx >= 0) this.conversations[idx] = { ...this.conversations[idx], ...data };
      return data;
    },

    async fetchQuickReplies() {
      const { data } = await api.get('/inbox/quick-replies');
      this.quickReplies = Array.isArray(data) ? data : [];
    },

    async createQuickReply(payload) {
      const { data } = await api.post('/inbox/quick-replies', payload);
      this.quickReplies.push(data);
      return data;
    },

    async updateQuickReply(id, payload) {
      const { data } = await api.put(`/inbox/quick-replies/${id}`, payload);
      const idx = this.quickReplies.findIndex(r => r.id === id);
      if (idx >= 0) this.quickReplies[idx] = data;
      return data;
    },

    async deleteQuickReply(id) {
      await api.delete(`/inbox/quick-replies/${id}`);
      this.quickReplies = this.quickReplies.filter(r => r.id !== id);
    },

    // Socket.IO event handlers
    handleNewMessage({ conversationId, message, conversation: convData }) {
      // Update or add conversation
      const idx = this.conversations.findIndex(c => c.id === conversationId);
      if (idx >= 0) {
        this.conversations[idx] = { ...this.conversations[idx], ...convData, messages: [message] };
        // Move to top
        const [conv] = this.conversations.splice(idx, 1);
        this.conversations.unshift(conv);
      } else {
        this.conversations.unshift({ ...convData, messages: [message] });
      }

      // Add message to active messages if viewing this conversation
      if (this.messages[conversationId]) {
        this.messages[conversationId].push(message);
      }

      this.recalcUnread();
    },

    handleMessageSent({ conversationId, message }) {
      if (this.messages[conversationId]) {
        // Avoid duplicate if webhook already added it
        const exists = this.messages[conversationId].find(m => m.id === message.id);
        if (!exists) {
          this.messages[conversationId].push(message);
        }
      }
    },

    handleMessageStatus({ messageId, conversationId, status }) {
      if (this.messages[conversationId]) {
        const msg = this.messages[conversationId].find(m => m.id === messageId);
        if (msg) msg.status = status;
      }
    },

    handleConversationUpdated({ conversation }) {
      const idx = this.conversations.findIndex(c => c.id === conversation.id);
      if (idx >= 0) {
        this.conversations[idx] = { ...this.conversations[idx], ...conversation };
      }
    },

    recalcUnread() {
      this.unreadTotal = this.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    },
  },
});
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/stores/inbox.js
git commit -m "feat(inbox): add Pinia inbox store with conversations, messages, quick replies"
```

---

### Task 6: Frontend — Inbox View & Components

**Files:**
- Create: `delivery-saas-frontend/src/views/inbox/Inbox.vue`
- Create: `delivery-saas-frontend/src/views/inbox/ConversationList.vue`
- Create: `delivery-saas-frontend/src/views/inbox/ConversationItem.vue`
- Create: `delivery-saas-frontend/src/views/inbox/ChatPanel.vue`
- Create: `delivery-saas-frontend/src/views/inbox/ChatBubble.vue`
- Create: `delivery-saas-frontend/src/views/inbox/AudioPlayer.vue`
- Create: `delivery-saas-frontend/src/views/inbox/ChatInput.vue`
- Create: `delivery-saas-frontend/src/views/inbox/QuickReplyPicker.vue`
- Create: `delivery-saas-frontend/src/views/inbox/ConversationHeader.vue`
- Create: `delivery-saas-frontend/src/views/inbox/LinkCustomerModal.vue`
- Create: `delivery-saas-frontend/src/views/inbox/AssignUserModal.vue`

This is a large task. Break into sub-steps:

**Step 1: Create `Inbox.vue` — main container**

The main 3-panel layout. Desktop: side-by-side. Mobile: show one at a time.

```vue
<template>
  <div class="d-flex" style="height: calc(100vh - 56px); overflow: hidden;">
    <!-- Conversation List Panel -->
    <div
      class="border-end bg-white"
      :class="{ 'd-none d-md-flex': activeConversationId }"
      style="width: 360px; min-width: 300px; flex-shrink: 0;"
    >
      <ConversationList @select="selectConversation" />
    </div>

    <!-- Chat Panel -->
    <div class="flex-grow-1 d-flex flex-column" v-if="activeConversationId">
      <ChatPanel
        :conversation-id="activeConversationId"
        @back="activeConversationId = null"
      />
    </div>

    <!-- Empty state -->
    <div v-else class="flex-grow-1 d-none d-md-flex align-items-center justify-content-center text-muted">
      <div class="text-center">
        <i class="bi bi-chat-left-dots" style="font-size: 3rem;"></i>
        <p class="mt-2">Selecione uma conversa</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '@/config';
import { useAuthStore } from '@/stores/auth';
import { useInboxStore } from '@/stores/inbox';
import ConversationList from './ConversationList.vue';
import ChatPanel from './ChatPanel.vue';

const auth = useAuthStore();
const inbox = useInboxStore();
const socket = ref(null);
const activeConversationId = computed({
  get: () => inbox.activeConversationId,
  set: (v) => { inbox.activeConversationId = v; },
});

// Beep sound for new messages
const beepAudio = new Audio('/sounds/notification.mp3');

function selectConversation(id) {
  inbox.activeConversationId = id;
  inbox.markAsRead(id).catch(() => {});
  if (!inbox.messages[id]) {
    inbox.fetchMessages(id);
  }
}

onMounted(async () => {
  await inbox.fetchConversations();
  await inbox.fetchQuickReplies();

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Socket.IO connection
  socket.value = io(SOCKET_URL, {
    transports: ['websocket'],
    timeout: 30000,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.value.on('connect', () => {
    socket.value.emit('identify', auth.token);
  });

  socket.value.on('inbox:new-message', (payload) => {
    inbox.handleNewMessage(payload);

    // Beep + browser notification for inbound messages
    if (payload.message?.direction === 'INBOUND') {
      try { beepAudio.play().catch(() => {}); } catch {}

      if ('Notification' in window && Notification.permission === 'granted') {
        const title = payload.conversation?.contactName || payload.conversation?.channelContactId || 'Nova mensagem';
        const body = payload.message?.body || 'Mídia recebida';
        new Notification(title, { body, icon: '/favicon.ico' });
      }
    }
  });

  socket.value.on('inbox:message-sent', (payload) => {
    inbox.handleMessageSent(payload);
  });

  socket.value.on('inbox:message-status', (payload) => {
    inbox.handleMessageStatus(payload);
  });

  socket.value.on('inbox:conversation-updated', (payload) => {
    inbox.handleConversationUpdated(payload);
  });
});

onUnmounted(() => {
  if (socket.value) socket.value.disconnect();
});
</script>
```

**Step 2: Create `ConversationList.vue`**

```vue
<template>
  <div class="d-flex flex-column h-100">
    <!-- Search & Filters -->
    <div class="p-2 border-bottom">
      <input
        type="text"
        class="form-control form-control-sm"
        placeholder="Buscar contato..."
        v-model="inbox.filters.search"
        @input="debouncedFetch"
      />
      <div class="d-flex gap-1 mt-2">
        <button
          v-for="s in statuses" :key="s.value"
          class="btn btn-sm"
          :class="inbox.filters.status === s.value ? 'btn-primary' : 'btn-outline-secondary'"
          @click="setFilter(s.value)"
        >{{ s.label }}</button>
      </div>
    </div>

    <!-- List -->
    <div class="flex-grow-1 overflow-auto">
      <div v-if="inbox.loading" class="text-center py-3">
        <div class="spinner-border spinner-border-sm"></div>
      </div>
      <ConversationItem
        v-for="conv in inbox.conversations"
        :key="conv.id"
        :conversation="conv"
        :active="conv.id === inbox.activeConversationId"
        @click="$emit('select', conv.id)"
      />
      <div v-if="!inbox.loading && !inbox.conversations.length" class="text-center text-muted py-4">
        Nenhuma conversa encontrada
      </div>
    </div>
  </div>
</template>

<script setup>
import { useInboxStore } from '@/stores/inbox';
import ConversationItem from './ConversationItem.vue';

const emit = defineEmits(['select']);
const inbox = useInboxStore();

const statuses = [
  { label: 'Abertas', value: 'OPEN' },
  { label: 'Fechadas', value: 'CLOSED' },
  { label: 'Todas', value: '' },
];

let debounceTimer = null;
function debouncedFetch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => inbox.fetchConversations(), 400);
}

function setFilter(status) {
  inbox.filters.status = status;
  inbox.fetchConversations();
}
</script>
```

**Step 3: Create `ConversationItem.vue`**

```vue
<template>
  <div
    class="d-flex align-items-center gap-2 px-3 py-2 border-bottom cursor-pointer"
    :class="{ 'bg-light': active }"
    style="cursor: pointer;"
    @click="$emit('click')"
  >
    <!-- Avatar -->
    <div
      class="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center flex-shrink-0"
      style="width: 40px; height: 40px; font-size: 0.85rem;"
    >
      {{ initials }}
    </div>

    <!-- Info -->
    <div class="flex-grow-1 overflow-hidden">
      <div class="d-flex justify-content-between align-items-center">
        <strong class="text-truncate" style="font-size: 0.9rem;">
          {{ displayName }}
        </strong>
        <small class="text-muted flex-shrink-0">{{ timeAgo }}</small>
      </div>
      <div class="d-flex justify-content-between align-items-center">
        <small class="text-muted text-truncate">{{ lastMessage }}</small>
        <span v-if="conversation.unreadCount" class="badge bg-success rounded-pill ms-1">
          {{ conversation.unreadCount }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  conversation: { type: Object, required: true },
  active: { type: Boolean, default: false },
});

defineEmits(['click']);

const displayName = computed(() => {
  return props.conversation.customer?.fullName
    || props.conversation.contactName
    || props.conversation.channelContactId;
});

const initials = computed(() => {
  const name = displayName.value || '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
});

const lastMessage = computed(() => {
  const msgs = props.conversation.messages;
  if (!msgs?.length) return '';
  const last = msgs[0];
  if (last.type !== 'TEXT') return `📎 ${last.type.toLowerCase()}`;
  return last.body || '';
});

const timeAgo = computed(() => {
  const d = props.conversation.lastMessageAt;
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
});
</script>
```

**Step 4: Create `ChatPanel.vue`**

```vue
<template>
  <div class="d-flex flex-column h-100">
    <ConversationHeader :conversation="conversation" @back="$emit('back')" />

    <!-- Messages area -->
    <div ref="messagesContainer" class="flex-grow-1 overflow-auto p-3" style="background: #efeae2;" @scroll="onScroll">
      <div v-if="loadingMore" class="text-center py-2">
        <div class="spinner-border spinner-border-sm"></div>
      </div>
      <ChatBubble
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
      />
    </div>

    <ChatInput :conversation-id="conversationId" />
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import ConversationHeader from './ConversationHeader.vue';
import ChatBubble from './ChatBubble.vue';
import ChatInput from './ChatInput.vue';

const props = defineProps({ conversationId: String });
defineEmits(['back']);

const inbox = useInboxStore();
const messagesContainer = ref(null);
const loadingMore = ref(false);

const conversation = computed(() => inbox.conversations.find(c => c.id === props.conversationId));
const messages = computed(() => inbox.messages[props.conversationId] || []);

// Scroll to bottom on new messages
watch(() => messages.value.length, async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
});

// Load messages on mount
onMounted(async () => {
  if (!inbox.messages[props.conversationId]) {
    await inbox.fetchMessages(props.conversationId);
    await nextTick();
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  }
});

// Lazy load on scroll to top
async function onScroll() {
  if (!messagesContainer.value || loadingMore.value) return;
  if (messagesContainer.value.scrollTop < 50) {
    const msgs = messages.value;
    if (!msgs.length) return;
    const oldest = msgs[0];
    loadingMore.value = true;
    try {
      const older = await inbox.fetchMessages(props.conversationId, oldest.createdAt);
      if (!older.length) return; // no more messages
    } finally {
      loadingMore.value = false;
    }
  }
}
</script>
```

**Step 5: Create `ChatBubble.vue`**

```vue
<template>
  <div class="d-flex mb-2" :class="isOutbound ? 'justify-content-end' : 'justify-content-start'">
    <div
      class="rounded-3 px-3 py-2 position-relative"
      :class="isOutbound ? 'bg-success-subtle' : 'bg-white'"
      style="max-width: 75%; min-width: 80px; word-wrap: break-word;"
    >
      <!-- Image -->
      <div v-if="message.type === 'IMAGE' && message.mediaUrl">
        <img :src="message.mediaUrl" class="img-fluid rounded mb-1" style="max-height: 300px; cursor: pointer;" @click="openMedia" />
        <p v-if="message.body" class="mb-0 small">{{ message.body }}</p>
      </div>

      <!-- Audio -->
      <div v-else-if="message.type === 'AUDIO' && message.mediaUrl">
        <AudioPlayer :src="message.mediaUrl" />
      </div>

      <!-- Video -->
      <div v-else-if="message.type === 'VIDEO' && message.mediaUrl">
        <video controls class="rounded" style="max-width: 100%; max-height: 300px;">
          <source :src="message.mediaUrl" :type="message.mediaMimeType || 'video/mp4'" />
        </video>
        <p v-if="message.body" class="mb-0 small mt-1">{{ message.body }}</p>
      </div>

      <!-- Document -->
      <div v-else-if="message.type === 'DOCUMENT' && message.mediaUrl">
        <a :href="message.mediaUrl" target="_blank" class="text-decoration-none d-flex align-items-center gap-2">
          <i class="bi bi-file-earmark fs-4"></i>
          <span class="small">{{ message.mediaFileName || 'Documento' }}</span>
        </a>
        <p v-if="message.body" class="mb-0 small mt-1">{{ message.body }}</p>
      </div>

      <!-- Location -->
      <div v-else-if="message.type === 'LOCATION'">
        <a :href="`https://maps.google.com/?q=${message.latitude},${message.longitude}`" target="_blank" class="text-decoration-none">
          <i class="bi bi-geo-alt me-1"></i> Ver no mapa
        </a>
      </div>

      <!-- Sticker -->
      <div v-else-if="message.type === 'STICKER' && message.mediaUrl">
        <img :src="message.mediaUrl" style="max-width: 150px;" />
      </div>

      <!-- Text (default) -->
      <div v-else>
        <p class="mb-0" style="white-space: pre-wrap;">{{ message.body }}</p>
      </div>

      <!-- Time + Status -->
      <div class="d-flex align-items-center justify-content-end gap-1 mt-1">
        <small class="text-muted" style="font-size: 0.7rem;">{{ time }}</small>
        <i v-if="isOutbound" class="bi" :class="statusIcon" style="font-size: 0.7rem;"></i>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import AudioPlayer from './AudioPlayer.vue';

const props = defineProps({ message: Object });

const isOutbound = computed(() => props.message.direction === 'OUTBOUND');

const time = computed(() => {
  const d = new Date(props.message.createdAt);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
});

const statusIcon = computed(() => {
  switch (props.message.status) {
    case 'PENDING': return 'bi-clock text-muted';
    case 'SENT': return 'bi-check text-muted';
    case 'DELIVERED': return 'bi-check-all text-muted';
    case 'READ': return 'bi-check-all text-primary';
    case 'FAILED': return 'bi-exclamation-circle text-danger';
    default: return 'bi-check text-muted';
  }
});

function openMedia() {
  window.open(props.message.mediaUrl, '_blank');
}
</script>
```

**Step 6: Create `AudioPlayer.vue`**

```vue
<template>
  <div class="d-flex align-items-center gap-2" style="min-width: 200px;">
    <button class="btn btn-sm btn-link p-0" @click="togglePlay">
      <i class="bi" :class="playing ? 'bi-pause-circle-fill' : 'bi-play-circle-fill'" style="font-size: 1.5rem;"></i>
    </button>
    <div class="flex-grow-1">
      <input
        type="range"
        class="form-range"
        min="0"
        :max="duration"
        step="0.1"
        v-model.number="currentTime"
        @input="seek"
        style="height: 4px;"
      />
      <div class="d-flex justify-content-between">
        <small class="text-muted" style="font-size: 0.65rem;">{{ formatTime(currentTime) }}</small>
        <small class="text-muted" style="font-size: 0.65rem;">{{ formatTime(duration) }}</small>
      </div>
    </div>
    <button class="btn btn-sm btn-link p-0 text-muted" @click="cycleSpeed" style="font-size: 0.7rem; min-width: 30px;">
      {{ speed }}x
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({ src: String });

const audio = ref(null);
const playing = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const speed = ref(1);
const speeds = [1, 1.5, 2];

onMounted(() => {
  audio.value = new Audio(props.src);
  audio.value.addEventListener('loadedmetadata', () => {
    duration.value = audio.value.duration || 0;
  });
  audio.value.addEventListener('timeupdate', () => {
    currentTime.value = audio.value.currentTime;
  });
  audio.value.addEventListener('ended', () => {
    playing.value = false;
    currentTime.value = 0;
  });
});

onUnmounted(() => {
  if (audio.value) {
    audio.value.pause();
    audio.value = null;
  }
});

function togglePlay() {
  if (!audio.value) return;
  if (playing.value) {
    audio.value.pause();
  } else {
    audio.value.play();
  }
  playing.value = !playing.value;
}

function seek() {
  if (audio.value) audio.value.currentTime = currentTime.value;
}

function cycleSpeed() {
  const idx = (speeds.indexOf(speed.value) + 1) % speeds.length;
  speed.value = speeds[idx];
  if (audio.value) audio.value.playbackRate = speed.value;
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>
```

**Step 7: Create `ChatInput.vue`**

```vue
<template>
  <div class="border-top bg-white p-2">
    <!-- Quick Reply Picker -->
    <QuickReplyPicker
      v-if="showQuickReplies"
      :filter="quickReplyFilter"
      @select="insertQuickReply"
      @close="showQuickReplies = false"
    />

    <div class="d-flex align-items-end gap-2">
      <!-- Attach button -->
      <button class="btn btn-sm btn-link text-muted p-1" @click="$refs.fileInput.click()" title="Anexar arquivo">
        <i class="bi bi-paperclip fs-5"></i>
      </button>
      <input ref="fileInput" type="file" class="d-none" accept="image/*,application/pdf,.doc,.docx" @change="onFileSelect" />

      <!-- Text input -->
      <div class="flex-grow-1">
        <textarea
          ref="textInput"
          class="form-control form-control-sm"
          rows="1"
          placeholder="Digite uma mensagem..."
          v-model="text"
          @input="onInput"
          @keydown.enter.exact.prevent="send"
          style="resize: none; max-height: 120px; overflow-y: auto;"
        ></textarea>
      </div>

      <!-- Send button -->
      <button class="btn btn-sm btn-success p-1 px-2" @click="send" :disabled="sending || (!text.trim() && !selectedFile)">
        <i class="bi bi-send"></i>
      </button>
    </div>

    <!-- File preview -->
    <div v-if="selectedFile" class="mt-2 d-flex align-items-center gap-2 p-2 bg-light rounded">
      <i class="bi bi-file-earmark"></i>
      <span class="small text-truncate">{{ selectedFile.name }}</span>
      <button class="btn btn-sm btn-link text-danger p-0 ms-auto" @click="selectedFile = null">
        <i class="bi bi-x"></i>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import QuickReplyPicker from './QuickReplyPicker.vue';

const props = defineProps({ conversationId: String });

const inbox = useInboxStore();
const text = ref('');
const selectedFile = ref(null);
const sending = ref(false);
const showQuickReplies = ref(false);
const quickReplyFilter = ref('');
const textInput = ref(null);

function onInput() {
  // Auto-resize textarea
  if (textInput.value) {
    textInput.value.style.height = 'auto';
    textInput.value.style.height = textInput.value.scrollHeight + 'px';
  }

  // Quick reply trigger
  if (text.value.startsWith('/')) {
    showQuickReplies.value = true;
    quickReplyFilter.value = text.value.slice(1);
  } else {
    showQuickReplies.value = false;
  }
}

function insertQuickReply(reply) {
  text.value = reply.body;
  showQuickReplies.value = false;
  nextTick(() => textInput.value?.focus());
}

function onFileSelect(e) {
  selectedFile.value = e.target.files[0] || null;
}

async function send() {
  if (sending.value) return;
  if (!text.value.trim() && !selectedFile.value) return;

  sending.value = true;
  try {
    const type = selectedFile.value
      ? (selectedFile.value.type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT')
      : 'TEXT';

    await inbox.sendMessage(props.conversationId, {
      type,
      body: text.value.trim() || null,
      mediaFile: selectedFile.value || null,
    });

    text.value = '';
    selectedFile.value = null;
    if (textInput.value) textInput.value.style.height = 'auto';
  } catch (e) {
    console.error('Erro ao enviar:', e);
  } finally {
    sending.value = false;
  }
}
</script>
```

**Step 8: Create `QuickReplyPicker.vue`**

```vue
<template>
  <div class="border rounded bg-white shadow-sm mb-2" style="max-height: 200px; overflow-y: auto;">
    <div
      v-for="reply in filtered"
      :key="reply.id"
      class="px-3 py-2 border-bottom cursor-pointer hover-bg-light"
      style="cursor: pointer;"
      @click="$emit('select', reply)"
    >
      <div class="d-flex justify-content-between">
        <strong class="small">{{ reply.shortcut }}</strong>
        <small class="text-muted">{{ reply.title }}</small>
      </div>
      <small class="text-muted text-truncate d-block">{{ reply.body }}</small>
    </div>
    <div v-if="!filtered.length" class="px-3 py-2 text-muted small">
      Nenhuma resposta rápida encontrada
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useInboxStore } from '@/stores/inbox';

const props = defineProps({ filter: { type: String, default: '' } });
defineEmits(['select', 'close']);

const inbox = useInboxStore();

const filtered = computed(() => {
  if (!props.filter) return inbox.quickReplies;
  const f = props.filter.toLowerCase();
  return inbox.quickReplies.filter(r =>
    r.shortcut.toLowerCase().includes(f) || r.title.toLowerCase().includes(f)
  );
});
</script>
```

**Step 9: Create `ConversationHeader.vue`**

```vue
<template>
  <div class="border-bottom bg-white px-3 py-2 d-flex align-items-center gap-2">
    <!-- Back button (mobile) -->
    <button class="btn btn-sm btn-link d-md-none p-0" @click="$emit('back')">
      <i class="bi bi-arrow-left fs-5"></i>
    </button>

    <!-- Contact info -->
    <div class="flex-grow-1">
      <strong>{{ displayName }}</strong>
      <div class="d-flex align-items-center gap-2">
        <small class="text-muted">
          <i class="bi bi-whatsapp text-success"></i>
          {{ conversation?.channelContactId }}
        </small>
        <span v-if="conversation?.store" class="badge bg-light text-dark small">
          {{ conversation.store.name }}
        </span>
        <span v-if="conversation?.assignedUser" class="badge bg-info-subtle text-info small">
          <i class="bi bi-person"></i> {{ conversation.assignedUser.name }}
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div class="d-flex gap-1">
      <button
        v-if="!conversation?.customerId"
        class="btn btn-sm btn-outline-primary"
        @click="showLinkCustomer = true"
        title="Vincular cliente"
      >
        <i class="bi bi-person-plus"></i>
      </button>
      <button
        v-if="conversation?.customerId"
        class="btn btn-sm btn-outline-success"
        @click="newOrder"
        title="Novo pedido"
      >
        <i class="bi bi-bag-plus"></i>
      </button>
      <button class="btn btn-sm btn-outline-secondary" @click="showAssign = true" title="Atribuir">
        <i class="bi bi-person-gear"></i>
      </button>
      <button
        v-if="conversation?.status === 'OPEN'"
        class="btn btn-sm btn-outline-danger"
        @click="closeConversation"
        title="Fechar conversa"
      >
        <i class="bi bi-x-circle"></i>
      </button>
      <button
        v-else
        class="btn btn-sm btn-outline-success"
        @click="reopenConversation"
        title="Reabrir conversa"
      >
        <i class="bi bi-arrow-counterclockwise"></i>
      </button>
    </div>

    <!-- Modals -->
    <LinkCustomerModal
      v-if="showLinkCustomer"
      :conversation-id="conversation?.id"
      :phone="conversation?.channelContactId"
      @close="showLinkCustomer = false"
    />
    <AssignUserModal
      v-if="showAssign"
      :conversation-id="conversation?.id"
      @close="showAssign = false"
    />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useInboxStore } from '@/stores/inbox';
import LinkCustomerModal from './LinkCustomerModal.vue';
import AssignUserModal from './AssignUserModal.vue';

const props = defineProps({ conversation: Object });
defineEmits(['back']);

const inbox = useInboxStore();
const router = useRouter();
const showLinkCustomer = ref(false);
const showAssign = ref(false);

const displayName = computed(() => {
  return props.conversation?.customer?.fullName
    || props.conversation?.contactName
    || props.conversation?.channelContactId
    || 'Contato';
});

function newOrder() {
  router.push({ path: '/orders', query: { newOrder: 1, customerId: props.conversation?.customerId } });
}

async function closeConversation() {
  await inbox.updateConversation(props.conversation.id, { status: 'CLOSED' });
}

async function reopenConversation() {
  await inbox.updateConversation(props.conversation.id, { status: 'OPEN' });
}
</script>
```

**Step 10: Create `LinkCustomerModal.vue`**

```vue
<template>
  <div class="modal d-block" style="background: rgba(0,0,0,0.5);" @click.self="$emit('close')">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h6 class="modal-title">Vincular Cliente</h6>
          <button class="btn-close" @click="$emit('close')"></button>
        </div>
        <div class="modal-body">
          <input
            type="text"
            class="form-control form-control-sm mb-3"
            placeholder="Buscar por nome ou telefone..."
            v-model="search"
            @input="debouncedSearch"
          />
          <div v-for="c in results" :key="c.id" class="d-flex align-items-center gap-2 p-2 border-bottom" style="cursor: pointer;" @click="link(c.id)">
            <div>
              <strong class="small">{{ c.fullName }}</strong>
              <small class="text-muted d-block">{{ c.whatsapp || c.phone || '' }}</small>
            </div>
          </div>
          <div v-if="searched && !results.length" class="text-center py-3">
            <p class="text-muted small">Nenhum cliente encontrado</p>
            <button class="btn btn-sm btn-primary" @click="createNew">
              <i class="bi bi-person-plus me-1"></i> Cadastrar novo
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useInboxStore } from '@/stores/inbox';
import api from '@/api';

const props = defineProps({ conversationId: String, phone: String });
const emit = defineEmits(['close']);

const inbox = useInboxStore();
const router = useRouter();
const search = ref(props.phone || '');
const results = ref([]);
const searched = ref(false);

let timer = null;
function debouncedSearch() {
  clearTimeout(timer);
  timer = setTimeout(doSearch, 300);
}

async function doSearch() {
  if (!search.value.trim()) { results.value = []; return; }
  try {
    const { data } = await api.get('/customers', { params: { search: search.value, limit: 10 } });
    results.value = Array.isArray(data) ? data : (data.customers || []);
    searched.value = true;
  } catch { results.value = []; }
}

async function link(customerId) {
  await inbox.linkCustomer(props.conversationId, customerId);
  emit('close');
}

function createNew() {
  router.push({ path: '/customers/new', query: { whatsapp: props.phone } });
  emit('close');
}

// Auto-search on mount if phone provided
if (props.phone) doSearch();
</script>
```

**Step 11: Create `AssignUserModal.vue`**

```vue
<template>
  <div class="modal d-block" style="background: rgba(0,0,0,0.5);" @click.self="$emit('close')">
    <div class="modal-dialog modal-sm">
      <div class="modal-content">
        <div class="modal-header">
          <h6 class="modal-title">Atribuir Atendente</h6>
          <button class="btn-close" @click="$emit('close')"></button>
        </div>
        <div class="modal-body">
          <div v-for="u in users" :key="u.id" class="d-flex align-items-center gap-2 p-2 border-bottom" style="cursor: pointer;" @click="assign(u.id)">
            <i class="bi bi-person"></i>
            <span class="small">{{ u.name }}</span>
          </div>
          <div class="p-2 border-bottom text-muted" style="cursor: pointer;" @click="assign(null)">
            <i class="bi bi-x-circle me-1"></i>
            <span class="small">Remover atribuição</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import api from '@/api';

const props = defineProps({ conversationId: String });
const emit = defineEmits(['close']);
const inbox = useInboxStore();
const users = ref([]);

onMounted(async () => {
  try {
    const { data } = await api.get('/users');
    users.value = Array.isArray(data) ? data : [];
  } catch { users.value = []; }
});

async function assign(userId) {
  await inbox.updateConversation(props.conversationId, { assignedUserId: userId });
  emit('close');
}
</script>
```

**Step 12: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/
git commit -m "feat(inbox): add Inbox view with all chat components"
```

---

### Task 7: Frontend — Quick Replies Settings View

**Files:**
- Create: `delivery-saas-frontend/src/views/inbox/settings/QuickReplies.vue`

**Step 1: Create Quick Replies CRUD view**

```vue
<template>
  <div class="container py-4" style="max-width: 800px;">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h5 class="mb-0">Respostas Rápidas</h5>
      <button class="btn btn-sm btn-primary" @click="openForm()">
        <i class="bi bi-plus me-1"></i> Nova
      </button>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead>
            <tr>
              <th>Atalho</th>
              <th>Título</th>
              <th>Mensagem</th>
              <th style="width: 100px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in inbox.quickReplies" :key="r.id">
              <td><code>{{ r.shortcut }}</code></td>
              <td>{{ r.title }}</td>
              <td class="text-truncate" style="max-width: 300px;">{{ r.body }}</td>
              <td>
                <button class="btn btn-sm btn-link" @click="openForm(r)"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-link text-danger" @click="remove(r)"><i class="bi bi-trash"></i></button>
              </td>
            </tr>
            <tr v-if="!inbox.quickReplies.length">
              <td colspan="4" class="text-center text-muted py-3">Nenhuma resposta rápida cadastrada</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Form Modal -->
    <div v-if="showForm" class="modal d-block" style="background: rgba(0,0,0,0.5);" @click.self="showForm = false">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h6 class="modal-title">{{ editing ? 'Editar' : 'Nova' }} Resposta Rápida</h6>
            <button class="btn-close" @click="showForm = false"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label small">Atalho</label>
              <input type="text" class="form-control form-control-sm" v-model="form.shortcut" placeholder="/saudacao" />
            </div>
            <div class="mb-3">
              <label class="form-label small">Título</label>
              <input type="text" class="form-control form-control-sm" v-model="form.title" placeholder="Nome descritivo" />
            </div>
            <div class="mb-3">
              <label class="form-label small">Mensagem</label>
              <textarea class="form-control form-control-sm" v-model="form.body" rows="4" placeholder="Texto da resposta..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-sm btn-secondary" @click="showForm = false">Cancelar</button>
            <button class="btn btn-sm btn-primary" @click="save" :disabled="saving">
              {{ saving ? 'Salvando...' : 'Salvar' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import Swal from 'sweetalert2';

const inbox = useInboxStore();
const showForm = ref(false);
const editing = ref(null);
const saving = ref(false);
const form = ref({ shortcut: '', title: '', body: '' });

onMounted(() => inbox.fetchQuickReplies());

function openForm(reply = null) {
  editing.value = reply;
  form.value = reply
    ? { shortcut: reply.shortcut, title: reply.title, body: reply.body }
    : { shortcut: '', title: '', body: '' };
  showForm.value = true;
}

async function save() {
  saving.value = true;
  try {
    if (editing.value) {
      await inbox.updateQuickReply(editing.value.id, form.value);
    } else {
      await inbox.createQuickReply(form.value);
    }
    showForm.value = false;
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Erro ao salvar', 'error');
  } finally {
    saving.value = false;
  }
}

async function remove(reply) {
  const result = await Swal.fire({
    title: 'Remover?',
    text: `Remover a resposta rápida "${reply.title}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Remover',
    cancelButtonText: 'Cancelar',
  });
  if (result.isConfirmed) {
    await inbox.deleteQuickReply(reply.id);
  }
}
</script>
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/settings/QuickReplies.vue
git commit -m "feat(inbox): add Quick Replies CRUD settings view"
```

---

### Task 8: Frontend — Router & Navigation Integration

**Files:**
- Modify: `delivery-saas-frontend/src/router.js`
- Modify: `delivery-saas-frontend/src/config/nav.js`
- Modify: `delivery-saas-frontend/src/App.vue` (or `Sidebar.vue` — wherever badge rendering happens)

**Step 1: Add routes to router.js**

Add imports near the top of the file:

```javascript
import Inbox from './views/inbox/Inbox.vue';
const QuickReplies = () => import('./views/inbox/settings/QuickReplies.vue');
```

Add routes in the routes array (after the orders route):

```javascript
{ path: '/inbox', component: Inbox, meta: { requiresAuth: true, requiresModule: 'WHATSAPP' } },
{ path: '/inbox/quick-replies', component: QuickReplies, meta: { requiresAuth: true, requiresModule: 'WHATSAPP' } },
```

**Step 2: Add nav entry to nav.js**

Add after the "Pedidos" entry:

```javascript
{ name: 'Inbox', to: '/inbox', icon: 'bi bi-chat-left-dots', moduleKey: 'whatsapp', lockable: true },
```

**Step 3: Add inbox badge to Sidebar**

In `delivery-saas-frontend/src/components/Sidebar.vue`, import the inbox store:

```javascript
import { useInboxStore } from '@/stores/inbox';
const inboxStore = useInboxStore();
```

In the nav item rendering template, add a badge condition for the inbox:

```html
<span v-if="item.to === '/inbox' && inboxStore.unreadTotal" class="badge bg-success ms-auto">
  {{ inboxStore.unreadTotal }}
</span>
```

**Step 4: Add Quick Replies link in Settings nav children**

In `nav.js`, inside the "Configurações" children, add:

```javascript
{ name: 'Respostas Rápidas', to: '/inbox/quick-replies', icon: 'bi bi-chat-quote', moduleKey: 'whatsapp', lockable: true },
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/router.js delivery-saas-frontend/src/config/nav.js delivery-saas-frontend/src/components/Sidebar.vue
git commit -m "feat(inbox): add routes, nav entry, and sidebar badge"
```

---

### Task 9: Backend — Auto-register Webhook on Existing Instances

**Files:**
- Create: `delivery-saas-backend/scripts/register-webhooks.mjs`

**Step 1: Create a one-time script to register webhooks for existing instances**

```javascript
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const BASE = process.env.EVOLUTION_API_BASE_URL;
const KEY = process.env.EVOLUTION_API_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL || process.env.BASE_URL;

if (!BASE || !KEY || !BACKEND_URL) {
  console.error('Set EVOLUTION_API_BASE_URL, EVOLUTION_API_API_KEY, BACKEND_URL');
  process.exit(1);
}

const instances = await prisma.whatsAppInstance.findMany();
console.log(`Found ${instances.length} instances`);

for (const inst of instances) {
  try {
    await axios.put(
      `${BASE}/webhook/set/${encodeURIComponent(inst.instanceName)}`,
      {
        url: `${BACKEND_URL}/webhook/evolution`,
        webhook_by_events: true,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
      },
      { headers: { apikey: KEY } }
    );
    console.log(`✅ ${inst.instanceName}`);
  } catch (e) {
    console.error(`❌ ${inst.instanceName}: ${e.message}`);
  }
}

await prisma.$disconnect();
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/scripts/register-webhooks.mjs
git commit -m "feat(inbox): add script to register webhooks on existing WhatsApp instances"
```

---

### Task 10: Add notification sound file

**Files:**
- Create: `delivery-saas-frontend/public/sounds/notification.mp3`

**Step 1: Add a notification sound**

Use a short, subtle notification sound. You can generate one or download a free one. Place it at `delivery-saas-frontend/public/sounds/notification.mp3`.

If the file already exists at another location (check `public/sounds/` or `public/assets/`), reuse it. Otherwise, create a simple beep using a base64-encoded audio or copy from the existing order notification sound if one exists.

**Step 2: Commit**

```bash
git add delivery-saas-frontend/public/sounds/
git commit -m "feat(inbox): add notification sound for new messages"
```

---

### Task 11: Integration Testing

**Step 1: Test webhook endpoint**

```bash
curl -X POST http://localhost:3000/webhook/evolution \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_KEY" \
  -d '{
    "event": "messages.upsert",
    "instance": { "instanceName": "YOUR_INSTANCE" },
    "data": [{
      "key": { "remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false, "id": "test123" },
      "pushName": "Test User",
      "message": { "conversation": "Olá, quero fazer um pedido!" }
    }]
  }'
```

Expected: 200 OK, conversation + message created in DB.

**Step 2: Test inbox API**

```bash
# List conversations
curl -H "Authorization: Bearer TOKEN" http://localhost:3000/inbox/conversations

# Get messages
curl -H "Authorization: Bearer TOKEN" http://localhost:3000/inbox/conversations/CONV_ID/messages

# Send message
curl -X POST -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  http://localhost:3000/inbox/conversations/CONV_ID/send \
  -d '{"type":"TEXT","body":"Olá! Como posso ajudar?"}'
```

**Step 3: Test frontend**

1. Navigate to `/inbox` — should show empty state
2. Send a WhatsApp message to the connected instance
3. Verify message appears in real-time with beep + browser notification
4. Reply from the inbox and verify message arrives on WhatsApp
5. Test quick replies: create one in settings, type `/` in chat input
6. Test link customer and new order shortcuts

**Step 4: Commit all final adjustments**

```bash
git add -A
git commit -m "feat(inbox): complete messaging inbox integration"
```
