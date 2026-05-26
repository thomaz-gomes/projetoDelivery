import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../auth.js';
import { prisma } from '../prisma.js';
import { evoSendText, evoSendMediaUrl, evoSendLocation } from '../wa.js';
import { renderQuickReplyVariables } from '../utils/quickReplyVars.js';
import { transcribeAudio } from '../services/aiProvider.js';
import { buildReorderSuggestionBody } from '../services/reorderHelpers.js';
import whatsappMetaAdapter from '../messaging/adapters/whatsappMeta.adapter.js';
import { MetaWindowExpiredError } from '../messaging/adapters/base.adapter.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// All routes require auth
router.use(authMiddleware);

// ─── Helpers ────────────────────────────────────────────────────────────────

function monthDir() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function detectMessageType(mime) {
  if (!mime) return 'DOCUMENT';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

// Save an uploaded file into public/uploads/quick-replies/{companyId}/{yyyy-mm}/
// Returns { mediaUrl, mediaMimeType, mediaFileName } or null if no file.
function saveQuickReplyMedia(file, companyId) {
  if (!file) return null;
  const ym = monthDir();
  const dir = path.join(process.cwd(), 'public', 'uploads', 'quick-replies', companyId, ym);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file.originalname) || '';
  const filename = `${uuidv4()}${ext}`;
  fs.writeFileSync(path.join(dir, filename), file.buffer);
  return {
    mediaUrl: `/public/uploads/quick-replies/${companyId}/${ym}/${filename}`,
    mediaMimeType: file.mimetype || null,
    mediaFileName: file.originalname || null,
  };
}

// Best-effort delete of a previously saved quick-reply media file.
function deleteQuickReplyMedia(mediaUrl) {
  if (!mediaUrl) return;
  try {
    // mediaUrl starts with /public/ — map to disk path
    const rel = mediaUrl.replace(/^\/public\//, '');
    const abs = path.join(process.cwd(), 'public', rel);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) { /* ignore */ }
}

// ─── 1. GET /conversations — List conversations ────────────────────────────

router.get('/conversations', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { storeId, status, search, cursor, mine, unread, channel, limit: rawLimit } = req.query;
    const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 100);

    const ALLOWED_CHANNELS = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'];

    const where = { companyId };
    if (storeId) where.storeId = storeId;
    if (status) where.status = status.toUpperCase();
    if (mine === 'true' || mine === '1') where.assignedUserId = req.user.id;
    if (unread === 'true' || unread === '1') where.unreadCount = { gt: 0 };
    if (channel) {
      const ch = String(channel).toUpperCase();
      if (!ALLOWED_CHANNELS.includes(ch)) {
        return res.status(400).json({ message: 'Canal invalido' });
      }
      where.channel = ch;
    }
    if (search) {
      where.OR = [
        { contactName: { contains: search, mode: 'insensitive' } },
        { channelContactId: { contains: search } },
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
        { messages: { some: { body: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    if (cursor) {
      where.lastMessageAt = { lt: new Date(cursor) };
    }

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      include: {
        customer: { select: { id: true, fullName: true, whatsapp: true } },
        assignedUser: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        menu: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Attach lastInboundAt to each conversation (timestamp of the most recent
    // INBOUND Message). Used by the frontend to detect the Meta 24h-window
    // expiration. Per-conversation lookup is acceptable because the list is
    // capped at `limit` (default 50, max 100).
    await Promise.all(
      conversations.map(async c => {
        const last = await prisma.message.findFirst({
          where: { conversationId: c.id, direction: 'INBOUND' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        c.lastInboundAt = last?.createdAt || null;
      })
    );

    return res.json(conversations);
  } catch (err) {
    console.error('[inbox] GET /conversations error:', err);
    return res.status(500).json({ message: 'Erro ao listar conversas', error: err.message });
  }
});

// ─── 2. GET /conversations/:id — Conversation detail ───────────────────────

router.get('/conversations/:id', async (req, res) => {
  try {
    const { companyId } = req.user;
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, fullName: true, whatsapp: true, phone: true, email: true, cpf: true } },
        assignedUser: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        menu: { select: { id: true, name: true } },
      },
    });

    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

    // Attach lastInboundAt for Meta 24h-window detection on the frontend.
    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    conversation.lastInboundAt = lastInbound?.createdAt || null;

    return res.json(conversation);
  } catch (err) {
    console.error('[inbox] GET /conversations/:id error:', err);
    return res.status(500).json({ message: 'Erro ao buscar conversa', error: err.message });
  }
});

// ─── 3. GET /conversations/:id/messages — Message history (paginated) ──────

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { cursor, limit: rawLimit } = req.query;
    const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 100);

    // Verify ownership
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { companyId: true },
    });
    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

    const where = { conversationId: req.params.id };
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return res.json(messages);
  } catch (err) {
    console.error('[inbox] GET /conversations/:id/messages error:', err);
    return res.status(500).json({ message: 'Erro ao listar mensagens', error: err.message });
  }
});

// ─── 4. POST /conversations/:id/send — Send message ────────────────────────

