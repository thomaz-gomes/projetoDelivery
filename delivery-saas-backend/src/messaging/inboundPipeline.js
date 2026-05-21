// src/messaging/inboundPipeline.js
// Channel-agnostic inbound message pipeline. Receives a NormalizedMessage
// (see adapters/base.adapter.js#normalizedMessage) from any adapter and:
//   1. Deduplicates by externalId within the company
//   2. Resolves the Customer (by phone for WhatsApp, by metaIdentities for Meta channels)
//   3. Resolves the Conversation (find or create by company+channel+contact)
//   4. Persists the Message
//   5. Updates the Conversation (last activity, unread, status reopen, backfill linkage)
//   6. Pre-automation hook: handle interactive-button taps (reorder etc.)
//   7. Runs automations (greeting, out-of-hours, keyword→tag, etc.)
//   8. Emits Socket.IO inbox:new-message

import { prisma } from '../prisma.js'
import { emitirInboxNewMessage } from '../socketEmitters.js'
import { runAutomations } from './automations.js'
import { handleButtonReply } from './buttonReplies.js'
import { phoneVariants } from './phoneVariants.js'

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
      mediaFileName: msg.mediaFileName || null,
      latitude: msg.latitude != null ? Number(msg.latitude) : null,
      longitude: msg.longitude != null ? Number(msg.longitude) : null,
      externalId: msg.externalId,
      status: 'DELIVERED',
      createdAt: msg.timestamp,
    },
  })

  // 5. Update Conversation last activity + unread + status reopen + backfill
  const updateData = {
    lastMessageAt: msg.timestamp,
    unreadCount: { increment: 1 },
  }
  if (conversation.status === 'CLOSED') updateData.status = 'OPEN'
  if (msg.contactName && !conversation.contactName) updateData.contactName = msg.contactName
  if (customer?.id && !conversation.customerId) updateData.customerId = customer.id
  if (msg.menuId && !conversation.menuId) updateData.menuId = msg.menuId
  if (msg.storeId && !conversation.storeId) updateData.storeId = msg.storeId
  if (msg.instanceName && !conversation.instanceName) updateData.instanceName = msg.instanceName
  if (msg.providerAccountId && !conversation.providerAccountId) {
    updateData.providerAccountId = msg.providerAccountId
  }
  if (msg.provider && !conversation.provider) updateData.provider = msg.provider

  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: updateData,
    include: {
      customer: { select: { id: true, fullName: true, whatsapp: true } },
      assignedUser: { select: { id: true, name: true } },
      store: { select: { id: true, name: true } },
    },
  })

  // 6. Emit Socket.IO event so the inbox UI updates in real time. Emit before
  //    automations so the operator sees the message immediately even if an
  //    automation send takes a few hundred ms.
  try {
    await emitirInboxNewMessage({
      companyId: msg.companyId,
      conversation: updatedConversation,
      message,
    })
  } catch (err) {
    console.warn('[inboundPipeline] failed to emit inbox:new-message', err?.message || err)
  }

  // 7. Pre-automation hook: handle interactive-button taps (reorder etc.).
  //    When a recognised button fires we short-circuit the rest of the
  //    automation pipeline so the customer isn't greeted twice in the same
  //    minute.
  try {
    const handled = await handleButtonReply({
      conversation: updatedConversation,
      normalizedMessage: msg,
    })
    if (handled) return { skipped: false, messageId: message.id, buttonHandled: true }
  } catch (err) {
    console.error('[inboundPipeline] button-reply handler error', err)
  }

  // 8. Run automations (greeting, out-of-hours, keyword tagging, etc.)
  try {
    await runAutomations({
      conversation: updatedConversation,
      message,
      customer,
      normalizedMessage: msg,
    })
  } catch (err) {
    console.error('[inboundPipeline] automations error', err)
  }

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
  if (customer) {
    // Normalize stored whatsapp to the canonical (with-DDI, with-9) form if
    // the existing record is a legacy variant. Best-effort; failures (e.g.
    // unique conflict) are silently swallowed.
    if (customer.whatsapp !== phone) {
      await prisma.customer
        .update({ where: { id: customer.id }, data: { whatsapp: phone } })
        .catch(() => {})
    }
    return customer
  }

  // Race-safe create: the @@unique([companyId, whatsapp]) (`company_whatsapp`)
  // constraint can fire if a concurrent webhook for the same contact races
  // past the findFirst above. On P2002, re-query and return the winner.
  try {
    customer = await prisma.customer.create({
      data: {
        companyId: msg.companyId,
        whatsapp: phone,
        // Match OLD webhookEvolution.js: null fallback so unnamed customers
        // don't show their phone number as their display name in the CRM.
        fullName: msg.contactName || null,
      },
    })
    return customer
  } catch (err) {
    if (err && err.code === 'P2002') {
      customer = await prisma.customer.findFirst({
        where: { companyId: msg.companyId, whatsapp: { in: variants } },
      })
      if (customer) return customer
    }
    throw err
  }
}

