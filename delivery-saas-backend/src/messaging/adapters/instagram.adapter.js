// src/messaging/adapters/instagram.adapter.js
// Instagram Direct adapter. Inherits sendMessage / sendMedia / downloadMedia /
// verifyWebhook from the Facebook Messenger adapter via spread — IG Messaging
// uses the same Graph API (`POST /me/messages?access_token=…`) and the same
// `entry[].messaging[]` inbound shape. We override `parseInbound` to handle
// IG-only message types (story replies, story mentions, shared posts) and
// `resolveAccount` to scope lookups to provider=META_IG.
//
// Notes on inheritance via spread:
//   The Facebook adapter's outbound methods reference the lexical `adapter`
//   constant (closure), not `this`. So when the spread copies them here,
//   they still call FB's `sendMessage` internally — that's fine because
//   the actual Graph endpoint, body shape, and error mapping are identical
//   between Messenger and Instagram Direct. The `provider`/`channel`
//   metadata on the adapter object is never read inside `sendMessage`, so
//   no behavioural divergence is possible.
//
// IG-specific inbound behaviours:
//   - sender.id is an Instagram-Scoped User ID (IGSID), opaque
//   - `message.reply_to.story` → prefix body with "[Story reply]"
//   - `attachments[0].type === 'story_mention'` → IMAGE, body "[Story mention]"
//   - `attachments[0].type === 'share'` → IMAGE, body "[Shared post]"
//   - no postbacks (Pages-only); postback-shaped events are skipped

import facebook from './facebook.adapter.js'
import { normalizedMessage } from './base.adapter.js'
import { prisma } from '../../prisma.js'

const PROVIDER = 'META_IG'
const CHANNEL = 'INSTAGRAM'

const adapter = {
  ...facebook,
  provider: PROVIDER,
  channel: CHANNEL,

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

      // IG Direct has no postbacks (Pages-only feature). Skip any
      // postback-shaped event defensively.
      if (ev.postback) continue

      const message = ev.message
      if (!message) continue
      if (message.is_echo) continue

      const externalId = message.mid || null
      if (externalId) {
        if (seen.has(externalId)) continue
        seen.add(externalId)
      }

      const tsMs = Number(ev.timestamp)
      const timestamp = Number.isFinite(tsMs) && tsMs > 0 ? new Date(tsMs) : new Date()

      let type = 'TEXT'
      let body = message.text || null
      let mediaUrl = null
      let mimeType = null

      const attachment = Array.isArray(message.attachments) ? message.attachments[0] : null
      if (attachment) {
        const t = String(attachment.type || '').toLowerCase()
        const url = attachment.payload?.url || null
        if (t === 'story_mention') {
          type = 'IMAGE'
          body = '[Story mention]'
          mediaUrl = url
          mimeType = 'image/jpeg'
        } else if (t === 'share') {
          type = 'IMAGE'
          body = body || '[Shared post]'
          mediaUrl = url
          mimeType = 'image/jpeg'
        } else {
          const info = mapAttachmentInfo(t, url)
          type = info.type
          mediaUrl = info.mediaUrl
          mimeType = info.mimeType
        }
      }

      // Story reply: prefix body once we know it isn't a story_mention /
      // share attachment (those overwrite body entirely).
      if (message.reply_to?.story && type === 'TEXT') {
        body = `[Story reply] ${body || ''}`.trim()
      }

      out.push(normalizedMessage({
        externalId,
        channel: CHANNEL,
        provider: PROVIDER,
        companyId,
        channelContactId: senderId,
        providerAccountId: accountId,
        type,
        body,
        mediaUrl,
        mimeType,
        timestamp,
        raw: ev,
      }))
    }

    return out
  },

  async resolveAccount(externalId) {
    if (!externalId) return null
    return prisma.metaMessagingAccount.findFirst({
      where: { provider: PROVIDER, externalId: String(externalId) },
    })
  },
}

function mapAttachmentInfo(t, url) {
  if (t === 'image') return { type: 'IMAGE', mediaUrl: url, mimeType: 'image/jpeg' }
  if (t === 'audio') return { type: 'AUDIO', mediaUrl: url, mimeType: 'audio/mpeg' }
  if (t === 'video') return { type: 'VIDEO', mediaUrl: url, mimeType: 'video/mp4' }
  if (t === 'file') return { type: 'DOCUMENT', mediaUrl: url, mimeType: 'application/octet-stream' }
  return { type: 'TEXT', mediaUrl: null, mimeType: null }
}

export default adapter