router.post('/conversations/:id/send', upload.single('media'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { type, body: textBody, quotedMessageId, latitude, longitude } = req.body;

    // Verify ownership and get instance info
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
    });
    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }
    if (conversation.channel !== 'WHATSAPP') {
      return res.status(400).json({ message: 'Apenas canal WHATSAPP é suportado no momento' });
    }

    // ─── Meta WhatsApp Cloud branch ────────────────────────────────────────
    // Different from Evolution: no instanceName; resolves via providerAccountId.
    // Media is sent by URL (Meta fetches the file from our public uploads dir).
    if (conversation.provider === 'META_WA') {
      if (!conversation.providerAccountId) {
        return res.status(400).json({ message: 'Conversa Meta sem account associada' });
      }
      let metaAccount = await prisma.metaMessagingAccount.findUnique({
        where: { id: conversation.providerAccountId },
      });
      // Self-heal: conta antiga deletada (cenário comum de
      // disconnect + reconnect — gera row nova com ID diferente). Tenta
      // recuperar via menu.metaWaAccountId que reflete o vínculo atual.
      if (!metaAccount && conversation.menuId) {
        const menu = await prisma.menu.findUnique({
          where: { id: conversation.menuId },
          select: { metaWaAccountId: true },
        });
        if (menu?.metaWaAccountId) {
          const candidate = await prisma.metaMessagingAccount.findFirst({
            where: { id: menu.metaWaAccountId, companyId },
          });
          if (candidate) {
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { providerAccountId: candidate.id },
            });
            metaAccount = candidate;
            console.log('[inbox] self-healed conversation.providerAccountId', {
              conversationId: conversation.id,
              oldAccountId: conversation.providerAccountId,
              newAccountId: candidate.id,
            });
          }
        }
      }
      if (!metaAccount) {
        return res.status(400).json({
          message: 'A conta Meta desta conversa foi removida e não há vínculo automático para reatribuir. Reconecte a conta em Integrações e vincule-a ao cardápio desta conversa.',
        });
      }

      const to = conversation.channelContactId;
      let mediaUrl = null;
      let mediaMimeType = null;
      let mediaFileName = null;
      let absoluteMediaUrl = null;

      if (req.file) {
        const ext = path.extname(req.file.originalname) || '';
        const filename = `${uuidv4()}${ext}`;
        const dir = path.join(process.cwd(), 'public', 'uploads', 'inbox', companyId, monthDir());
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, req.file.buffer);
        mediaUrl = `/public/uploads/inbox/${companyId}/${monthDir()}/${filename}`;
        mediaMimeType = req.file.mimetype;
        mediaFileName = req.file.originalname;
        const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
        absoluteMediaUrl = `${baseUrl}${mediaUrl}`;
      }

      // Resolve quoted externalId — Meta uses context.message_id (wamid).
      let replyToExternalId = null;
      if (quotedMessageId) {
        const quotedMsg = await prisma.message.findFirst({
          where: { id: quotedMessageId, conversation: { companyId } },
          select: { externalId: true },
        });
        replyToExternalId = quotedMsg?.externalId || null;
      }

      let content;
      let persistedType;
      if (req.file) {
        persistedType = detectMessageType(mediaMimeType);
        content = {
          type: persistedType,
          mediaUrl: absoluteMediaUrl,
          text: textBody || undefined,
          mediaFileName,
          replyToExternalId,
        };
      } else if (type === 'LOCATION') {
        persistedType = 'LOCATION';
        content = {
          type: 'LOCATION',
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          replyToExternalId,
        };
      } else {
        if (!textBody) {
          return res.status(400).json({ message: 'Corpo da mensagem é obrigatório para tipo TEXT' });
        }
        persistedType = 'TEXT';
        content = { type: 'TEXT', text: textBody, replyToExternalId };
      }

      let sendResult;
      try {
        sendResult = await whatsappMetaAdapter.sendMessage(metaAccount, to, content);
      } catch (err) {
        if (err instanceof MetaWindowExpiredError) {
          return res.status(400).json({
            message: 'Janela de 24h expirada — Meta exige envio de template aprovado',
            code: 'META_WINDOW_EXPIRED',
          });
        }
        // Surface enough context para o operador entender o motivo: erro do
        // Graph API (token expirado, phone_number_id inválido, etc.) vem em
        // err.metaError / err.metaCode (preenchidos por throwMappedError).
        const metaCode = err?.metaCode || null;
        const metaErr = err?.metaError || null;
        console.error('[inbox] Meta WA send failed', {
          conversationId: conversation.id,
          accountId: metaAccount.id,
          to,
          metaCode,
          metaError: metaErr,
          message: err?.message,
        });
        // Mapear códigos comuns pra mensagem amigável
        let friendly = 'Falha ao enviar via Meta';
        if (metaCode === 190 || /access token/i.test(err?.message || '')) {
          friendly = 'Token Meta expirado ou inválido — reconecte a conta em Integrações Meta';
        } else if (metaCode === 100 && /phone_number_id/i.test(metaErr?.message || '')) {
          friendly = 'phone_number_id da conta Meta inválido — reconecte a conta';
        } else if (metaErr?.message) {
          friendly = `Meta: ${metaErr.message}`;
        }
        return res.status(500).json({
          message: friendly,
          metaCode,
          error: err.message,
        });
      }

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          type: persistedType,
          body: textBody || null,
          mediaUrl,
          mediaMimeType,
          mediaFileName,
          latitude: persistedType === 'LOCATION' ? parseFloat(latitude) : null,
          longitude: persistedType === 'LOCATION' ? parseFloat(longitude) : null,
          quotedMessageId: quotedMessageId || null,
          externalId: sendResult.externalId || null,
          status: sendResult.status || 'SENT',
        },
      });

      const updatedConversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
        include: {
          customer: { select: { id: true, fullName: true, whatsapp: true } },
          assignedUser: { select: { id: true, name: true } },
          store: { select: { id: true, name: true } },
        },
      });

      const io = req.app.get('io');
      if (io) {
        const payload = {
          conversationId: conversation.id,
          conversation: updatedConversation,
          message,
          companyId,
        };
        io.to(`company_${companyId}`).emit('inbox:new-message', payload);
        io.emit('inbox:new-message:broadcast', payload);
      }

      return res.status(201).json(message);
    }

    // ─── Evolution branch (existing) ──────────────────────────────────────
    if (!conversation.instanceName) {
      return res.status(400).json({ message: 'Conversa sem instância WhatsApp associada' });
    }

    const to = conversation.channelContactId;
    const instanceName = conversation.instanceName;
    let mediaUrl = null;
    let mediaMimeType = null;
    let mediaFileName = null;

    // Handle media upload
    if (req.file) {
      const ext = path.extname(req.file.originalname) || '';
      const filename = `${uuidv4()}${ext}`;
      const dir = path.join(process.cwd(), 'public', 'uploads', 'inbox', companyId, monthDir());
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      // Build public URL
      const relativePath = `/public/uploads/inbox/${companyId}/${monthDir()}/${filename}`;
      mediaUrl = relativePath;
      mediaMimeType = req.file.mimetype;
      mediaFileName = req.file.originalname;

      // Send media via Evolution API
      // Evolution API needs absolute URL to download the file
      const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
      await evoSendMediaUrl({
        instanceName,
        to,
        mediaUrl: `${baseUrl}${mediaUrl}`,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        caption: textBody || '',
      });
    } else if (type === 'LOCATION') {
      await evoSendLocation({
        instanceName,
        to,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
      });
    } else {
      // Default: TEXT
      if (!textBody) {
        return res.status(400).json({ message: 'Corpo da mensagem é obrigatório para tipo TEXT' });
      }
      // Build quoted payload if replying to a message
      let quoted = null;
      if (quotedMessageId) {
        const quotedMsg = await prisma.message.findFirst({
          where: { id: quotedMessageId, conversation: { companyId } },
          select: { externalId: true, body: true, type: true, direction: true },
        });
        if (quotedMsg && quotedMsg.externalId) {
          quoted = {
            key: {
              id: quotedMsg.externalId,
              fromMe: quotedMsg.direction === 'OUTBOUND',
              remoteJid: `${conversation.channelContactId}@s.whatsapp.net`,
            },
            message: { conversation: quotedMsg.body || '' },
          };
        }
      }
      await evoSendText({ instanceName, to, text: textBody, quoted });
    }

    // Persist message
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: req.file ? (mediaMimeType?.startsWith('image/') ? 'IMAGE' : mediaMimeType?.startsWith('video/') ? 'VIDEO' : mediaMimeType?.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT') : (type === 'LOCATION' ? 'LOCATION' : 'TEXT'),
        body: textBody || null,
        mediaUrl,
        mediaMimeType,
        mediaFileName,
        latitude: type === 'LOCATION' ? parseFloat(latitude) : null,
        longitude: type === 'LOCATION' ? parseFloat(longitude) : null,
        quotedMessageId: quotedMessageId || null,
        status: 'SENT',
      },
    });

    // Update conversation lastMessageAt and refetch so other windows can
    // hydrate their conversation list preview / ordering.
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
      include: {
        customer: { select: { id: true, fullName: true, whatsapp: true } },
        assignedUser: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
      },
    });

    // Emit via Socket.IO. Match the pattern used by other inbox endpoints
    // (internal-note, quick-reply, notify.js, router.sendOutbound): emit
    // `inbox:new-message` to `company_${id}` so other operator windows update
    // both their conversation list AND their open chat panel in real time.
    const io = req.app.get('io');
    if (io) {
      const payload = {
        conversationId: conversation.id,
        conversation: updatedConversation,
        message,
        companyId,
      };
      io.to(`company_${companyId}`).emit('inbox:new-message', payload);
      io.emit('inbox:new-message:broadcast', payload);
    }

    return res.status(201).json(message);
  } catch (err) {
    console.error('[inbox] POST /conversations/:id/send error:', err);
    return res.status(500).json({ message: 'Erro ao enviar mensagem', error: err.message });
  }
});

