// src/messaging/router.js
// Central dispatcher for messaging adapters. Maps MessagingProvider → adapter
// module via a lazy registry (adapters self-register at load time to avoid
// circular imports), and exposes two entry points:
//
//   - routeInbound(provider, payload, account):
//       webhook → adapter.parseInbound → inboundPipeline.process
//
//   - sendOutbound({ conversationId, content, userId }):
//       operator → resolveAccount → adapter.sendMessage → persist OUTBOUND
//       Message → emit Socket.IO inbox:new-message (so the operator's inbox
//       UI updates in real time, matching the pattern used by webhookEvolution
//       and notify.js).

import { prisma } from '../prisma.js'
import * as inboundPipeline from './inboundPipeline.js'
import { emitirInboxNewMessage } from '../socketEmitters.js'
import { MessagingError } from './adapters/base.adapter.js'

// provider (MessagingProvider enum string) → adapter module
const adapterRegistry = new Map()

export function registerAdapter(provider, adapter) {
  adapterRegistry.set(provider, adapter)
}

export function getAdapter(provider) {
  const a = adapterRegistry.get(provider)
  if (!a) throw new MessagingError(`No adapter registered for ${provider}`, 'NO_ADAPTER')
  return a
}

// Webhook → adapter.parseInbound → pipeline.process (per message)
export async function routeInbound(provider, payload, account) {
  const adapter = getAdapter(provider)
  const messages = await adapter.parseInbound(payload, account)
  const results = []
  for (const msg of messages) {
    try {
      const r = await inboundPipeline.process(msg)
      results.push({ ok: true, ...r })
    } catch (err) {
      console.error('[router.routeInbound] pipeline error', err)
      results.push({ ok: false, error: err.message })
    }
  }
  return results
}

// Operator-initiated send: resolve account → adapter.sendMessage → persist
// OUTBOUND Message → update Conversation.lastMessageAt → emit Socket.IO.
export async function sendOutbound({ conversationId, content, userId }) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } })
  if (!conv) throw new MessagingError('Conversation not found', 'NOT_FOUND')
  if (!conv.provider) throw new MessagingError('Conversation has no provider set', 'NO_PROVIDER')

  const adapter = getAdapter(conv.provider)
  const account = await resolveAccount(conv)

  const result = await adapter.sendMessage(account, conv.channelContactId, content)

  const message = await prisma.message.create({
    data: {
      conversationId: conv.id,
      direction: 'OUTBOUND',
      type: content.type,
      body: content.text || null,
      mediaUrl: content.mediaUrl || null,
      mediaMimeType: content.mimeType || null,
      externalId: result.externalId || null,
      status: result.status || 'SENT',
      authorUserId: userId || null,
    },
  })

  const updatedConv = await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date() },
  })

  // Emit inbox:new-message so the attendant UI updates in real time, mirroring
  // the pattern in webhookEvolution.js (inbound) and notify.js (outbound).
  try {
    await emitirInboxNewMessage({
      companyId: conv.companyId,
      conversation: updatedConv,
      message,
    })
  } catch (err) {
    console.warn('[router.sendOutbound] failed to emit inbox:new-message', err?.message || err)
  }

  return message
}

async function resolveAccount(conv) {
  if (conv.provider === 'EVOLUTION_WA') {
    return prisma.whatsAppInstance.findUnique({ where: { id: conv.providerAccountId } })
  }
  return prisma.metaMessagingAccount.findUnique({ where: { id: conv.providerAccountId } })
}
