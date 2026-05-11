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

  const conversation = await prisma.conversation.findFirst({
    where: { companyId: account.companyId, channel: 'WHATSAPP', channelContactId: phone },
    select: { id: true },
  })
  if (!conversation) return // no conversation row → nothing to attach the echo to

  // Only text echoes need real content; media echoes from the admin UI are
  // uncommon. The body is null for non-text frames and the type stays TEXT
  // (matches the old webhookEvolution.js behaviour for echoes).
  const body =
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    null

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      externalId,
      direction: 'OUTBOUND',
      type: 'TEXT',
      body,
      status: 'SENT',
    },
  })
}

export default { persistOutboundEcho }
