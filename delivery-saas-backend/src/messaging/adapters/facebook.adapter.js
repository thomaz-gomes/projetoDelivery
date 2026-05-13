// src/messaging/adapters/facebook.adapter.js
// Facebook Messenger adapter. Parses inbound `entry` payloads delivered by
// /webhook/meta (the same shared endpoint used by Meta WhatsApp Cloud and
// Instagram) and performs outbound sends via Graph API `me/messages`.
//
// Differences vs whatsappMeta.adapter.js:
//   - Inbound shape is `messaging[]` (one event per item), not `changes[]`.
//   - The user identifier is the Page-Scoped ID (PSID), not a phone number,
//     so `channelContactId` is stored verbatim with no normalisation.
//   - Attachments arrive with a public CDN URL inside `payload.url` — no
//     two-step Bearer fetch like WhatsApp, so `downloadMedia` is a no-op.
//   - The outbound API uses `?access_token=` query string + a `recipient.id`
//     PSID body, not a path-style `<phone_number_id>/messages` endpoint.

import axios from 'axios'
import { normalizedMessage, MetaWindowExpiredError } from './base.adapter.js'
import { decrypt } from '../crypto.js'
import { getMetaConfig } from '../../services/metaConfig.js'
import { prisma } from '../../prisma.js'

const PROVIDER = 'META_FB'
const CHANNEL = 'FACEBOOK'

// Meta error codes that mean the 24h messaging window has elapsed:
//   10      = "(#10) Application does not have permission to deliver
//              messages to this user." Fires when re-engaging outside the
//              standard messaging window without a valid message tag.
//   2018278 = "This message is sent outside of allowed window" /
//              re-engagement-message limit reached for the user.
const META_WINDOW_ERROR_CODES = new Set([10, 2018278])

const adapter = {
  provider: PROVIDER,
  channel: CHANNEL,

  // GET handshake is handled globally in routes/webhookMeta.js.
  async verifyWebhook(req, res) {
    res.sendStatus(200)
  },

  // entry shape (one webhook may carry multiple entries; webhookMeta.js
  // dispatches one at a time to this adapter):
  //   { id: '<page_id>', time, messaging: [{ sender, recipient, message|postback, ... }] }
  async parseInbound(entry, account) {
    const events = Array.isArray(entry?.messaging) ? entry.messaging : []
    const accountId = account?.id || null
    const companyId = account?.companyId || null

    const out = []
    const seen = new Set()

    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue

      const senderId = ev.sender?.id ? String(ev.sender.id) : null
      if (!senderId) continue

      const tsMs = Number(ev.timestamp)
      const timestamp = Number.isFinite(tsMs) && tsMs > 0 ? new Date(tsMs) : new Date()

      // Postbacks (button clicks): no `message`, has `postback`.
      if (ev.postback) {
        const payload = String(ev.postback.payload || '')
        const externalId = ev.postback.mid || `pb_${tsMs || Date.now()}_${senderId}`
        if (seen.has(externalId)) continue
        seen.add(externalId)

        const reorderButton = extractReorderFromPayload(payload)
        const body = ev.postback.title || payload || null

        out.push(normalizedMessage({
          externalId,
          channel: CHANNEL,
          provider: PROVIDER,
          companyId,
          channelContactId: senderId,
          providerAccountId: accountId,
          type: 'TEXT',
          body,
          timestamp,
          reorderButton,
          raw: ev,
        }))
        continue
      }

      const message = ev.message
      if (!message) continue

      // Page-sent (operator outbound) — handled separately, never inbound.
      if (message.is_echo) continue

      const externalId = message.mid || null
      if (externalId) {
        if (seen.has(externalId)) continue
        seen.add(externalId)
      }

      // Quick replies arrive as a regular text message with `quick_reply.payload`.
      const quickReplyPayload = message.quick_reply?.payload
        ? String(message.quick_reply.payload)
        : null
      const reorderButton = quickReplyPayload
        ? extractReorderFromPayload(quickReplyPayload)
        : null

      const attachment = Array.isArray(message.attachments) ? message.attachments[0] : null
      const info = attachment
        ? extractAttachmentInfo(attachment)
        : { type: 'TEXT', mediaUrl: null, mimeType: null }

      out.push(normalizedMessage({
        externalId,
        channel: CHANNEL,
        provider: PROVIDER,
        companyId,
        channelContactId: senderId,
        providerAccountId: accountId,
        type: info.type,
        body: message.text || null,
        mediaUrl: info.mediaUrl,
        mimeType: info.mimeType,
        timestamp,
        reorderButton,
        raw: ev,
      }))
    }

    return out
  },

  // Operator-initiated send via Graph API:
  //   POST https://graph.facebook.com/<vX.Y>/me/messages?access_token=<token>
  //   body: { recipient: { id: <PSID> }, messaging_type: 'RESPONSE', message: { ... } }
  async sendMessage(account, to, content) {
    if (!account?.accessToken) {
      throw new Error('Meta FB adapter: account.accessToken is required')
    }

    const token = safeDecrypt(account.accessToken)
    const { graphVersion } = await getMetaConfig()
    const url = `https://graph.facebook.com/${graphVersion}/me/messages?access_token=${encodeURIComponent(token)}`

    const body = buildOutboundBody(to, content)

    try {
      const { data } = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      })
      const externalId = data?.message_id || null
      return { externalId, status: 'SENT' }
    } catch (err) {
      throwMappedError(err, { channelContactId: to, accountId: account.id })
    }
  },

  async sendMedia(account, to, mediaUrl, type, caption) {
    if (!mediaUrl) {
      return adapter.sendMessage(account, to, { type: 'TEXT', text: caption || '' })
    }
    if (caption) {
      await adapter.sendMessage(account, to, { type: 'TEXT', text: caption })
    }
    return adapter.sendMessage(account, to, {
      type: String(type || 'IMAGE').toUpperCase(),
      mediaUrl,
    })
  },

  // externalId here is the Facebook Page ID (matches what webhookMeta.js
  // extracts from entry.id for Messenger payloads).
  async resolveAccount(externalId) {
    if (!externalId) return null
    return prisma.metaMessagingAccount.findFirst({
      where: { provider: PROVIDER, externalId: String(externalId) },
    })
  },

  // Facebook attachments arrive with public CDN URLs — no Bearer fetch
  // required. The pipeline can read `mediaUrl` directly off the normalised
  // message, so there is nothing to do here.
  async downloadMedia() {
    return null
  },
}

