// src/messaging/evolutionOutboundEcho.js
// Evolution-specific: persist fromMe events the webhook surfaces. Evolution
// echoes back OUTBOUND messages — both those we sent via our app (already
// persisted by router.sendOutbound / notify.js, deduped here by externalId)
// and messages typed directly in the Evolution admin web UI. Without this
// helper the latter would be invisible in our inbox.
//
// This lives in the messaging layer (not in routes/webhookEvolution.js) to
// keep that file as a thin handler. The Meta adapters don't need an
// equivalent: their APIs don't deliver fromMe webhook events.

import { prisma } from '../prisma.js'
import { phoneVariants } from './phoneVariants.js'
import { extractMessageInfo } from './adapters/whatsappEvolution.adapter.js'
import { emitirInboxNewMessage } from '../socketEmitters.js'

export async function persistOutboundEcho(ev, account) {
  const key = ev?.key || {}
  const externalId = key.id || null
  const remoteJid = key.remoteJid || ''

  if (
    !remoteJid ||
    remoteJid.endsWith('@g.us') ||
    remoteJid.endsWith('@broadcast') ||
    remoteJid === 'status@broadcast'
  ) return

  const messageContent = ev?.message || {}
  if (messageContent.protocolMessage || messageContent.reactionMessage) return

  if (externalId) {
    const existing = await prisma.message.findFirst({
      where: { externalId, conversation: { companyId: account.companyId } },
      select: { id: true },
    })
    if (existing) return
  }

  const phone = remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '')
  if (!phone) return

  // Match the inbound pipeline's lookup: legacy rows may have been stored
  // under any of the phone variants (with/without DDI, with/without 9th
  // digit), so query against the full set rather than the raw remoteJid.
  const variants = phoneVariants(phone)
  const conversation = await prisma.conversation.findFirst({
    where: {
      companyId: account.companyId,
      channel: 'WHATSAPP',
      channelContactId: { in: variants },
    },
  })
  if (!conversation) return // no conversation row → nothing to attach the echo to

  // Extract the same type/body/mediaUrl/mimeType set the inbound adapter uses
  // (IMAGE/AUDIO/VIDEO/DOCUMENT/LOCATION/STICKER/TEXT). Media echoes from the
  // admin web UI are uncommon but they DO happen; flattening them to TEXT
  // (the pre-fix behaviour) lost the attachment in the operator inbox.
  const info = extractMessageInfo(messageContent)

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      externalId,
      direction: 'OUTBOUND',
      type: info.type,
      body: info.body || null,
      mediaUrl: info.mediaUrl || null,
      mediaMimeType: info.mimeType || null,
      mediaFileName: info.mediaFileName || null,
      latitude: info.latitude != null ? Number(info.latitude) : null,
      longitude: info.longitude != null ? Number(info.longitude) : null,
      status: 'SENT',
    },
  })

  // Mirror inboundPipeline's provider/account backfill block: if the
  // conversation is a legacy row that hasn't seen an inbound yet, the
  // operator may still send via router.sendOutbound, which requires
  // provider/providerAccountId to resolve the adapter. Filling them here
  // means future outbounds don't have to rely on the instanceName fallback.
  const convUpdate = { lastMessageAt: new Date() }
  if (!conversation.provider) convUpdate.provider = 'EVOLUTION_WA'
  if (!conversation.providerAccountId && account?.id) convUpdate.providerAccountId = account.id
  if (!conversation.instanceName && account?.instanceName) convUpdate.instanceName = account.instanceName

  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: convUpdate,
    include: {
      customer: { select: { id: true, fullName: true, whatsapp: true } },
      assignedUser: { select: { id: true, name: true } },
      store: { select: { id: true, name: true } },
      // Inbox header falls back to store.name when menu is undefined —
      // load both so the socket payload matches the REST GET shape.
      menu: { select: { id: true, name: true } },
    },
  })

  // Emit so the operator inbox UI reflects messages typed in the Evolution
  // admin UI in real time. The OLD webhookEvolution.js emitted for fromMe
  // too — the `direction === 'INBOUND'` gate there only affected unread/
  // reopen, not the inbox:new-message broadcast.
  try {
    await emitirInboxNewMessage({
      companyId: account.companyId,
      conversation: updatedConversation,
      message,
    })
  } catch (err) {
    console.warn('[evolutionOutboundEcho] failed to emit inbox:new-message', err?.message || err)
  }
}

export default { persistOutboundEcho }