// ─── 4b. POST /conversations/:id/internal-note — Internal note ─────────────

router.post('/conversations/:id/internal-note', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ message: 'body é obrigatório' });

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!conversation) return res.status(404).json({ message: 'Conversa não encontrada' });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        body: body.trim(),
        internal: true,
        authorUserId: req.user.id,
        status: 'SENT',
      },
      include: {
        authorUser: { select: { id: true, name: true } },
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    const io = req.app.get('io');
    if (io) {
      const payload = {
        conversationId: conversation.id,
        message,
        companyId,
      };
      io.to(`company_${companyId}`).emit('inbox:new-message', payload);
      io.emit('inbox:new-message:broadcast', payload);
    }

    res.status(201).json(message);
  } catch (e) {
    console.error('[inbox] Error creating internal note:', e);
    res.status(500).json({ message: 'Erro ao criar nota interna', error: e.message });
  }
});

// ─── 4c. POST /conversations/:id/send-quick-reply ──────────────────────────

router.post('/conversations/:id/send-quick-reply', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { quickReplyId } = req.body;
    if (!quickReplyId) return res.status(400).json({ message: 'quickReplyId é obrigatório' });

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!conversation) return res.status(404).json({ message: 'Conversa não encontrada' });
    if (conversation.channel !== 'WHATSAPP') {
      return res.status(400).json({ message: 'Canal não suportado para envio' });
    }

    const reply = await prisma.quickReply.findFirst({
      where: { id: quickReplyId, companyId },
    });
    if (!reply) return res.status(404).json({ message: 'Resposta rápida não encontrada' });
    if (!reply.body && !reply.mediaUrl) {
      return res.status(400).json({ message: 'Resposta rápida vazia' });
    }

    const to = conversation.channelContactId;

    // Resolve {{nome}} / {{cashback}} / {{endereco}} against this conversation's customer
    const resolvedBody = await renderQuickReplyVariables(reply.body || '', { conversation, companyId });

    // ─── Meta WhatsApp Cloud branch (early return) ────────────────────────
    if (conversation.provider === 'META_WA') {
      if (!conversation.providerAccountId) {
        return res.status(400).json({ message: 'Conversa Meta sem account associada' });
      }
      let metaAccount = await prisma.metaMessagingAccount.findUnique({
        where: { id: conversation.providerAccountId },
      });
      // Self-heal: conta antiga deletada (cenário comum de
      // disconnect + reconnect — gera row nova com ID diferente). Tenta
      // recuperar via menu.metaWaAccountId que reflete o vínculo atual.
      if (!metaAccount && conversation.menuId) {
        const menu = await prisma.menu.findUnique({
          where: { id: conversation.menuId },
          select: { metaWaAccountId: true },
        });
        if (menu?.metaWaAccountId) {
          const candidate = await prisma.metaMessagingAccount.findFirst({
            where: { id: menu.metaWaAccountId, companyId },
          });
          if (candidate) {
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { providerAccountId: candidate.id },
            });
            metaAccount = candidate;
            console.log('[inbox] self-healed conversation.providerAccountId', {
              conversationId: conversation.id,
              oldAccountId: conversation.providerAccountId,
              newAccountId: candidate.id,
            });
          }
        }
      }
      if (!metaAccount) {
        return res.status(400).json({
          message: 'A conta Meta desta conversa foi removida e não há vínculo automático para reatribuir. Reconecte a conta em Integrações e vincule-a ao cardápio desta conversa.',
        });
      }

      let content;
      if (reply.mediaUrl) {
        const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
        content = {
          type: detectMessageType(reply.mediaMimeType),
          mediaUrl: `${baseUrl}${reply.mediaUrl}`,
          text: resolvedBody || undefined,
          mediaFileName: reply.mediaFileName || undefined,
        };
      } else {
        content = { type: 'TEXT', text: resolvedBody };
      }

      let sendResult;
      try {
        sendResult = await whatsappMetaAdapter.sendMessage(metaAccount, to, content);
      } catch (err) {
        if (err instanceof MetaWindowExpiredError) {
          return res.status(400).json({
            message: 'Janela de 24h expirada — Meta exige envio de template aprovado',
            code: 'META_WINDOW_EXPIRED',
          });
        }
        console.error('[inbox] Meta WA quick-reply send failed:', err);
        return res.status(500).json({ message: 'Falha ao enviar via Meta', error: err.message });
      }

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          type: reply.mediaUrl ? detectMessageType(reply.mediaMimeType) : 'TEXT',
          body: resolvedBody || null,
          mediaUrl: reply.mediaUrl || null,
          mediaMimeType: reply.mediaMimeType || null,
          mediaFileName: reply.mediaFileName || null,
          externalId: sendResult.externalId || null,
          status: sendResult.status || 'SENT',
        },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      const io = req.app.get('io');
      if (io) {
        const payload = { conversationId: conversation.id, message, companyId };
        io.to(`company_${companyId}`).emit('inbox:new-message', payload);
        io.emit('inbox:new-message:broadcast', payload);
      }

      return res.status(201).json(message);
    }

    // ─── Evolution branch (existing) ──────────────────────────────────────
    const instanceName = conversation.instanceName;

    // Send via Evolution (media + caption, or text-only)
    if (reply.mediaUrl) {
      const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
      await evoSendMediaUrl({
        instanceName,
        to,
        mediaUrl: `${baseUrl}${reply.mediaUrl}`,
        filename: reply.mediaFileName || 'arquivo',
        mimeType: reply.mediaMimeType,
        caption: resolvedBody || '',
      });
    } else {
      await evoSendText({ instanceName, to, text: resolvedBody });
    }

    // Persist Message
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: reply.mediaUrl ? detectMessageType(reply.mediaMimeType) : 'TEXT',
        body: resolvedBody || null,
        mediaUrl: reply.mediaUrl || null,
        mediaMimeType: reply.mediaMimeType || null,
        mediaFileName: reply.mediaFileName || null,
        status: 'SENT',
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    const io = req.app.get('io');
    if (io) {
      const payload = { conversationId: conversation.id, message, companyId };
      io.to(`company_${companyId}`).emit('inbox:new-message', payload);
      io.emit('inbox:new-message:broadcast', payload);
    }

    return res.status(201).json(message);
  } catch (err) {
    console.error('[inbox] POST /conversations/:id/send-quick-reply error:', err);
    return res.status(500).json({ message: 'Erro ao enviar resposta rápida', error: err.message });
  }
});

