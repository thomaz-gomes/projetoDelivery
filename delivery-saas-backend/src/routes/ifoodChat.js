import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import { randomToken, sha256 } from '../utils.js'

const router = express.Router()
router.use(authMiddleware)
router.use(requireRole('ADMIN'))

// Default messages seeded when first fetched
const DEFAULTS = [
  { status: 'CONFIRMED', message: 'Olá {nome}! 😊 Estamos preparando o seu pedido #{numero} com muito carinho. 💜', enabled: true },
  { status: 'DISPATCHED', message: '{nome}! O seu pedido #{numero} acabou de sair para entrega! 🛵 Fique atento que em breve o entregador estará no endereço solicitado.', enabled: true },
  { status: 'DELIVERED', message: 'Agora que seu pedido foi entregue, ficaríamos muito felizes se você pudesse dedicar um momento para avaliá-lo. Sua opinião é extremamente valiosa para nós! 🌟', enabled: true },
  { status: 'MANUAL', message: 'Olá {nome}! Temos uma mensagem sobre o seu pedido #{numero}.', enabled: false },
]

// GET /ifood-chat/messages/:storeId
router.get('/messages/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params
    let messages = await prisma.ifoodChatMessage.findMany({ where: { storeId } })

    // Seed defaults if empty
    if (messages.length === 0) {
      await prisma.ifoodChatMessage.createMany({
        data: DEFAULTS.map(d => ({ ...d, storeId })),
        skipDuplicates: true,
      })
      messages = await prisma.ifoodChatMessage.findMany({ where: { storeId } })
    }

    res.json({ ok: true, messages })
  } catch (e) {
    console.error('GET /ifood-chat/messages failed', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// PUT /ifood-chat/messages/:storeId
router.put('/messages/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params
    const { messages } = req.body // array of { status, message, enabled }

    if (!Array.isArray(messages)) return res.status(400).json({ ok: false, message: 'messages must be an array' })

    const results = []
    for (const m of messages) {
      const updated = await prisma.ifoodChatMessage.upsert({
        where: { storeId_status: { storeId, status: m.status } },
        update: { message: m.message, enabled: m.enabled },
        create: { storeId, status: m.status, message: m.message, enabled: m.enabled },
      })
      results.push(updated)
    }

    res.json({ ok: true, messages: results })
  } catch (e) {
    console.error('PUT /ifood-chat/messages failed', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /ifood-chat/send — manual send
router.post('/send', async (req, res) => {
  try {
    const { orderId, storeId } = req.body
    if (!orderId || !storeId) return res.status(400).json({ ok: false, message: 'orderId and storeId required' })

    const order = await prisma.order.findUnique({ where: { id: orderId } })
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' })

    const msgConfig = await prisma.ifoodChatMessage.findUnique({
      where: { storeId_status: { storeId, status: 'MANUAL' } },
    })
    if (!msgConfig || !msgConfig.enabled) return res.status(400).json({ ok: false, message: 'Manual message not configured or disabled' })

    // Resolve order number from iFood (displayId or externalId short form)
    const orderNumber = order.displayId || order.externalId || String(order.id)
    const customerName = order.payload?.customer?.name || order.payload?.order?.customer?.name || 'Cliente'

    const finalMessage = msgConfig.message
      .replace(/\{nome\}/g, customerName)
      .replace(/\{numero\}/g, orderNumber)

    // Emit to extension via Socket.IO
    const { emitirIfoodChat } = await import('../index.js')
    emitirIfoodChat({ orderNumber, message: finalMessage, storeId, companyId: order.companyId })

    res.json({ ok: true, sent: true })
  } catch (e) {
    console.error('POST /ifood-chat/send failed', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /ifood-chat/generate-token
router.post('/generate-token', async (req, res) => {
  try {
    const companyId = req.user.companyId
    if (!companyId) return res.status(400).json({ ok: false, message: 'No company' })

    const token = randomToken(24)
    const tokenHash = sha256(token)

    await prisma.printerSetting.upsert({
      where: { companyId },
      update: { extensionTokenHash: tokenHash, extensionTokenCreatedAt: new Date() },
      create: { companyId, extensionTokenHash: tokenHash, extensionTokenCreatedAt: new Date() },
    })

    res.json({ ok: true, token, companyId })
  } catch (e) {
    console.error('POST /ifood-chat/generate-token failed', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

export default router
