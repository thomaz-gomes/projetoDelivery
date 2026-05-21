// src/messaging/adapters/whatsappMeta.adapter.js
// WhatsApp Cloud API adapter (Meta-hosted, mod 65 in the messaging plan).
// Parses inbound `entry` payloads delivered by /webhook/meta and performs
// outbound sends via the Graph API. The webhook handler in
// routes/webhookMeta.js verifies X-Hub-Signature-256, maps `payload.object`
// to a MessagingProvider, resolves the MetaMessagingAccount row, and then
// hands ONE entry at a time to router.routeInbound → parseInbound.
//
// Why two-step media: unlike Evolution (which embeds base64 / has its own
// decryption endpoint), Meta only exposes media via short-lived URLs that
// require the Bearer access token to fetch. To keep the webhook fast and
// idempotent, parseInbound never fetches media inline — it leaves
// `mediaUrl: null` and stores the Meta media id on the normalised message.
// downloadMedia(mediaId, account) does the real two-step fetch when needed
// (operator-facing UI or a background job can call it lazily).

import axios from 'axios'
import { normalizedMessage, MetaWindowExpiredError } from './base.adapter.js'
import { normalizePhone } from '../phoneVariants.js'
import { decrypt } from '../crypto.js'
import { getMetaConfig } from '../../services/metaConfig.js'
import { prisma } from '../../prisma.js'

const PROVIDER = 'META_WA'
const CHANNEL = 'WHATSAPP'

// Meta error codes that mean the 24h customer-service window has elapsed.
// 131047 = "More than 24 hours after the last user message"
// 131051 = "Unsupported message type" historically also fires when re-engaging
//          outside the window; we treat both as window-expired.
const META_WINDOW_ERROR_CODES = new Set([131047, 131051])