// ─── 4d. POST /conversations/:id/send-reorder-suggestion ───────────────────
//
// Sends a "Quer repetir seu último pedido?" message containing the same
// templated body and the same magic-link the WhatsApp registered-greeting
// button uses, so the customer lands on the public menu with the cart
// pre-filled when they tap. Used by the inbox "Perguntar" action; replaces
// the older plain-text question that just listed the items.
//
// Requirements:
//   - Conversation must belong to the caller's company and have a
//     channel = WHATSAPP.
//   - Conversation must be linked to a customer.
//   - Customer must have at least one CONCLUIDO order with items.

router.post('/conversations/:id/send-reorder-suggestion', async (req, res) => {
  try {
    const { companyId } = req.user;
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
      include: { menu: { select: { id: true, remindLastOrderTemplate: true } } },
    });
    if (!conversation) return res.status(404).json({ message: 'Conversa não encontrada' });
    if (conversation.channel !== 'WHATSAPP') return res.status(400).json({ message: 'Canal não suportado' });
    if (!conversation.customerId) return res.status(400).json({ message: 'Conversa sem cliente vinculado' });

    const customer = await prisma.customer.findUnique({
      where: { id: conversation.customerId },
      select: { id: true, fullName: true },
    });
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

    // Match the frontend definition of "último pedido": the most recent
    // order regardless of status. The inbox panel shows the same order
    // (cached on customer.orders[0]) and the operator already chose to ask
    // about it — we only require it to have items so the reorder preview
    // is meaningful.
    const lastOrder = await prisma.order.findFirst({
      where: {
        customerId: customer.id,
        companyId,
        items: { some: {} },
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    if (!lastOrder || !lastOrder.items?.length) return res.status(404).json({ message: 'Cliente não tem pedido anterior com itens' });

    const body = await buildReorderSuggestionBody({
      template: conversation.menu?.remindLastOrderTemplate || null,
      customer,
      order: lastOrder,
      companyId,
    });

    const instanceName = conversation.instanceName;
    if (!instanceName) return res.status(400).json({ message: 'Conversa sem instância de WhatsApp' });

    await evoSendText({ instanceName, to: conversation.channelContactId, text: body });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        body,
        status: 'SENT',
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    const io = req.app.get('io');
    if (io) {
      const payload = { conversationId: conversation.id, message, companyId };
      io.to(`company_${companyId}`).emit('inbox:new-message', payload);
      io.emit('inbox:new-message:broadcast', payload);
    }

    return res.status(201).json(message);
  } catch (err) {
    console.error('[inbox] POST /conversations/:id/send-reorder-suggestion error:', err);
    return res.status(500).json({ message: 'Erro ao enviar sugestão de pedido', error: err.message });
  }
});

// ─── 5. PATCH /conversations/:id — Update conversation ─────────────────────

router.patch('/conversations/:id', requireRole('ADMIN', 'ATTENDANT'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { status, assignedUserId } = req.body;

    // Verify ownership
    const existing = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { companyId: true },
    });
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

    const data = {};
    if (status) data.status = status;
    if (assignedUserId !== undefined) data.assignedUserId = assignedUserId || null;

    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data,
      include: {
        customer: { select: { id: true, fullName: true, whatsapp: true } },
        assignedUser: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        menu: { select: { id: true, name: true } },
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`company_${companyId}`).emit('inbox:conversation-updated', { conversation });
    }

    return res.json(conversation);
  } catch (err) {
    console.error('[inbox] PATCH /conversations/:id error:', err);
    return res.status(500).json({ message: 'Erro ao atualizar conversa', error: err.message });
  }
});

// ─── 6. PATCH /conversations/:id/read — Mark as read ───────────────────────

router.patch('/conversations/:id/read', async (req, res) => {
  try {
    const { companyId } = req.user;

    const existing = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { companyId: true },
    });
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { unreadCount: 0 },
    });

    return res.json(conversation);
  } catch (err) {
    console.error('[inbox] PATCH /conversations/:id/read error:', err);
    return res.status(500).json({ message: 'Erro ao marcar como lida', error: err.message });
  }
});

// ─── 7. POST /conversations/:id/link-customer — Link customer ──────────────

