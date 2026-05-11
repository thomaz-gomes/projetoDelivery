// src/messaging/adapters/whatsappEvolution.adapter.js
// Evolution API (Baileys-backed WhatsApp) adapter for the channel-agnostic
// messaging router. Parses inbound webhook payloads from Evolution v2 and
// performs outbound sends via the helpers in src/wa.js so we match the URL
// fan-out / header pattern the rest of the codebase already uses.
//
// Parser logic is ported from webhookEvolution.js#processSingleMessage and
// #extractMessageInfo (~Feb 2026) — do NOT diverge without coordinating with
// that file, since both coexist until Task 12 swaps the webhook over.

import { normalizedMessage } from './base.adapter.js'
import { normalizePhone } from '../phoneVariants.js'
import { prisma } from '../../prisma.js'
import { evoSendText, evoSendMediaUrl } from '../../wa.js'

const PROVIDER = 'EVOLUTION_WA'
const CHANNEL = 'WHATSAPP'

const adapter = {
  provider: PROVIDER,
  channel: CHANNEL,

  // Evolution webhooks don't require a verify handshake (unlike Meta).
  async verifyWebhook(req, res) {
    res.sendStatus(200)
  },

  // payload shape (Evolution v2):
  //   { event, instance, data: { key, message, pushName, messageTimestamp } }
  //   - data may also be an array of message objects (MESSAGES_UPSERT batch)
  // account: a WhatsAppInstance row (id, companyId, instanceName, ...)
  async parseInbound(payload, account) {
    const raw = payload?.data
    const events = Array.isArray(raw) ? raw : (raw ? [raw] : [])

    const out = []
    const seen = new Set()
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue
      const key = ev.key || {}
      const remoteJid = key.remoteJid || ''

      // Skip group, broadcast, and status — mirrors webhookEvolution.js
      if (
        !remoteJid ||
        remoteJid.endsWith('@g.us') ||
        remoteJid.endsWith('@broadcast') ||
        remoteJid === 'status@broadcast'
      ) continue

      // Skip protocol and reaction frames
      const messageContent = ev.message || {}
      if (messageContent.protocolMessage || messageContent.reactionMessage) continue

      const externalId = key.id || null
      if (externalId) {
        if (seen.has(externalId)) continue
        seen.add(externalId)
      }

      const rawPhone = remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '')
      if (!rawPhone) continue
      const phone = normalizePhone(rawPhone)

      const info = extractMessageInfo(messageContent)
      const tsSeconds = Number(ev.messageTimestamp)
      const timestamp = Number.isFinite(tsSeconds) && tsSeconds > 0
        ? new Date(tsSeconds * 1000)
        : new Date()

      out.push(normalizedMessage({
        externalId,
        channel: CHANNEL,
        provider: PROVIDER,
        companyId: account?.companyId || null,
        channelContactId: phone,
        contactName: ev.pushName || null,
        type: info.type,
        body: info.body,
        mediaUrl: info.mediaUrl,
        mimeType: info.mimeType,
        timestamp,
        raw: ev,
      }))
    }
    return out
  },

  // Operator-initiated text send. We delegate to evoSendText (wa.js) which
  // already handles the URL fan-out across Evolution build variants.
  async sendMessage(account, to, content) {
    const instanceName = account?.instanceName
    if (!instanceName) throw new Error('Evolution adapter: account.instanceName is required')
    const text = content?.text ?? content?.body ?? ''
    const data = await evoSendText({ instanceName, to, text })
    return {
      externalId: data?.key?.id || null,
      status: 'SENT',
    }
  },

  // TODO(Task 12): port full media send (file upload, monthDir, etc.).
  // For now, delegate to evoSendMediaUrl assuming mediaUrl is already a public
  // URL the Evolution API can reach. If only text/caption is supplied, fall
  // back to sendMessage so callers aren't blocked by media gaps.
  async sendMedia(account, to, mediaUrl, type, caption) {
    const instanceName = account?.instanceName
    if (!instanceName) throw new Error('Evolution adapter: account.instanceName is required')
    if (!mediaUrl) {
      return adapter.sendMessage(account, to, { text: caption || '' })
    }
    const mimeType = inferMimeTypeForKind(type)
    const data = await evoSendMediaUrl({
      instanceName,
      to,
      mediaUrl,
      mimeType,
      caption: caption || '',
    })
    return {
      externalId: data?.key?.id || null,
      status: 'SENT',
    }
  },

  async resolveAccount(externalId /* instance name */) {
    if (!externalId) return null
    return prisma.whatsAppInstance.findFirst({ where: { instanceName: externalId } })
  },

  // Evolution surfaces media as URLs inside the payload; the inbound pipeline
  // stores the URL as-is and the existing webhook code does the decryption.
  // Returning null tells the pipeline "nothing extra to fetch here".
  async downloadMedia() {
    return null
  },
}

// ─── helpers (ported from webhookEvolution.js#extractMessageInfo) ───────────

function extractMessageInfo(messageContent) {
  if (messageContent.imageMessage) {
    const im = messageContent.imageMessage
    return {
      type: 'IMAGE',
      body: im.caption || null,
      mediaUrl: im.url || null,
      mimeType: im.mimetype || 'image/jpeg',
    }
  }
  if (messageContent.audioMessage) {
    const am = messageContent.audioMessage
    return {
      type: 'AUDIO',
      body: null,
      mediaUrl: am.url || null,
      mimeType: am.mimetype || 'audio/ogg',
    }
  }
  if (messageContent.videoMessage) {
    const vm = messageContent.videoMessage
    return {
      type: 'VIDEO',
      body: vm.caption || null,
      mediaUrl: vm.url || null,
      mimeType: vm.mimetype || 'video/mp4',
    }
  }
  if (messageContent.documentWithCaptionMessage) {
    const docMsg = messageContent.documentWithCaptionMessage.message?.documentMessage || {}
    return {
      type: 'DOCUMENT',
      body: docMsg.caption || null,
      mediaUrl: docMsg.url || null,
      mimeType: docMsg.mimetype || 'application/octet-stream',
    }
  }
  if (messageContent.documentMessage) {
    const dm = messageContent.documentMessage
    return {
      type: 'DOCUMENT',
      body: dm.caption || null,
      mediaUrl: dm.url || null,
      mimeType: dm.mimetype || 'application/octet-stream',
    }
  }
  if (messageContent.locationMessage) {
    const loc = messageContent.locationMessage
    return {
      type: 'LOCATION',
      body: loc.name || loc.address || `${loc.degreesLatitude},${loc.degreesLongitude}`,
      mediaUrl: null,
      mimeType: null,
    }
  }
  if (messageContent.stickerMessage) {
    const sm = messageContent.stickerMessage
    return {
      type: 'STICKER',
      body: null,
      mediaUrl: sm.url || null,
      mimeType: sm.mimetype || 'image/webp',
    }
  }
  // Default: text
  const body =
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    null
  return { type: 'TEXT', body, mediaUrl: null, mimeType: null }
}

function inferMimeTypeForKind(kind) {
  const k = String(kind || '').toUpperCase()
  if (k === 'IMAGE') return 'image/jpeg'
  if (k === 'VIDEO') return 'video/mp4'
  if (k === 'AUDIO') return 'audio/ogg'
  if (k === 'STICKER') return 'image/webp'
  return 'application/octet-stream'
}

export default adapter