const adapter = {
  provider: PROVIDER,
  channel: CHANNEL,

  // The GET handshake is handled globally in routes/webhookMeta.js.
  async verifyWebhook(req, res) {
    res.sendStatus(200)
  },

  // entry shape (one webhook may carry multiple entries; webhookMeta.js
  // dispatches one at a time to this adapter):
  //   { id: '<WABA_id>', changes: [{ field: 'messages', value: { ... } }, ...] }
  //
  // value.messages[] carries the actual inbound. value.statuses[] carries
  // delivery / read receipts and is ignored here (separate concern that the
  // pipeline does not currently consume).
  async parseInbound(entry, account) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    const accountId = account?.id || null
    const companyId = account?.companyId || null
    // Derive store/menu from the first Menu linked to this Meta WA account
    // (mirrors whatsappEvolution.adapter.js). Requires webhookMeta.js to
    // eager-load `menusAsMetaWa` when resolving the account.
    const menuId = account?.menusAsMetaWa?.[0]?.id || null
    const storeId = account?.menusAsMetaWa?.[0]?.storeId || null

    const out = []
    const seen = new Set()

    for (const change of changes) {
      const value = change?.value
      if (!value || typeof value !== 'object') continue

      const messages = Array.isArray(value.messages) ? value.messages : []
      if (!messages.length) continue // skips statuses[] / errors[] events

      // Map wa_id → profile.name for contact-name lookup.
      const contactsByWaId = new Map()
      const contacts = Array.isArray(value.contacts) ? value.contacts : []
      for (const c of contacts) {
        if (c?.wa_id) contactsByWaId.set(String(c.wa_id), c.profile?.name || null)
      }

      for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue
        const externalId = msg.id || null
        if (externalId) {
          if (seen.has(externalId)) continue
          seen.add(externalId)
        }

        const from = msg.from ? String(msg.from) : null
        if (!from) continue
        const phone = normalizePhone(from)

        const info = extractMessageInfo(msg)
        const tsSeconds = Number(msg.timestamp)
        const timestamp = Number.isFinite(tsSeconds) && tsSeconds > 0
          ? new Date(tsSeconds * 1000)
          : new Date()

        const reorderButton = extractReorderButton(msg)

        out.push(normalizedMessage({
          externalId,
          channel: CHANNEL,
          provider: PROVIDER,
          companyId,
          channelContactId: phone,
          providerAccountId: accountId,
          menuId,
          storeId,
          contactName: contactsByWaId.get(from) || null,
          type: info.type,
          body: info.body,
          mediaUrl: null, // resolved later via downloadMedia (Meta exige token)
          mimeType: info.mimeType,
          mediaFileName: info.mediaFileName,
          mediaId: info.mediaId,
          latitude: info.latitude,
          longitude: info.longitude,
          reorderButton,
          timestamp,
          raw: msg,
        }))
      }
    }

    return out
  },

  // Operator-initiated send via Graph API:
  //   POST https://graph.facebook.com/<vX.Y>/<phone_number_id>/messages
  //   Authorization: Bearer <accessToken>
  //   body: { messaging_product: 'whatsapp', to, type, <type-payload> }
  //
  // Returns { externalId, status } so the router can persist linkage.
  async sendMessage(account, to, content) {
    if (!account?.externalId) {
      throw new Error('Meta WA adapter: account.externalId (phone_number_id) is required')
    }
    if (!account?.accessToken) {
      throw new Error('Meta WA adapter: account.accessToken is required')
    }

    const token = safeDecrypt(account.accessToken)
    const { graphVersion } = await getMetaConfig()
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.externalId)}/messages`

    const body = buildOutboundBody(to, content)

    try {
      const { data } = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      })
      const externalId = data?.messages?.[0]?.id || null
      return { externalId, status: 'SENT' }
    } catch (err) {
      throwMappedError(err, { channelContactId: to, accountId: account.id })
    }
  },

  async sendMedia(account, to, mediaUrl, type, caption) {
    if (!mediaUrl) {
      return adapter.sendMessage(account, to, { type: 'TEXT', text: caption || '' })
    }
    return adapter.sendMessage(account, to, {
      type: String(type || 'IMAGE').toUpperCase(),
      mediaUrl,
      text: caption || '',
    })
  },

  // externalId here is the WhatsApp phone_number_id (matches the value
  // webhookMeta.js extracts from changes[].value.metadata.phone_number_id).
  async resolveAccount(externalId) {
    if (!externalId) return null
    return prisma.metaMessagingAccount.findFirst({
      where: { provider: PROVIDER, externalId: String(externalId) },
    })
  },

  // Meta media is fetched in two steps:
  //   1) GET /<media_id>  → { url, mime_type, sha256, file_size, ... }
  //   2) GET <url>        → bytes (Bearer auth required on BOTH calls)
  // The `url` returned by step 1 is short-lived (~5 min), so don't cache it.
  // Returns { buffer, mimeType, fileSize } for the caller to persist locally.
  async downloadMedia(mediaId, account) {
    if (!mediaId) throw new Error('Meta WA adapter: mediaId is required')
    if (!account?.accessToken) {
      throw new Error('Meta WA adapter: account.accessToken is required')
    }
    const token = safeDecrypt(account.accessToken)
    const { graphVersion } = await getMetaConfig()

    const metaUrl = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(mediaId)}`
    const { data: meta } = await axios.get(metaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    })

    const downloadUrl = meta?.url
    if (!downloadUrl) throw new Error('Meta WA adapter: media id returned no url')

    const { data: bytes, headers } = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 60000,
    })

    return {
      buffer: Buffer.from(bytes),
      mimeType: meta.mime_type || headers?.['content-type'] || 'application/octet-stream',
      fileSize: Number(meta.file_size) || (bytes?.byteLength ?? 0),
      sha256: meta.sha256 || null,
    }
  },
}

// ─── helpers ────────────────────────────────────────────────────────────────

// Decrypt accessToken; if it isn't actually encrypted (e.g. test fixtures or
// a plain token passed in via env for a smoke test), pass through so the
// adapter degrades gracefully instead of throwing inside decrypt().
function safeDecrypt(token) {
  try {
    return decrypt(token)
  } catch {
    return token
  }
}

