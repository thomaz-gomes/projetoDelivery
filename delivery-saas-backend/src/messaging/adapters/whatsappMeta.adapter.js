// src/messaging/adapters/whatsappMeta.adapter.js
// WhatsApp Cloud API adapter (Meta-hosted, mod 65 in the messaging plan).
// Parses inbound `entry` payloads delivered by /webhook/meta and performs
// outbound sends via the Graph API. The webhook handler in
// routes/webhookMeta.js verifies X-Hub-Signature-256, maps `payload.object`
// to a MessagingProvider, resolves the MetaMessagingAccount row, and then
// hands ONE entry at a time to router.routeInbound → parseInbound.
//
// Media fetch: Meta only exposes media via short-lived URLs guarded by a
// Bearer token. parseInbound downloads inline (mirrors the Evolution adapter)
// and persists the bytes under /public/uploads/inbox/... so that the operator
// UI, audio transcription and other downstream consumers can read the file by
// URL without needing the Meta access token. downloadMedia() remains exported
// for callers that need a fresh fetch (e.g. retry after a failed save).

import axios from 'axios'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
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

        // Download media inline (audio/image/video/document/sticker). Meta
        // exposes media only via short-lived URLs guarded by Bearer token,
        // so we fetch + persist now and store the local public URL on the
        // message. Failures are logged but never block message persistence
        // — the message still arrives, just without playable media.
        let localMediaUrl = null
        if (info.mediaId && info.type !== 'TEXT' && info.type !== 'LOCATION') {
          try {
            localMediaUrl = await downloadAndSaveMetaMedia(info.mediaId, account, info.mimeType)
          } catch (err) {
            console.error('[whatsappMeta.adapter] media download failed:', err?.response?.data || err?.message || err)
          }
        }

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
          mediaUrl: localMediaUrl,
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

  // Extrai eventos de status (sent / delivered / read / failed) que vêm em
  // value.statuses[] dos webhooks Meta WA. Retorna [{ externalId, status,
  // failureReason, timestamp }, ...] já normalizado pro nosso enum
  // MessageStatus. Ignora linhas sem id (defensivo).
  parseStatuses(entry) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    const out = []
    for (const change of changes) {
      const value = change?.value
      if (!value || typeof value !== 'object') continue
      const statuses = Array.isArray(value.statuses) ? value.statuses : []
      if (!statuses.length) continue

      for (const st of statuses) {
        if (!st || typeof st !== 'object') continue
        const externalId = st.id ? String(st.id) : null
        if (!externalId) continue

        const raw = String(st.status || '').toLowerCase()
        let status = null
        if (raw === 'sent') status = 'SENT'
        else if (raw === 'delivered') status = 'DELIVERED'
        else if (raw === 'read') status = 'READ'
        else if (raw === 'failed') status = 'FAILED'
        if (!status) continue

        let failureReason = null
        if (status === 'FAILED') {
          // Meta cita os erros em st.errors[] (com code + title + message +
          // error_data.details). Pegamos a primeira pista útil.
          const first = Array.isArray(st.errors) ? st.errors[0] : null
          if (first) {
            const code = first.code != null ? `${first.code}` : null
            const title = first.title || ''
            const detail = first.error_data?.details || first.message || ''
            failureReason = [code, title, detail].filter(Boolean).join(' — ').slice(0, 500)
          } else {
            failureReason = 'Falha sem detalhe da Meta'
          }
        }

        const tsSeconds = Number(st.timestamp)
        const timestamp = Number.isFinite(tsSeconds) && tsSeconds > 0
          ? new Date(tsSeconds * 1000)
          : new Date()

        out.push({ externalId, status, failureReason, timestamp })
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

  // Envia uma mensagem via template aprovado pela Meta. Funciona fora da
  // janela de 24h. O caller passa o nome do template, código do idioma
  // (ex: 'pt_BR') e o array `components` no formato Graph API:
  //   [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }, ...] }]
  // Se o template não tem placeholders, `components` pode ser omitido.
  async sendTemplate(account, to, { name, languageCode, components = [] }) {
    if (!account?.externalId) {
      throw new Error('Meta WA adapter: account.externalId (phone_number_id) is required')
    }
    if (!account?.accessToken) {
      throw new Error('Meta WA adapter: account.accessToken is required')
    }
    if (!name) {
      throw new Error('Meta WA adapter: template name is required')
    }

    const token = safeDecrypt(account.accessToken)
    const { graphVersion } = await getMetaConfig()
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.externalId)}/messages`

    const body = {
      messaging_product: 'whatsapp',
      to: String(to).replace(/\D/g, ''),
      type: 'template',
      template: {
        name,
        language: { code: languageCode || 'pt_BR' },
        ...(Array.isArray(components) && components.length ? { components } : {}),
      },
    }

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

  // Lista templates de mensagem aprovados na WABA do account. Retorna o
  // array bruto da Graph API (sem paginação automática; chama 1 página
  // de até 100 templates). O caller é responsável por mapear/persistir.
  async listTemplates(account, { limit = 100 } = {}) {
    if (!account?.accessToken) {
      throw new Error('Meta WA adapter: account.accessToken is required')
    }
    if (!account?.wabaId) {
      throw new Error('Meta WA adapter: account.wabaId is required to list templates')
    }
    const token = safeDecrypt(account.accessToken)
    const { graphVersion } = await getMetaConfig()
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.wabaId)}/message_templates`
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: { limit, fields: 'id,name,language,category,status,components,quality_score' },
      timeout: 30000,
    })
    return Array.isArray(data?.data) ? data.data : []
  },

  // Submete um template para aprovação na Meta. Retorna { id, status } —
  // o id é o externalId do template no Meta, status inicial geralmente
  // PENDING (raramente APPROVED imediato para Authentication category).
  // Erros Graph API são propagados (caller deve mapear códigos como
  // 131008 = name already exists, 131009 = invalid components, etc).
  async createTemplate(account, { name, language, category, components }) {
    if (!account?.accessToken) {
      throw new Error('Meta WA adapter: account.accessToken is required')
    }
    if (!account?.wabaId) {
      throw new Error('Meta WA adapter: account.wabaId is required to create templates')
    }
    if (!name || !language || !category || !Array.isArray(components)) {
      throw new Error('Meta WA adapter: name, language, category, components are required')
    }
    const token = safeDecrypt(account.accessToken)
    const { graphVersion } = await getMetaConfig()
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.wabaId)}/message_templates`
    const { data } = await axios.post(
      url,
      { name, language, category, components },
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    )
    return {
      id: data?.id || null,
      status: data?.status || 'PENDING',
      category: data?.category || category,
    }
  },

  // Fetches a single template by its Meta id (useful for status polling
  // after submission). Returns the same shape as listTemplates entries.
  async getTemplate(account, templateId) {
    if (!account?.accessToken) throw new Error('Meta WA adapter: account.accessToken is required')
    if (!templateId) throw new Error('Meta WA adapter: templateId is required')
    const token = safeDecrypt(account.accessToken)
    const { graphVersion } = await getMetaConfig()
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(templateId)}`
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields: 'id,name,language,category,status,components,rejected_reason,quality_score' },
      timeout: 30000,
    })
    return data
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
  // Meta exige link HTTPS público — relativo (/public/...) cai em erro
  // genérico de download. Normaliza antes de montar o body.
  const mediaLink = content?.mediaUrl ? toAbsolutePublicUrl(content.mediaUrl) : null

  let body
  if (type === 'IMAGE' && mediaLink) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'image',
      image: { link: mediaLink, caption: content.text || undefined },
    }
  } else if (type === 'VIDEO' && mediaLink) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'video',
      video: { link: mediaLink, caption: content.text || undefined },
    }
  } else if (type === 'AUDIO' && mediaLink) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'audio',
      audio: { link: mediaLink },
    }
  } else if (type === 'DOCUMENT' && mediaLink) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'document',
      document: {
        link: mediaLink,
        caption: content.text || undefined,
        filename: content.mediaFileName || undefined,
      },
    }
  } else if (type === 'STICKER' && mediaLink) {
    body = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'sticker',
      sticker: { link: mediaLink },
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

// ─── Media storage helpers ─────────────────────────────────────────────────
// Mirror the Evolution adapter layout (public/uploads/inbox/<companyId>/<YYYY-MM>/)
// so downstream consumers (audio transcription, gallery, etc.) read media the
// same way regardless of origin.

function mimeToExtension(mime) {
  if (!mime) return 'bin'
  const m = String(mime).toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('mp4')) return 'mp4'
  if (m.includes('quicktime') || m.includes('mov')) return 'mov'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('mpeg') && m.startsWith('audio')) return 'mp3'
  if (m.includes('mp3')) return 'mp3'
  if (m.includes('wav')) return 'wav'
  if (m.includes('pdf')) return 'pdf'
  return 'bin'
}

