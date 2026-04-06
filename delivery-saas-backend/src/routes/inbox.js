import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../auth.js';
import { prisma } from '../prisma.js';
import { evoSendText, evoSendMediaUrl, evoSendLocation } from '../wa.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// All routes require auth
router.use(authMiddleware);

// ─── Helpers ────────────────────────────────────────────────────────────────

function monthDir() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── 1. GET /conversations — List conversations ────────────────────────────

router.get('/conversations', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { storeId, status, search, cursor, limit: rawLimit } = req.query;
    const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 100);

    const where = { companyId };
    if (storeId) where.storeId = storeId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { contactName: { contains: search, mode: 'insensitive' } },
        { channelContactId: { contains: search } },
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
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
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

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
      },
    });

    if (!conversation || conversation.companyId !== companyId) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

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
      const relativePath = `/uploads/inbox/${companyId}/${monthDir()}/${filename}`;
      const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
      mediaUrl = `${baseUrl}${relativePath}`;
      mediaMimeType = req.file.mimetype;
      mediaFileName = req.file.originalname;

      // Send media via Evolution API
      await evoSendMediaUrl({
        instanceName,
        to,
        mediaUrl,
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
      await evoSendText({ instanceName, to, text: textBody });
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

    // Update conversation lastMessageAt
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    // Emit via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`company:${companyId}`).emit('inbox:message-sent', { conversationId: conversation.id, message });
    }

    return res.status(201).json(message);
  } catch (err) {
    console.error('[inbox] POST /conversations/:id/send error:', err);
    return res.status(500).json({ message: 'Erro ao enviar mensagem', error: err.message });
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
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`company:${companyId}`).emit('inbox:conversation-updated', conversation);
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
      select: { companyId: true },
    });
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

    // Verify customer belongs to same company
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { companyId: true },
    });
    if (!customer || customer.companyId !== companyId) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
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
      orderBy: { shortcut: 'asc' },
    });
    return res.json(replies);
  } catch (err) {
    console.error('[inbox] GET /quick-replies error:', err);
    return res.status(500).json({ message: 'Erro ao listar respostas rápidas', error: err.message });
  }
});

// ─── 9. POST /quick-replies — Create quick reply ───────────────────────────

router.post('/quick-replies', requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.user;
    let { shortcut, title, body } = req.body;

    if (!shortcut || !title || !body) {
      return res.status(400).json({ message: 'shortcut, title e body são obrigatórios' });
    }

    // Auto-prepend "/" to shortcut
    if (!shortcut.startsWith('/')) {
      shortcut = '/' + shortcut;
    }

    const reply = await prisma.quickReply.create({
      data: { companyId, shortcut, title, body },
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

router.put('/quick-replies/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.user;
    let { shortcut, title, body } = req.body;

    // Verify ownership
    const existing = await prisma.quickReply.findUnique({
      where: { id: req.params.id },
      select: { companyId: true },
    });
    if (!existing || existing.companyId !== companyId) {
      return res.status(404).json({ message: 'Resposta rápida não encontrada' });
    }

    const data = {};
    if (shortcut !== undefined) {
      data.shortcut = shortcut.startsWith('/') ? shortcut : '/' + shortcut;
    }
    if (title !== undefined) data.title = title;
    if (body !== undefined) data.body = body;

    const reply = await prisma.quickReply.update({
      where: { id: req.params.id },
      data,
    });

    return res.json(reply);
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

export default router;
