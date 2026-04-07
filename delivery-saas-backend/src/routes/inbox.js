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
    const { storeId, status, search, cursor, mine, unread, limit: rawLimit } = req.query;
    const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 100);

    const where = { companyId };
    if (storeId) where.storeId = storeId;
    if (status) where.status = status.toUpperCase();
    if (mine === 'true' || mine === '1') where.assignedUserId = req.user.id;
    if (unread === 'true' || unread === '1') where.unreadCount = { gt: 0 };
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

export default router;
