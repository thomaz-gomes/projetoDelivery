// src/messaging/adapters/whatsappEvolution.adapter.js
// Evolution API (Baileys-backed WhatsApp) adapter for the channel-agnostic
// messaging router. Parses inbound webhook payloads from Evolution v2 and
// performs outbound sends via the helpers in src/wa.js so we match the URL
// fan-out / header pattern the rest of the codebase already uses.
//
// Parser logic is ported from the legacy webhookEvolution.js#processSingleMessage
// and #extractMessageInfo — the webhook is now a thin handler that delegates
// to this adapter via router.routeInbound.

import axios from 'axios'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { normalizedMessage } from './base.adapter.js'
import { normalizePhone } from '../phoneVariants.js'
import { prisma } from '../../prisma.js'
import { evoSendText, evoSendMediaUrl, evoSendButtons } from '../../wa.js'

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
  // account: a WhatsAppInstance row (id, companyId, instanceName, ...) with
  // optional eager-loaded `menus`/`stores` arrays from the webhook handler so
  // we can attach menuId/storeId/instanceName to each normalized message.
  async parseInbound(payload, account) {
    const raw = payload?.data
    const events = Array.isArray(raw) ? raw : (raw ? [raw] : [])

    const accountId = account?.id || null
    const instanceName = account?.instanceName || payload?.instance || payload?.instanceName || null
    // Prefer a direct menu link on the instance. If only stores are linked,
    // fall back to the first active menu under the first store so the
    // conversation always carries a menuId — per-menu automations and
    // template placeholders depend on it.
    // 1:1 menu link as of schema migration; `account.menu` is at most one.
    const directMenuId = account?.menu?.id || null
    const directMenuStoreId = account?.menu?.storeId || null
    const firstStore = account?.stores?.[0] || null
    const storeFallbackMenuId = firstStore?.menus?.[0]?.id || null
    const menuId = directMenuId || storeFallbackMenuId
    const storeId = directMenuId ? directMenuStoreId : (firstStore?.id || null)

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

      // Skip OUTBOUND echoes — fromMe events are our own sends bouncing back
      // through the webhook; the pipeline only handles INBOUND.
      if (key.fromMe) continue

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

      // Detect an interactive-button reply (e.g. "Repetir pedido"). The
      // pipeline routes these through buttonReplies.js BEFORE running the
      // regular greeting/keyword automations.
      const reorderButton = extractReorderButton(messageContent)

      // Best-effort media decryption (Evolution-specific). The webhook used
      // to do this inline; centralising here keeps the pipeline channel-
      // agnostic. Failures are logged but never block message persistence —
      // the encrypted URL is preserved on the message as a fallback.
      let localMediaUrl = info.mediaUrl
      if (info.type !== 'TEXT' && info.type !== 'LOCATION' && account?.companyId) {
        try {
          const inlineBase64 = pickInlineBase64(messageContent, ev)
          if (inlineBase64) {
            localMediaUrl = await saveBase64Media(inlineBase64, account.companyId, info.mimeType)
          } else if (instanceName) {
            localMediaUrl = await downloadMediaViaEvolution(instanceName, ev, account.companyId, info.mimeType)
          }
        } catch (err) {
          console.error('[whatsappEvolution.adapter] media download failed:', err?.response?.data || err?.message || err)
        }
      }

      out.push(normalizedMessage({
        externalId,
        channel: CHANNEL,
        provider: PROVIDER,
        companyId: account?.companyId || null,
        channelContactId: phone,
        providerAccountId: accountId,
        instanceName,
        menuId,
        storeId,
        contactName: ev.pushName || null,
        type: info.type,
        body: info.body,
        mediaUrl: localMediaUrl,
        mimeType: info.mimeType,
        mediaFileName: info.mediaFileName,
        latitude: info.latitude,
        longitude: info.longitude,
        reorderButton,
        timestamp,
        raw: ev,
      }))
    }
    return out
  },

  // Operator-initiated send. Dispatches by content.type to text vs media
  // vs interactive-buttons. Returns { externalId, status } so the router
  // can persist the outbound Message with provider linkage.
  async sendMessage(account, to, content) {
    const instanceName = account?.instanceName
    if (!instanceName) throw new Error('Evolution adapter: account.instanceName is required')

    const type = String(content?.type || 'TEXT').toUpperCase()

    if (type === 'BUTTONS') {
      const description = content?.text ?? content?.body ?? ''
      const buttons = content?.buttons || []
      const data = await evoSendButtons({ instanceName, to, description, buttons })
      return { externalId: data?.key?.id || null, status: 'SENT' }
    }

    if (content?.mediaUrl) {
      const mimeType = content.mimeType || inferMimeTypeForKind(type)
      const caption = content?.text ?? content?.body ?? ''
      const data = await evoSendMediaUrl({
        instanceName,
        to,
        mediaUrl: toAbsolutePublicUrl(content.mediaUrl),
        filename: content.mediaFileName || 'arquivo',
        mimeType,
        caption,
      })
      return { externalId: data?.key?.id || null, status: 'SENT' }
    }

    const text = content?.text ?? content?.body ?? ''
    const data = await evoSendText({ instanceName, to, text })
    return { externalId: data?.key?.id || null, status: 'SENT' }
  },

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
      mediaUrl: toAbsolutePublicUrl(mediaUrl),
      mimeType,
      caption: caption || '',
    })
    return { externalId: data?.key?.id || null, status: 'SENT' }
  },

  async resolveAccount(externalId /* instance name */) {
    if (!externalId) return null
    return prisma.whatsAppInstance.findFirst({
      where: { instanceName: externalId },
      include: {
        // 1:1 link as of schema migration; was menus[take:1].
        menu: { select: { id: true, storeId: true } },
        // Eager-load the first active menu of the first store so parseInbound
        // can fall back to menu-via-store when no direct menu link exists.
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
  },

  async downloadMedia() {
    // Media is fetched inline during parseInbound (via the Evolution
    // decryption endpoint); nothing extra to do here.
    return null
  },
}

// ─── helpers (ported from webhookEvolution.js#extractMessageInfo) ───────────

// Exported so evolutionOutboundEcho.js can extract type/body/mediaUrl/mimeType
// from fromMe echoes without re-implementing every WhatsApp message shape.
export function extractMessageInfo(messageContent) {
  if (messageContent.imageMessage) {
    const im = messageContent.imageMessage
    return {
      type: 'IMAGE',
      body: im.caption || null,
      mediaUrl: im.url || null,
      mimeType: im.mimetype || 'image/jpeg',
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }
  if (messageContent.audioMessage) {
    const am = messageContent.audioMessage
    return {
      type: 'AUDIO',
      body: null,
      mediaUrl: am.url || null,
      mimeType: am.mimetype || 'audio/ogg',
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }
  if (messageContent.videoMessage) {
    const vm = messageContent.videoMessage
    return {
      type: 'VIDEO',
      body: vm.caption || null,
      mediaUrl: vm.url || null,
      mimeType: vm.mimetype || 'video/mp4',
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }
  if (messageContent.documentWithCaptionMessage) {
    const docMsg = messageContent.documentWithCaptionMessage.message?.documentMessage || {}
    return {
      type: 'DOCUMENT',
      body: docMsg.caption || null,
      mediaUrl: docMsg.url || null,
      mimeType: docMsg.mimetype || 'application/octet-stream',
      mediaFileName: docMsg.fileName || null,
      latitude: null,
      longitude: null,
    }
  }
  if (messageContent.documentMessage) {
    const dm = messageContent.documentMessage
    return {
      type: 'DOCUMENT',
      body: dm.caption || null,
      mediaUrl: dm.url || null,
      mimeType: dm.mimetype || 'application/octet-stream',
      mediaFileName: dm.fileName || null,
      latitude: null,
      longitude: null,
    }
  }
  if (messageContent.locationMessage) {
    const loc = messageContent.locationMessage
    return {
      type: 'LOCATION',
      body: loc.name || loc.address || `${loc.degreesLatitude},${loc.degreesLongitude}`,
      mediaUrl: null,
      mimeType: null,
      mediaFileName: null,
      latitude: loc.degreesLatitude != null ? Number(loc.degreesLatitude) : null,
      longitude: loc.degreesLongitude != null ? Number(loc.degreesLongitude) : null,
    }
  }
  if (messageContent.stickerMessage) {
    const sm = messageContent.stickerMessage
    return {
      type: 'STICKER',
      body: null,
      mediaUrl: sm.url || null,
      mimeType: sm.mimetype || 'image/webp',
      mediaFileName: null,
      latitude: null,
      longitude: null,
    }
  }
  // Default: text
  const body =
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    null
  return {
    type: 'TEXT', body, mediaUrl: null, mimeType: null,
    mediaFileName: null, latitude: null, longitude: null,
  }
}

// Detects an inbound interactive-button reply across the Evolution payload
// shapes seen in the wild and returns { orderId } when it's a recognised
// "Repetir pedido" tap, else null. The button id format `reorder:<orderId>`
// is set when sending the button in automations.js#maybeSendRegisteredGreeting.
function extractReorderButton(messageContent) {
  if (!messageContent || typeof messageContent !== 'object') return null
  const br = messageContent.buttonsResponseMessage
    || messageContent.templateButtonReplyMessage
    || messageContent.interactiveResponseMessage
    || null
  if (!br) return null
  const buttonId =
    br.selectedButtonId ||
    br.selectedId ||
    br.body?.text ||
    br.nativeFlowResponseMessage?.paramsJson ||
    null
  if (!buttonId) return null
  const id = String(buttonId)
  if (!id.startsWith('reorder:')) return null
  const orderId = id.slice('reorder:'.length).trim()
  if (!orderId) return null
  return { orderId }
}

function inferMimeTypeForKind(kind) {
  const k = String(kind || '').toUpperCase()
  if (k === 'IMAGE') return 'image/jpeg'
  if (k === 'VIDEO') return 'video/mp4'
  if (k === 'AUDIO') return 'audio/ogg'
  if (k === 'STICKER') return 'image/webp'
  return 'application/octet-stream'
}

// ─── media helpers (Evolution-specific decryption) ──────────────────────────

function pickInlineBase64(messageContent, ev) {
  return (
    messageContent.base64 ||
    messageContent.imageMessage?.base64 ||
    messageContent.audioMessage?.base64 ||
    messageContent.videoMessage?.base64 ||
    messageContent.documentMessage?.base64 ||
    messageContent.documentWithCaptionMessage?.message?.documentMessage?.base64 ||
    messageContent.stickerMessage?.base64 ||
    ev?.base64 ||
    null
  )
}

function mimeToExtension(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/mpeg': 'mp3',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  }
  return map[mime] || mime?.split('/')?.[1] || 'bin'
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

async function saveBase64Media(base64, companyId, mimeType) {
  const { filePath, publicUrl } = buildMediaTarget(companyId, mimeType)
  const buffer = Buffer.from(base64, 'base64')
  fs.writeFileSync(filePath, buffer)
  return publicUrl
}

async function downloadMediaViaEvolution(instanceName, msg, companyId, mimeType) {
  const baseURL = process.env.EVOLUTION_API_BASE_URL
  const apiKey = process.env.EVOLUTION_API_API_KEY
  if (!baseURL || !apiKey) throw new Error('Evolution API not configured')

  const url = `${baseURL.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`
  const { data } = await axios.post(
    url,
    { message: { key: msg.key }, convertToMp4: false },
    { headers: { apikey: apiKey, 'Content-Type': 'application/json' }, timeout: 30000 }
  )

  const base64 = data?.base64 || data?.media || data?.mediaBase64 || null
  if (!base64) throw new Error('No base64 returned from Evolution API')

  return saveBase64Media(base64, companyId, data?.mimetype || mimeType)
}

// Evolution exige URL absoluta (http/https) ou base64 — não aceita path
// relativo. QuickReplies e uploads do inbox são salvos com `/public/...`
// no banco, então qualquer caller que use sendMessage com mediaUrl relativo
// (automations.sendAutoReply, /transactions/:id/pay com mídia, etc.) caía
// num 400 "Owned media must be a url or base64". Esta função detecta URL
// já absoluta e devolve sem mudar; URL relativa recebe o prefixo
// BACKEND_URL do ambiente. Se BACKEND_URL não estiver setado, loga aviso e
// devolve a URL como veio (deixa Evolution rejeitar com mensagem clara).
function toAbsolutePublicUrl(maybeRelative) {
  if (!maybeRelative) return maybeRelative
  const value = String(maybeRelative)
  if (/^https?:\/\//i.test(value)) return value
  const base = process.env.BACKEND_URL
  if (!base) {
    console.warn('[whatsappEvolution.adapter] BACKEND_URL não configurado — mídia com URL relativa será rejeitada pelo Evolution:', value)
    return value
  }
  const path = value.startsWith('/') ? value : `/${value}`
  return `${base.replace(/\/$/, '')}${path}`
}

export default adapter