router.post('/conversations/:id/link-customer', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { customerId } = req.body;

    if (!customerId) {
      return res.status(400).json({ message: 'customerId é obrigatório' });
    }

    // Verify conversation ownership
    const existing = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { companyId: true, channel: true, provider: true, channelContactId: true },
    });
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

    // Verify customer belongs to same company
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { companyId: true, metaIdentities: true },
    });
    if (!customer || customer.companyId !== companyId) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    // For Meta channels (FB/IG), record the external identity on the customer
    // so future inbound messages from this contact resolve to them automatically.
    // WhatsApp keeps its existing behavior (no Customer.whatsapp mutation here).
    if (existing.channel === 'FACEBOOK' || existing.channel === 'INSTAGRAM') {
      const ids = Array.isArray(customer.metaIdentities) ? customer.metaIdentities : [];
      const provider = existing.provider;
      const externalId = existing.channelContactId;
      if (provider && externalId && !ids.some((i) => i && i.provider === provider && i.externalId === externalId)) {
        ids.push({ provider, externalId });
        await prisma.customer.update({
          where: { id: customerId },
          data: { metaIdentities: ids },
        });
      }
    }

    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { customerId },
      include: {
        customer: { select: { id: true, fullName: true, whatsapp: true, phone: true, email: true, cpf: true } },
      },
    });

    return res.json(conversation);
  } catch (err) {
    console.error('[inbox] POST /conversations/:id/link-customer error:', err);
    return res.status(500).json({ message: 'Erro ao vincular cliente', error: err.message });
  }
});

// ─── 8. GET /quick-replies — List quick replies ────────────────────────────

router.get('/quick-replies', async (req, res) => {
  try {
    const { companyId } = req.user;
    const replies = await prisma.quickReply.findMany({
      where: { companyId },
      include: { menus: { select: { id: true, name: true } } },
      orderBy: { shortcut: 'asc' },
    });
    return res.json(replies);
  } catch (err) {
    console.error('[inbox] GET /quick-replies error:', err);
    return res.status(500).json({ message: 'Erro ao listar respostas rápidas', error: err.message });
  }
});

// ─── 9. POST /quick-replies — Create quick reply ───────────────────────────

// Aceita menuIds como array nativo (JSON) OU como string CSV/JSON (multipart).
// Filtra IDs vazios e valida que pertencem à empresa.
async function parseAndValidateMenuIds(rawMenuIds, companyId) {
  let ids = rawMenuIds;
  if (typeof ids === 'string') {
    try {
      const parsed = JSON.parse(ids);
      ids = Array.isArray(parsed) ? parsed : ids.split(',');
    } catch {
      ids = ids.split(',');
    }
  }
  if (!Array.isArray(ids)) return [];
  ids = ids.map((v) => String(v || '').trim()).filter(Boolean);
  if (ids.length === 0) return [];
  const owned = await prisma.menu.findMany({
    where: { id: { in: ids }, store: { companyId } },
    select: { id: true },
  });
  return owned.map((m) => m.id);
}

router.post('/quick-replies', requireRole('ADMIN'), upload.single('file'), async (req, res) => {
  try {
    const { companyId } = req.user;
    let { shortcut, title, body, menuIds } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'title é obrigatório' });
    }
    if (!body?.trim() && !req.file) {
      return res.status(400).json({ message: 'Informe texto, anexo, ou ambos' });
    }

    if (shortcut) {
      shortcut = shortcut.trim() || null;
      if (shortcut && !shortcut.startsWith('/')) {
        shortcut = '/' + shortcut;
      }
    } else {
      shortcut = null;
    }

    const media = saveQuickReplyMedia(req.file, companyId);
    const validMenuIds = await parseAndValidateMenuIds(menuIds, companyId);

    const reply = await prisma.quickReply.create({
      data: {
        companyId,
        shortcut,
        title,
        body: body?.trim() || null,
        mediaUrl: media?.mediaUrl || null,
        mediaMimeType: media?.mediaMimeType || null,
        mediaFileName: media?.mediaFileName || null,
        menus: validMenuIds.length > 0
          ? { connect: validMenuIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { menus: { select: { id: true, name: true } } },
    });

    return res.status(201).json(reply);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Atalho já existe para esta empresa' });
    }
    console.error('[inbox] POST /quick-replies error:', err);
    return res.status(500).json({ message: 'Erro ao criar resposta rápida', error: err.message });
  }
});

// ─── 10. PUT /quick-replies/:id — Update quick reply ───────────────────────

router.put('/quick-replies/:id', requireRole('ADMIN'), upload.single('file'), async (req, res) => {
  try {
    const { companyId } = req.user;
    let { shortcut, title, body, removeMedia, menuIds } = req.body;

    // Verify ownership + load current media info
    const existing = await prisma.quickReply.findUnique({
      where: { id: req.params.id },
      select: { companyId: true, mediaUrl: true },
    });
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: 'Resposta rápida não encontrada' });
    }

    const data = {};
    if (shortcut !== undefined) {
      if (!shortcut || !shortcut.trim()) {
        data.shortcut = null;
      } else {
        data.shortcut = shortcut.startsWith('/') ? shortcut : '/' + shortcut;
      }
    }
    if (title !== undefined) data.title = title;
    if (body !== undefined) data.body = body?.trim() || null;

    // Media handling:
    // - new file uploaded → replace (delete old)
    // - removeMedia === 'true' → clear media (delete old)
    // - neither → keep as-is
    if (req.file) {
      const media = saveQuickReplyMedia(req.file, companyId);
      if (existing.mediaUrl) deleteQuickReplyMedia(existing.mediaUrl);
      data.mediaUrl = media.mediaUrl;
      data.mediaMimeType = media.mediaMimeType;
      data.mediaFileName = media.mediaFileName;
    } else if (removeMedia === 'true' || removeMedia === true) {
      if (existing.mediaUrl) deleteQuickReplyMedia(existing.mediaUrl);
      data.mediaUrl = null;
      data.mediaMimeType = null;
      data.mediaFileName = null;
    }

    // Vínculo com cardápios — `set` substitui a lista atual (passar [] = global)
    if (menuIds !== undefined) {
      const validMenuIds = await parseAndValidateMenuIds(menuIds, companyId);
      data.menus = { set: validMenuIds.map((id) => ({ id })) };
    }

    // Validate: after changes, at least one of body or mediaUrl must be present
    const updated = await prisma.quickReply.update({
      where: { id: req.params.id },
      data,
      include: { menus: { select: { id: true, name: true } } },
    });
    if (!updated.body && !updated.mediaUrl) {
      // Roll back by rejecting — no undo of file save but at least DB consistent
      return res.status(400).json({ message: 'Informe texto, anexo, ou ambos' });
    }

    return res.json(updated);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Atalho já existe para esta empresa' });
    }
    console.error('[inbox] PUT /quick-replies/:id error:', err);
    return res.status(500).json({ message: 'Erro ao atualizar resposta rápida', error: err.message });
  }
});

// ─── 11. DELETE /quick-replies/:id — Delete quick reply ────────────────────