function extractMessageInfo(msg) {
  const type = String(msg.type || 'text').toLowerCase()

  if (type === 'text') {
    return {
      type: 'TEXT',
      body: msg.text?.body || null,
      mediaId: null,
      mimeType: null,
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }

  if (type === 'image') {
    return {
      type: 'IMAGE',
      body: msg.image?.caption || null,
      mediaId: msg.image?.id || null,
      mimeType: msg.image?.mime_type || 'image/jpeg',
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }

  if (type === 'audio' || type === 'voice') {
    return {
      type: 'AUDIO',
      body: null,
      mediaId: msg.audio?.id || msg.voice?.id || null,
      mimeType: msg.audio?.mime_type || msg.voice?.mime_type || 'audio/ogg',
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }

  if (type === 'video') {
    return {
      type: 'VIDEO',
      body: msg.video?.caption || null,
      mediaId: msg.video?.id || null,
      mimeType: msg.video?.mime_type || 'video/mp4',
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }

  if (type === 'document') {
    return {
      type: 'DOCUMENT',
      body: msg.document?.caption || null,
      mediaId: msg.document?.id || null,
      mimeType: msg.document?.mime_type || 'application/octet-stream',
      mediaFileName: msg.document?.filename || null,
      latitude: null,
      longitude: null,
    }
  }

  if (type === 'sticker') {
    return {
      type: 'STICKER',
      body: null,
      mediaId: msg.sticker?.id || null,
      mimeType: msg.sticker?.mime_type || 'image/webp',
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }

  if (type === 'location') {
    const loc = msg.location || {}
    const lat = loc.latitude != null ? Number(loc.latitude) : null
    const lng = loc.longitude != null ? Number(loc.longitude) : null
    const body = loc.name || loc.address || (lat != null && lng != null ? `${lat},${lng}` : null)
    return {
      type: 'LOCATION',
      body,
      mediaId: null,
      mimeType: null,
      mediaFileName: null,
      latitude: lat,
      longitude: lng,
    }
  }

  if (type === 'interactive') {
    const interactive = msg.interactive || {}
    const reply = interactive.button_reply || interactive.list_reply || null
    const body = interactive.body?.text || reply?.title || reply?.description || null
    return {
      type: 'TEXT',
      body,
      mediaId: null,
      mimeType: null,
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }

  if (type === 'button') {
    // Legacy template-button reply: { button: { payload, text } }
    return {
      type: 'TEXT',
      body: msg.button?.text || null,
      mediaId: null,
      mimeType: null,
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }

  // Fallback for unknown types — keep the message but mark it as TEXT with
  // no body. The raw payload is preserved on normalizedMessage.raw for
  // debugging.
  return {
    type: 'TEXT',
    body: null,
    mediaId: null,
    mimeType: null,
    mediaFileName: null,
    latitude: null,
    longitude: null,
  }
}

// Detects an inbound interactive-button reply whose id matches `reorder:<id>`.
// Mirrors whatsappEvolution.adapter.js#extractReorderButton.
function extractReorderButton(msg) {
  const interactive = msg?.interactive
  const button = msg?.button
  const candidateId =
    interactive?.button_reply?.id ||
    interactive?.list_reply?.id ||
    button?.payload ||
    null
  if (!candidateId) return null
  const id = String(candidateId)
  if (!id.startsWith('reorder:')) return null
  const orderId = id.slice('reorder:'.length).trim()
  if (!orderId) return null
  return { orderId }
}

function buildOutboundBody(to, content) {
  const recipient = String(to).replace(/\D/g, '')
  const type = String(content?.type || 'TEXT').toUpperCase()

  let body
  if (type === 'IMAGE' && content?.mediaUrl) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'image',
      image: { link: content.mediaUrl, caption: content.text || undefined },
    }
  } else if (type === 'VIDEO' && content?.mediaUrl) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'video',
      video: { link: content.mediaUrl, caption: content.text || undefined },
    }
  } else if (type === 'AUDIO' && content?.mediaUrl) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'audio',
      audio: { link: content.mediaUrl },
    }
  } else if (type === 'DOCUMENT' && content?.mediaUrl) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'document',
      document: {
        link: content.mediaUrl,
        caption: content.text || undefined,
        filename: content.mediaFileName || undefined,
      },
    }
  } else if (type === 'STICKER' && content?.mediaUrl) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'sticker',
      sticker: { link: content.mediaUrl },
    }
  } else if (type === 'LOCATION') {
    const lat = Number(content?.latitude)
    const lng = Number(content?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Meta WA adapter: latitude/longitude obrigatórios para LOCATION')
    }
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'location',
      location: {
        latitude: lat,
        longitude: lng,
        name: content?.name || undefined,
        address: content?.address || undefined,
      },
    }
  } else {
    // Default: TEXT
    const text = content?.text ?? content?.body ?? ''
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { body: text, preview_url: !!content?.preview_url },
    }
  }

  // Reply-to (quoted): Meta uses context.message_id pointing to the wamid
  // of the original inbound. The route resolves quotedMessageId → externalId
  // and passes it here as replyToExternalId.
  if (content?.replyToExternalId) {
    body.context = { message_id: String(content.replyToExternalId) }
  }
  return body
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
  // Preserve diagnostic context for upstream logging.
  const wrapped = new Error(errorObj?.message || err?.message || 'Meta WA send failed')
  wrapped.cause = err
  wrapped.metaCode = code || null
  wrapped.metaError = errorObj || null
  throw wrapped
}

export default adapter