// ─── helpers ────────────────────────────────────────────────────────────────

function safeDecrypt(token) {
  try {
    return decrypt(token)
  } catch {
    return token
  }
}

function extractAttachmentInfo(attachment) {
  const t = String(attachment?.type || '').toLowerCase()
  const url = attachment?.payload?.url || null

  if (t === 'image') return { type: 'IMAGE', mediaUrl: url, mimeType: 'image/jpeg' }
  if (t === 'audio') return { type: 'AUDIO', mediaUrl: url, mimeType: 'audio/mpeg' }
  if (t === 'video') return { type: 'VIDEO', mediaUrl: url, mimeType: 'video/mp4' }
  if (t === 'file') return { type: 'DOCUMENT', mediaUrl: url, mimeType: 'application/octet-stream' }

  // Fallback: treat unknown attachment types as TEXT (raw payload is kept
  // on normalizedMessage.raw for debugging).
  return { type: 'TEXT', mediaUrl: null, mimeType: null }
}

// Detects a postback / quick-reply payload of the form `reorder:<orderId>`.
function extractReorderFromPayload(payload) {
  if (!payload || typeof payload !== 'string') return null
  if (!payload.startsWith('reorder:')) return null
  const orderId = payload.slice('reorder:'.length).trim()
  if (!orderId) return null
  return { orderId }
}

function buildOutboundBody(to, content) {
  const type = String(content?.type || 'TEXT').toUpperCase()
  const recipient = { id: String(to) }

  if (type === 'TEXT') {
    return {
      recipient,
      messaging_type: 'RESPONSE',
      message: { text: content?.text ?? content?.body ?? '' },
    }
  }

  const attachType = type.toLowerCase() // 'image' | 'audio' | 'video' | 'file' (also DOCUMENT → 'document')
  // Normalise DOCUMENT → 'file' to match the Messenger Send API.
  const apiType = attachType === 'document' ? 'file' : attachType
  return {
    recipient,
    messaging_type: 'RESPONSE',
    message: {
      attachment: {
        type: apiType,
        payload: { url: content?.mediaUrl, is_reusable: false },
      },
    },
  }
}

function throwMappedError(err, ctx) {
  const data = err?.response?.data
  const errorObj = data?.error || data?.errors?.[0] || null
  const code = Number(errorObj?.code)
  if (code && META_WINDOW_ERROR_CODES.has(code)) {
    throw new MetaWindowExpiredError(CHANNEL, {
      channelContactId: ctx?.channelContactId || null,
      accountId: ctx?.accountId || null,
    })
  }
  const wrapped = new Error(errorObj?.message || err?.message || 'Meta FB send failed')
  wrapped.cause = err
  wrapped.metaCode = code || null
  wrapped.metaError = errorObj || null
  throw wrapped
}

export default adapter