router.delete('/quick-replies/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.user;

    // Verify ownership
    const existing = await prisma.quickReply.findUnique({
      where: { id: req.params.id },
      select: { companyId: true },
    });
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: 'Resposta rápida não encontrada' });
    }

    await prisma.quickReply.delete({ where: { id: req.params.id } });

    return res.json({ message: 'Resposta rápida removida' });
  } catch (err) {
    console.error('[inbox] DELETE /quick-replies/:id error:', err);
    return res.status(500).json({ message: 'Erro ao remover resposta rápida', error: err.message });
  }
});

// ─── Helpers: customer stats/tier (same logic as customers.js) ──────────────

function computeCustomerTier(orders) {
  const now = Date.now();
  const d30 = now - 30 * 24 * 60 * 60 * 1000;
  const all = orders || [];
  if (all.length === 1) return { tier: 'novo', stars: 1, label: 'NOVO' };
  const completed = all.filter(o => o.status === 'CONCLUIDO');
  if (!completed.length) return { tier: 'em_risco', stars: 1, label: 'Em Risco' };
  const last = new Date(completed[0].createdAt).getTime();
  if (last < d30) return { tier: 'em_risco', stars: 1, label: 'Em Risco' };
  const orders30d = completed.filter(o => new Date(o.createdAt).getTime() >= d30).length;
  if (orders30d >= 8) return { tier: 'vip', stars: 4, label: 'VIP' };
  if (orders30d >= 4) return { tier: 'fiel', stars: 3, label: 'Fiel' };
  return { tier: 'regular', stars: 2, label: 'Regular' };
}

function computeCustomerStats(orders) {
  const completed = (orders || []).filter(o => o.status === 'CONCLUIDO');
  const totalSpent = completed.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalOrders = (orders || []).length;
  const lastOrderDate = orders?.length ? orders[0].createdAt : null;
  const itemCounts = {};
  for (const o of completed) {
    for (const item of (o.items || [])) {
      itemCounts[item.name] = (itemCounts[item.name] || 0) + item.quantity;
    }
  }
  let favoriteItem = null;
  let maxQty = 0;
  for (const [name, qty] of Object.entries(itemCounts)) {
    if (qty > maxQty) { maxQty = qty; favoriteItem = name; }
  }
  return { totalSpent, totalOrders, lastOrderDate, favoriteItem, ...computeCustomerTier(orders) };
}

// Build phone variants for Brazilian numbers (with/without DDI 55, with/without 9th digit)
function buildPhoneVariants(phone) {
  if (!phone) return [];
  const variants = new Set([phone]);
  const withDDI = phone.startsWith('55') ? phone : '55' + phone;
  const withoutDDI = phone.startsWith('55') ? phone.slice(2) : phone;
  variants.add(withDDI);
  variants.add(withoutDDI);
  const ddd = withoutDDI.slice(0, 2);
  const rest = withoutDDI.slice(2);
  if (rest.length === 8) {
    variants.add(`55${ddd}9${rest}`);
    variants.add(`${ddd}9${rest}`);
  } else if (rest.length === 9 && rest.startsWith('9')) {
    variants.add(`55${ddd}${rest.slice(1)}`);
    variants.add(`${ddd}${rest.slice(1)}`);
  }
  return [...variants];
}

// ─── 12. GET /customer/:id — Fetch customer with addresses, orders, stats ───

router.get('/customer/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        addresses: { orderBy: { isDefault: 'desc' } },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true, displayId: true, displaySimple: true,
            status: true, createdAt: true, total: true, orderType: true,
            items: { select: { name: true, quantity: true, price: true } },
          },
        },
      },
    });
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });
    const stats = computeCustomerStats(customer.orders);
    res.json({ ...customer, stats });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar cliente', error: e.message });
  }
});

// ─── 12c. GET /search-contacts?q=... — Find customers with WhatsApp for inbox search
//
// Returns a small list of contacts whose fullName or whatsapp matches the
// query. Numeric queries are treated as phone numbers and matched against
// all phone variants (with/without DDI, with/without 9th digit). Each row
// includes the existing WhatsApp Conversation (if any) so the frontend can
// open it directly; otherwise the row is "openable as new". When the query
// is numeric and matches no Customer, we add a single synthetic row so the
// user can create a contact + conversation on the fly.
router.get('/search-contacts', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);

    const digits = q.replace(/\D+/g, '');
    const isNumeric = digits.length >= 4 && digits.length === q.replace(/\s|-|\(|\)|\+/g, '').length;

    let customers = [];
    if (isNumeric) {
      const variants = buildPhoneVariants(digits);
      customers = await prisma.customer.findMany({
        where: { companyId, whatsapp: { in: variants } },
        select: { id: true, fullName: true, whatsapp: true, phone: true },
        take: 20,
      });
    } else {
      customers = await prisma.customer.findMany({
        where: {
          companyId,
          whatsapp: { not: null },
          fullName: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, fullName: true, whatsapp: true, phone: true },
        orderBy: { fullName: 'asc' },
        take: 20,
      });
    }

    // For each contact, look up the matching WhatsApp conversation (any status)
    // so the frontend can show "tem conversa" badge and route the click.
    const rows = await Promise.all(customers.map(async (c) => {
      const variants = buildPhoneVariants(c.whatsapp || '');
      const conversation = await prisma.conversation.findFirst({
        where: { companyId, channel: 'WHATSAPP', channelContactId: { in: variants } },
        select: { id: true, status: true, lastMessageAt: true },
        orderBy: { lastMessageAt: 'desc' },
      });
      return { type: 'contact', customer: c, conversation };
    }));

    // Numeric query that didn't resolve to any Customer → offer "create new".
    if (isNumeric && rows.length === 0) {
      rows.push({ type: 'new-number', whatsapp: digits });
    }

    return res.json(rows);
  } catch (err) {
    console.error('[inbox] GET /search-contacts error:', err);
    return res.status(500).json({ message: 'Erro ao buscar contatos', error: err.message });
  }
});