async function resolveCustomerByMetaIdentity(msg) {
  const identity = { provider: msg.provider, externalId: msg.channelContactId }
  // Fetch full rows so the matched candidate can be returned directly,
  // saving an extra findUnique round-trip. (The GIN/JSONB-containment
  // followup for scale is tracked in the design doc.)
  const candidates = await prisma.customer.findMany({
    where: { companyId: msg.companyId, metaIdentities: { not: null } },
  })
  const found = candidates.find(c => {
    const ids = c.metaIdentities
    if (!Array.isArray(ids)) return false
    return ids.some(i => i.provider === identity.provider && i.externalId === identity.externalId)
  })
  if (found) return found

  // No unique constraint on metaIdentities, so concurrent webhooks may
  // create duplicate customers; that trade-off is acknowledged in the
  // design doc and is preferable to over-engineering here.
  return prisma.customer.create({
    data: {
      companyId: msg.companyId,
      fullName: msg.contactName || 'Cliente Meta',
      metaIdentities: [identity],
    },
  })
}

async function resolveConversation(msg, customer) {
  // For WhatsApp, the same contact can show up under multiple phone variants
  // (with/without 9th digit). Look up the conversation across all variants
  // to avoid creating duplicates.
  const contactIds = msg.channel === 'WHATSAPP'
    ? phoneVariants(msg.channelContactId)
    : [msg.channelContactId]

  // Fast path: existing conversation. The lookup includes providerAccountId
  // so that the same phone messaging two different accounts (e.g. Evolution
  // instance for store A vs Meta Cloud account for store B) yields two
  // distinct conversations instead of merging into one.
  const providerAccountId = msg.providerAccountId ?? null
  let conversation = await prisma.conversation.findFirst({
    where: {
      companyId: msg.companyId,
      channel: msg.channel,
      channelContactId: { in: contactIds },
      providerAccountId,
    },
  })
  if (conversation) {
    // Reopen conversations that were auto-closed by the 24h inactivity job
    // (or manually closed/archived) — inbound traffic should always bring
    // them back into the operator's main queue.
    const patch = {}
    if (!conversation.provider && msg.provider) patch.provider = msg.provider
    if (conversation.status !== 'OPEN') patch.status = 'OPEN'
    if (Object.keys(patch).length) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: patch,
      })
    }
    return conversation
  }

  // Race-safe create: two concurrent webhooks for the same brand-new contact
  // can both pass findFirst and both reach create, with the second throwing
  // P2002 on @@unique([companyId, channel, channelContactId, providerAccountId]).
  // On conflict, re-query and return the winning row.
  try {
    return await prisma.conversation.create({
      data: {
        companyId: msg.companyId,
        channel: msg.channel,
        provider: msg.provider,
        providerAccountId,
        instanceName: msg.instanceName || null,
        storeId: msg.storeId || null,
        menuId: msg.menuId || null,
        channelContactId: msg.channelContactId,
        customerId: customer?.id,
        contactName: msg.contactName || null,
        status: 'OPEN',
        unreadCount: 0,
      },
    })
  } catch (err) {
    if (err && err.code === 'P2002') {
      conversation = await prisma.conversation.findFirst({
        where: {
          companyId: msg.companyId,
          channel: msg.channel,
          channelContactId: { in: contactIds },
          providerAccountId,
        },
      })
      if (conversation) return conversation
    }
    throw err
  }
}
