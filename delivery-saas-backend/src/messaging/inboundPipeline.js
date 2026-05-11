// src/messaging/inboundPipeline.js
// Channel-agnostic inbound message pipeline. Receives a NormalizedMessage
// (see adapters/base.adapter.js#normalizedMessage) from any adapter and:
//   1. Deduplicates by externalId within the company
//   2. Resolves the Customer (by phone for WhatsApp, by metaIdentities for Meta channels)
//   3. Resolves the Conversation (find or create by company+channel+contact)
//   4. Persists the Message
//   5. Updates the Conversation lastMessageAt / unreadCount
//   6. Runs automations (greeting, out-of-hours, keyword→tag, etc.)
//   7. Emits Socket.IO inbox:new-message
//
// NOTE: `automations.js` and `phoneVariants.js` are added in Tasks 8 and 9.
// Until then this module's imports below will fail at runtime — that's
// expected. The file is parse-clean and the structure is final.

import { prisma } from '../prisma.js'
import { emitirInboxNewMessage } from '../socketEmitters.js'
import { runAutomations } from './automations.js'

export async function process(msg) {
  // 1. Dedup by externalId scoped to companyId
  if (msg.externalId) {
    const existing = await prisma.message.findFirst({
      where: {
        externalId: msg.externalId,
        conversation: { companyId: msg.companyId },
      },
      select: { id: true },
    })
    if (existing) return { skipped: true, reason: 'duplicate' }
  }

  // 2. Find / create Customer
  const customer = await resolveCustomer(msg)

  // 3. Find / create Conversation
  const conversation = await resolveConversation(msg, customer)

  // 4. Persist Message
  // NOTE: schema uses `mediaMimeType`, but NormalizedMessage exposes `mimeType`.
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'INBOUND',
      type: msg.type,
      body: msg.body,
      mediaUrl: msg.mediaUrl,
      mediaMimeType: msg.mimeType,
      externalId: msg.externalId,
      status: 'DELIVERED',
      createdAt: msg.timestamp,
    },
  })

  // 5. Update Conversation last activity + unread counter
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: msg.timestamp,
      unreadCount: { increment: 1 },
    },
  })

  // 6. Run automations (greeting, out-of-hours, keyword tagging, etc.)
  await runAutomations({ conversation, message, customer, normalizedMessage: msg })

  // 7. Emit Socket.IO event so the inbox UI updates in real time
  await emitirInboxNewMessage({
    companyId: msg.companyId,
    conversation: { ...conversation, lastMessageAt: msg.timestamp },
    message,
  })

  return { skipped: false, messageId: message.id }
}

async function resolveCustomer(msg) {
  if (msg.channel === 'WHATSAPP') {
    return resolveCustomerByPhone(msg)
  }
  return resolveCustomerByMetaIdentity(msg)
}

async function resolveCustomerByPhone(msg) {
  const phone = msg.channelContactId
  const variants = phoneVariants(phone)
  let customer = await prisma.customer.findFirst({
    where: { companyId: msg.companyId, whatsapp: { in: variants } },
  })
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        companyId: msg.companyId,
        whatsapp: phone,
        fullName: msg.contactName || phone,
      },
    })
  }
  return customer
}

async function resolveCustomerByMetaIdentity(msg) {
  const identity = { provider: msg.provider, externalId: msg.channelContactId }
  const candidates = await prisma.customer.findMany({
    where: { companyId: msg.companyId, metaIdentities: { not: null } },
    select: { id: true, metaIdentities: true },
  })
  const found = candidates.find(c => {
    const ids = c.metaIdentities
    if (!Array.isArray(ids)) return false
    return ids.some(i => i.provider === identity.provider && i.externalId === identity.externalId)
  })
  if (found) return prisma.customer.findUnique({ where: { id: found.id } })

  return prisma.customer.create({
    data: {
      companyId: msg.companyId,
      fullName: msg.contactName || 'Cliente Meta',
      metaIdentities: [identity],
    },
  })
}

async function resolveConversation(msg, customer) {
  let conversation = await prisma.conversation.findFirst({
    where: {
      companyId: msg.companyId,
      channel: msg.channel,
      channelContactId: msg.channelContactId,
    },
  })
  if (conversation) {
    if (!conversation.provider) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { provider: msg.provider },
      })
    }
    return conversation
  }
  return prisma.conversation.create({
    data: {
      companyId: msg.companyId,
      channel: msg.channel,
      provider: msg.provider,
      channelContactId: msg.channelContactId,
      customerId: customer?.id,
      contactName: msg.contactName || null,
      status: 'OPEN',
      unreadCount: 0,
    },
  })
}

// Stub — replaced by the real helper in Task 9 (phoneVariants.js).
// Keeping a local fallback so this module parses and unit tests for the
// non-WhatsApp paths can run before Task 9 lands.
function phoneVariants(phone) {
  return [phone]
}