// ─── 12d. POST /start-conversation — Open existing or create a new WhatsApp Conversation
//
// Body: { customerId?, whatsapp? }
//
// - If customerId is given, the conversation is anchored to that customer.
// - Otherwise, whatsapp (digits, with or without DDI) is normalized and the
//   matching Customer is found via buildPhoneVariants. If still none, a new
//   Customer is created silently with fullName = whatsapp.
// - We look up the WhatsApp Conversation for that contact (any status). If
//   found: status flips to OPEN (reopen behavior) and the existing row is
//   returned. If not found: a new Conversation is created with status=OPEN
//   and channelContactId = normalized phone with DDI.
router.post('/start-conversation', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    let { customerId, whatsapp } = req.body || {};

    let customer = null;
    if (customerId) {
      customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
      if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });
    } else {
      const digits = String(whatsapp || '').replace(/\D+/g, '');
      if (!digits) return res.status(400).json({ message: 'customerId ou whatsapp é obrigatório' });
      const variants = buildPhoneVariants(digits);
      customer = await prisma.customer.findFirst({ where: { companyId, whatsapp: { in: variants } } });
      if (!customer) {
        // Store whatsapp without DDI (matches services/customers.js convention).
        const storedWhatsapp = digits.startsWith('55') ? digits.slice(2) : digits;
        customer = await prisma.customer.create({
          data: { companyId, fullName: storedWhatsapp, whatsapp: storedWhatsapp },
        });
      }
    }

    // Canonical channelContactId is the with-DDI form, matching what inbound
    // webhooks write. buildPhoneVariants is still used for lookup to catch
    // legacy rows that may have been stored without the country prefix.
    const phoneDigits = String(customer.whatsapp || '').replace(/\D+/g, '');
    if (!phoneDigits) return res.status(400).json({ message: 'Cliente não possui WhatsApp cadastrado' });
    const variants = buildPhoneVariants(phoneDigits);
    const canonicalContactId = phoneDigits.startsWith('55') ? phoneDigits : '55' + phoneDigits;

    let conversation = await prisma.conversation.findFirst({
      where: { companyId, channel: 'WHATSAPP', channelContactId: { in: variants } },
    });

    if (conversation) {
      // Reopen if it was closed/archived. Always ensure the customer is linked.
      const updates = {};
      if (conversation.status !== 'OPEN') updates.status = 'OPEN';
      if (!conversation.customerId) updates.customerId = customer.id;
      if (Object.keys(updates).length) {
        conversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: updates,
        });
      }
    } else {
      conversation = await prisma.conversation.create({
        data: {
          companyId,
          channel: 'WHATSAPP',
          channelContactId: canonicalContactId,
          customerId: customer.id,
          contactName: customer.fullName || null,
          status: 'OPEN',
          unreadCount: 0,
        },
      });
    }

    // Return with the same shape as GET /conversations/:id so the frontend
    // can drop it into the store without an extra fetch.
    const full = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: {
        customer: { select: { id: true, fullName: true, whatsapp: true, phone: true, email: true, cpf: true } },
        assignedUser: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        menu: { select: { id: true, name: true } },
      },
    });
    return res.json(full);
  } catch (err) {
    console.error('[inbox] POST /start-conversation error:', err);
    return res.status(500).json({ message: 'Erro ao iniciar conversa', error: err.message });
  }
});

// ─── 12b. GET /customer/by-phone/:phone — Find customer by phone variants ───

router.get('/customer/by-phone/:phone', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const variants = buildPhoneVariants(req.params.phone);
    const customer = await prisma.customer.findFirst({
      where: { companyId, whatsapp: { in: variants } },
      include: {
        addresses: { orderBy: { isDefault: 'desc' } },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true, displayId: true, displaySimple: true,
            status: true, createdAt: true, total: true, orderType: true,
            items: { select: { name: true, quantity: true, price: true } },
          },
        },
      },
    });
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

    const stats = computeCustomerStats(customer.orders);
    res.json({ ...customer, stats });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar cliente', error: e.message });
  }
});

// ─── 13. PATCH /customer/:id — Update customer fields (blur save) ─────────

router.patch('/customer/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.customer.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ message: 'Cliente não encontrado' });
    const { fullName, cpf, email, phone } = req.body;
    const data = {};
    if (fullName !== undefined) data.fullName = fullName;
    if (cpf !== undefined) data.cpf = cpf ? cpf.replace(/\D+/g, '') : null;
    if (email !== undefined) data.email = email || null;
    if (phone !== undefined) data.phone = phone || null;
    const updated = await prisma.customer.update({ where: { id: existing.id }, data });
    res.json(updated);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'CPF ou telefone já cadastrado' });
    res.status(500).json({ message: 'Erro ao atualizar cliente', error: e.message });
  }
});

// ─── 14. POST /customer/:id/addresses — Create new address ────────────────

router.post('/customer/:id/addresses', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const customer = await prisma.customer.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });
    const { label, street, number, complement, neighborhood, reference, observation, city, state, postalCode } = req.body;
    const address = await prisma.customerAddress.create({
      data: { customerId: customer.id, label: label || null, street: street || null, number: number || null, complement: complement || null, neighborhood: neighborhood || null, reference: reference || null, observation: observation || null, city: city || null, state: state || null, postalCode: postalCode || null, isDefault: true },
    });
    await prisma.customerAddress.updateMany({ where: { customerId: customer.id, isDefault: true, NOT: { id: address.id } }, data: { isDefault: false } });
    res.status(201).json(address);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao criar endereço', error: e.message });
  }
});

// ─── 15. PATCH /customer/:id/addresses/:addrId — Update address (blur save)

router.patch('/customer/:id/addresses/:addrId', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const customer = await prisma.customer.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });
    const addr = await prisma.customerAddress.findFirst({ where: { id: req.params.addrId, customerId: customer.id } });
    if (!addr) return res.status(404).json({ message: 'Endereço não encontrado' });
    const { label, street, number, complement, neighborhood, reference, observation, city, state, postalCode } = req.body;
    const data = {};
    if (label !== undefined) data.label = label || null;
    if (street !== undefined) data.street = street || null;
    if (number !== undefined) data.number = number || null;
    if (complement !== undefined) data.complement = complement || null;
    if (neighborhood !== undefined) data.neighborhood = neighborhood || null;
    if (reference !== undefined) data.reference = reference || null;
    if (observation !== undefined) data.observation = observation || null;
    if (city !== undefined) data.city = city || null;
    if (state !== undefined) data.state = state || null;
    if (postalCode !== undefined) data.postalCode = postalCode || null;
    const updated = await prisma.customerAddress.update({ where: { id: addr.id }, data });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar endereço', error: e.message });
  }
});

// ─── Tags: update conversation tags ────────────────────────────────────────

router.patch('/conversations/:id/tags', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ message: 'tags deve ser array' });

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!conv) return res.status(404).json({ message: 'Conversa não encontrada' });

    const cleanTags = tags
      .map(t => String(t).trim().toLowerCase())
      .filter(t => t.length > 0 && t.length < 30);
    const uniqueTags = [...new Set(cleanTags)];

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { tags: uniqueTags },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`company_${companyId}`).emit('inbox:conversation-updated', { conversation: updated });
    }

    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar tags', error: e.message });
  }
});