function buildMediaTarget(companyId, mimeType) {
  const now = new Date()
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const ext = mimeToExtension(mimeType)
  const filename = `${crypto.randomUUID()}.${ext}`
  const relDir = `uploads/inbox/${companyId}/${yearMonth}`
  const absDir = path.join(process.cwd(), 'public', relDir)
  fs.mkdirSync(absDir, { recursive: true })
  return {
    filePath: path.join(absDir, filename),
    publicUrl: `/public/${relDir}/${filename}`,
  }
}

// Two-step Meta media fetch:
//   1) GET /<media_id>          → { url, mime_type, sha256, file_size, ... }
//   2) GET <url>                → bytes (Bearer auth required on BOTH calls)
// Returns the public URL of the saved file, or null on any failure.
async function downloadAndSaveMetaMedia(mediaId, account, fallbackMime) {
  if (!mediaId) return null
  if (!account?.accessToken) return null
  if (!account?.companyId) return null

  const token = safeDecrypt(account.accessToken)
  const { graphVersion } = await getMetaConfig()

  const metaUrl = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(mediaId)}`
  const { data: meta } = await axios.get(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  })

  const downloadUrl = meta?.url
  if (!downloadUrl) return null

  const { data: bytes } = await axios.get(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
    timeout: 60000,
  })

  const { filePath, publicUrl } = buildMediaTarget(account.companyId, meta?.mime_type || fallbackMime)
  fs.writeFileSync(filePath, Buffer.from(bytes))
  return publicUrl
}

// Meta Graph API exige link HTTPS público — não aceita path relativo
// (`/public/...`). QuickReplies/uploads salvam URL relativa no banco, então
// callers como automations.sendAutoReply caíam ao mandar greeting com mídia.
// Normaliza para absoluta usando BACKEND_URL; se já for absoluta, devolve
// como veio. Sem BACKEND_URL, loga aviso e devolve original.
function toAbsolutePublicUrl(maybeRelative) {
  if (!maybeRelative) return maybeRelative
  const value = String(maybeRelative)
  if (/^https?:\/\//i.test(value)) return value
  const base = process.env.BACKEND_URL
  if (!base) {
    console.warn('[whatsappMeta.adapter] BACKEND_URL não configurado — mídia com URL relativa pode ser rejeitada pelo Meta:', value)
    return value
  }
  const path = value.startsWith('/') ? value : `/${value}`
  return `${base.replace(/\/$/, '')}${path}`
}

export default adapter
