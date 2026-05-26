// src/routes/webhookEvolution.js
// Public webhook endpoint for Evolution API v2 events (no JWT auth).
//
// As of Task 12 of the Meta Messaging Integration plan this is a thin handler
// that delegates inbound messages.upsert events to the messaging router
// (which dispatches to whatsappEvolution.adapter → inboundPipeline). Two
// Evolution-specific events stay inline because they don't fit the channel-
// agnostic pipeline shape:
//   - messages.update / MESSAGES_UPDATE → outbound delivery/read receipts
//   - connection.update / CONNECTION_UPDATE → instance connectivity state
import { Router } from 'express'
import { prisma } from '../prisma.js'
import { routeInbound } from '../messaging/index.js'
import { persistOutboundEcho } from '../messaging/evolutionOutboundEcho.js'
import { applyMarketingStatusFromWebhook } from '../services/marketing/messageStatusHooks.js'

const router = Router()

// Evolution v2 webhooks may not include an apikey header. Validate only
// when one is supplied (e.g. manual test) so the public path stays open.
router.use((req, res, next) => {
  const expected = process.env.EVOLUTION_API_API_KEY
  const provided = req.headers['apikey'] || req.headers['Apikey'] || req.query.apikey
  if (provided && expected && provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
})

async function webhookHandler(req, res) {
  try {
    const body = req.body || {}
    const event = body.event
    const instanceName = body.instance || body.instanceName
    if (!event || !instanceName) {
      return res.status(200).json({ ignored: true, reason: 'missing event or instance' })
    }

    switch (event) {
      case 'messages.upsert':
      case 'MESSAGES_UPSERT':
        await handleMessagesUpsert(body, instanceName)
        break
      case 'messages.update':
      case 'MESSAGES_UPDATE':
        await handleMessagesUpdate(req, body)
        break
      case 'connection.update':
      case 'CONNECTION_UPDATE':
        await handleConnectionUpdate(body, instanceName)
        break
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[webhookEvolution] Error processing webhook:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}

// Evolution v2 appends the event name to the URL when webhookByEvents is
// true (e.g. /webhook/evolution/messages-upsert), so mount on / and /:event.
router.post('/', webhookHandler)
router.post('/:eventName', webhookHandler)

async function handleMessagesUpsert(body, instanceName) {
  const account = await prisma.whatsAppInstance.findUnique({
    where: { instanceName },
    include: {
      menus: { select: { id: true, storeId: true }, take: 1 },
      // Also eager-load the first active menu of the first store so the
      // adapter can fall back to menu-via-store when the instance is linked
      // only to a Store (no direct Menu link). Without this, conversations
      // get menuId=null and per-menu automations never resolve.
      stores: {
        select: {
          id: true,
          menus: {
            where: { isActive: true },
            select: { id: true },
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            take: 1,
          },
        },
        take: 1,
      },
    },
  })
  if (!account) {
    console.warn(`[webhookEvolution] Unknown instance: ${instanceName}`)
    return
  }

  // Evolution echoes back our own sends AND messages typed in the Evolution
  // admin UI (fromMe=true). The pipeline is inbound-only; the echo helper
  // persists those echoes idempotently so the inbox stays in sync.
  const data = body?.data
  const events = Array.isArray(data) ? data : (data ? [data] : [])
  for (const ev of events) {
    if (ev?.key?.fromMe) {
      await persistOutboundEcho(ev, account).catch(err => {
        console.error('[webhookEvolution] outbound echo persist failed:', err?.message || err)
      })
    }
  }

  await routeInbound('EVOLUTION_WA', body, account)
}

// Maps Baileys-style status codes back to MessageStatus enum values and
// emits a Socket.IO event so the inbox UI shows the read receipt. Stays
// in this file because it's Evolution-specific.
async function handleMessagesUpdate(req, body) {
  const data = body.data || body
  const updates = Array.isArray(data) ? data : [data]
  const statusMap = { 2: 'SENT', 3: 'DELIVERED', 4: 'READ', 5: 'READ' }
  for (const update of updates) {
    try {
      const externalId = update?.key?.id
      if (!externalId) continue
      const newStatus = statusMap[update.status || update.update?.status]
      if (!newStatus) continue
      const message = await prisma.message.findFirst({
        where: { externalId },
        include: { conversation: { select: { companyId: true } } },
      })
      if (!message) continue
      await prisma.message.update({ where: { id: message.id }, data: { status: newStatus } })
      const io = req.app.get('io')
      if (io) {
        io.to(`company_${message.conversation.companyId}`).emit('inbox:message-status', {
          messageId: message.id,
          conversationId: message.conversationId,
          status: newStatus,
        })
      }
      // Mirror onto MarketingMessage (no-op if externalId doesn't match a
      // marketing send). Wrapped in try/catch so a marketing-side failure
      // never blocks the inbox status update or the rest of the batch.
      if (newStatus === 'DELIVERED' || newStatus === 'READ') {
        try {
          await applyMarketingStatusFromWebhook(
            externalId,
            newStatus === 'READ' ? 'read' : 'delivered',
            new Date(),
          )
        } catch (err) {
          console.error('[webhookEvolution] marketing status hook failed:', err?.message || err)
        }
      }
    } catch (err) {
      console.error('[webhookEvolution] Error processing message update:', err)
    }
  }
}

async function handleConnectionUpdate(body, instanceName) {
  const data = body.data || body
  const state = (data.state || data.status || '').toUpperCase()
  const stateMap = {
    OPEN: 'CONNECTED', CONNECTED: 'CONNECTED',
    CLOSE: 'DISCONNECTED', CLOSED: 'DISCONNECTED', DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'QRCODE', QRCODE: 'QRCODE',
  }
  const newStatus = stateMap[state]
  if (!newStatus) return
  await prisma.whatsAppInstance.update({
    where: { instanceName },
    data: { status: newStatus },
  }).catch((err) => {
    console.warn(`[webhookEvolution] Could not update instance status for ${instanceName}:`, err.message)
  })
}

export default router