// ─── POST /messages/:messageId/transcribe ───────────────────────────────────

router.post('/messages/:messageId/transcribe', async (req, res) => {
  try {
    const { companyId } = req.user;

    const message = await prisma.message.findFirst({
      where: { id: req.params.messageId },
      include: { conversation: { select: { companyId: true } } },
    });

    if (!message || message.conversation.companyId !== companyId) {
      return res.status(404).json({ message: 'Mensagem não encontrada' });
    }
    if (message.type !== 'AUDIO') {
      return res.status(400).json({ message: 'Mensagem não é do tipo AUDIO' });
    }
    if (!message.mediaUrl) {
      return res.status(400).json({ message: 'Mensagem sem arquivo de áudio' });
    }

    // Return cached transcription if already done
    if (message.transcription) {
      return res.json({ transcription: message.transcription });
    }

    const mimeType = message.mediaMimeType || 'audio/ogg';
    let audioBuffer;
    let filename;

    if (!message.mediaUrl.startsWith('http')) {
      // Local file: mediaUrl is like /public/uploads/inbox/...
      const relativePart = message.mediaUrl.startsWith('/') ? message.mediaUrl.slice(1) : message.mediaUrl;
      const filePath = path.join(process.cwd(), relativePart);
      audioBuffer = fs.readFileSync(filePath);
      filename = path.basename(filePath);
    } else {
      // External URL (fallback for Evolution-hosted media)
      const response = await fetch(message.mediaUrl, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error('Falha ao baixar arquivo de áudio');
      audioBuffer = Buffer.from(await response.arrayBuffer());
      filename = 'audio.ogg';
    }

    const transcription = await transcribeAudio(audioBuffer, mimeType, filename);

    await prisma.message.update({
      where: { id: message.id },
      data: { transcription },
    });

    return res.json({ transcription });
  } catch (err) {
    console.error('[transcribe] error:', err);
    return res.status(500).json({ message: 'Erro ao transcrever áudio', error: err.message });
  }
});

// ─── Tags: autocomplete (top 20 by usage) ──────────────────────────────────

router.get('/tags', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const result = await prisma.$queryRaw`
      SELECT unnest(tags) as tag, COUNT(*)::int as count
      FROM "Conversation"
      WHERE "companyId" = ${companyId} AND array_length(tags, 1) > 0
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 20
    `;
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar tags', error: e.message });
  }
});

// ─── Greeting Time Rules ────────────────────────────────────────────────────

router.get('/greeting-rules', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { menuId } = req.query;
    if (!menuId) return res.status(400).json({ message: 'menuId obrigatório' });

    const menu = await prisma.menu.findFirst({
      where: { id: menuId, store: { companyId } },
      select: { id: true },
    });
    if (!menu) return res.status(403).json({ message: 'Cardápio não encontrado' });

    const rules = await prisma.greetingTimeRule.findMany({
      where: { menuId },
      include: { quickReply: { select: { id: true, title: true, shortcut: true, body: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return res.json(rules);
  } catch (err) {
    console.error('[inbox] GET /greeting-rules error:', err);
    return res.status(500).json({ message: 'Erro ao listar regras de saudação', error: err.message });
  }
});

router.post('/greeting-rules', requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { menuId, quickReplyId, startTime, endTime, label, sortOrder } = req.body;

    if (!menuId || !quickReplyId || !startTime || !endTime) {
      return res.status(400).json({ message: 'menuId, quickReplyId, startTime e endTime são obrigatórios' });
    }

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRe.test(startTime) || !timeRe.test(endTime)) {
      return res.status(400).json({ message: 'startTime e endTime devem estar no formato HH:MM' });
    }

    const menu = await prisma.menu.findFirst({
      where: { id: menuId, store: { companyId } },
      select: { id: true },
    });
    if (!menu) return res.status(403).json({ message: 'Cardápio não encontrado' });

    const qr = await prisma.quickReply.findFirst({
      where: { id: quickReplyId, companyId },
      select: { id: true },
    });
    if (!qr) return res.status(400).json({ message: 'quickReplyId inválido' });

    const rule = await prisma.greetingTimeRule.create({
      data: {
        companyId,
        menuId,
        quickReplyId,
        startTime,
        endTime,
        label: label || null,
        sortOrder: sortOrder ?? 0,
      },
      include: { quickReply: { select: { id: true, title: true, shortcut: true, body: true } } },
    });
    return res.status(201).json(rule);
  } catch (err) {
    console.error('[inbox] POST /greeting-rules error:', err);
    return res.status(500).json({ message: 'Erro ao criar regra de saudação', error: err.message });
  }
});

router.put('/greeting-rules/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { id } = req.params;
    const { quickReplyId, startTime, endTime, label, sortOrder } = req.body;

    const existing = await prisma.greetingTimeRule.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ message: 'Regra não encontrada' });

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (startTime && !timeRe.test(startTime)) {
      return res.status(400).json({ message: 'startTime inválido' });
    }
    if (endTime && !timeRe.test(endTime)) {
      return res.status(400).json({ message: 'endTime inválido' });
    }

    const data = {};
    if (quickReplyId !== undefined) {
      if (quickReplyId) {
        const qr = await prisma.quickReply.findFirst({
          where: { id: quickReplyId, companyId },
          select: { id: true },
        });
        if (!qr) return res.status(400).json({ message: 'quickReplyId inválido' });
      }
      data.quickReplyId = quickReplyId || null;
    }
    if (startTime !== undefined) data.startTime = startTime;
    if (endTime !== undefined) data.endTime = endTime;
    if (label !== undefined) data.label = label || null;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder);

    const rule = await prisma.greetingTimeRule.update({
      where: { id },
      data,
      include: { quickReply: { select: { id: true, title: true, shortcut: true, body: true } } },
    });
    return res.json(rule);
  } catch (err) {
    console.error('[inbox] PUT /greeting-rules/:id error:', err);
    return res.status(500).json({ message: 'Erro ao atualizar regra de saudação', error: err.message });
  }
});

router.delete('/greeting-rules/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { id } = req.params;

    const existing = await prisma.greetingTimeRule.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ message: 'Regra não encontrada' });

    await prisma.greetingTimeRule.delete({ where: { id } });
    return res.json({ message: 'Regra de saudação removida' });
  } catch (err) {
    console.error('[inbox] DELETE /greeting-rules/:id error:', err);
    return res.status(500).json({ message: 'Erro ao remover regra de saudação', error: err.message });
  }
});

export default router;
