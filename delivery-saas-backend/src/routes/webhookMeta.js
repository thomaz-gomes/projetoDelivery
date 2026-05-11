// src/routes/webhookMeta.js
// Public webhook endpoint for Meta platforms (no JWT auth):
//   - WhatsApp Cloud API (object: 'whatsapp_business_account')
//   - Facebook Messenger    (object: 'page')
//   - Instagram Direct      (object: 'instagram')
//
// Task 17 of the Meta Messaging Integration plan. Responsibilities:
//   1. GET handshake — verify ?hub.verify_token against the global
//      Settings.META_WEBHOOK_VERIFY_TOKEN (Task 14) or against any
//      MetaMessagingAccount.webhookVerifyToken.
//   2. POST signature validation — Meta signs payloads with
//      X-Hub-Signature-256: sha256=<HMAC(rawBody, appSecret)>.
//      We compare in constant time and reject 403 on mismatch.
//   3. Dispatch — map payload.object → MessagingProvider, resolve the
//      MetaMessagingAccount row, then hand the entry off to routeInbound.
//      Per-entry failures are logged but never crash the response: Meta
//      retries indefinitely on non-200, which we explicitly avoid.
//
// IMPORTANT body-parser ordering: this router must be mounted BEFORE the
// global bodyParser.json() middleware in src/index.js so the POST handler
// can read the exact request bytes via express.raw(). The GET handler does
// not need raw bytes — Meta sends parameters on the query string.

import { Router } from 'express'
import express from 'express'
import crypto from 'node:crypto'
import { getMetaConfig } from '../services/metaConfig.js'
import { prisma } from '../prisma.js'
import { routeInbound } from '../messaging/index.js'
import { MetaNotConfiguredError } from '../messaging/adapters/base.adapter.js'

const router = Router()

// GET /webhook/meta — handshake. Meta sends:
//   ?hub.mode=subscribe&hub.verify_token=X&hub.challenge=Y
// We must respond 200 with Y as plain-text when X matches our token.
router.get('/webhook/meta', async (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode !== 'subscribe' || !token) return res.sendStatus(400)

  // 1) Match against the global SystemSetting verify token (Task 14).
  try {
    const cfg = await getMetaConfig()
    if (cfg.webhookVerifyToken && token === cfg.webhookVerifyToken) {
      return res.status(200).type('text/plain').send(String(challenge ?? ''))
    }
  } catch (err) {
    if (!(err instanceof MetaNotConfiguredError)) {
      console.error('[webhook/meta] getMetaConfig failed during handshake', err)
    }
    // Fall through: per-account token may still match.
  }

  // 2) Fallback: per-account verify token.
  try {
    const acc = await prisma.metaMessagingAccount.findUnique({
      where: { webhookVerifyToken: token },
      select: { id: true },
    })
    if (acc) return res.status(200).type('text/plain').send(String(challenge ?? ''))
  } catch (err) {
    console.error('[webhook/meta] account verify-token lookup failed', err)
  }

  return res.sendStatus(403)
})

// POST /webhook/meta — receive events. express.raw() is mounted here (and
// not globally) so we can compute HMAC over the exact bytes Meta signed.
router.post(
  '/webhook/meta',
  express.raw({ type: 'application/json', limit: '5mb' }),
  async (req, res) => {
    try {
      const sig = req.get('X-Hub-Signature-256') || ''
      let appSecret
      try {
        ({ appSecret } = await getMetaConfig())
      } catch (err) {
        if (err instanceof MetaNotConfiguredError) {
          console.warn('[webhook/meta] POST received but Meta not configured — rejecting')
          return res.sendStatus(403)
        }
        throw err
      }

      const rawBuf = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}))

      const expected = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(rawBuf)
        .digest('hex')

      const sigBuf = Buffer.from(sig)
      const expBuf = Buffer.from(expected)
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        console.warn('[webhook/meta] invalid X-Hub-Signature-256')
        return res.sendStatus(403)
      }

      let payload
      try {
        payload = JSON.parse(rawBuf.toString('utf8'))
      } catch (err) {
        console.error('[webhook/meta] invalid JSON after valid signature', err?.message || err)
        // Meta won't retry a 200 — and signature is valid so we own this
        // payload. Acknowledge and move on.
        return res.sendStatus(200)
      }

      // Always respond 200 to Meta, even if per-entry dispatch fails, so the
      // platform does not retry. Per-entry errors are logged inside dispatchMeta.
      await dispatchMeta(payload)
      return res.sendStatus(200)
    } catch (err) {
      console.error('[webhook/meta] unexpected error in POST handler', err)
      // Returning 500 lets Meta retry — which is fine for genuinely transient
      // server errors (DB down, etc.) but not for programmer bugs. Logging
      // above gives us the trail to fix bugs without losing events.
      return res.sendStatus(500)
    }
  },
)

// ---- internals ----------------------------------------------------------

function mapObjectToProvider(obj) {
  if (obj === 'whatsapp_business_account') return 'META_WA'
  if (obj === 'page') return 'META_FB'
  if (obj === 'instagram') return 'META_IG'
  return null
}

function extractExternalId(obj, entry) {
  if (obj === 'whatsapp_business_account') {
    // WA payloads carry the phone_number_id deep inside changes[].value.metadata.
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const ch of changes) {
      const id = ch?.value?.metadata?.phone_number_id
      if (id) return String(id)
    }
    return null
  }
  // FB Messenger and IG Direct put the page/IG-user id directly on entry.id.
  return entry?.id ? String(entry.id) : null
}

async function dispatchMeta(payload) {
  const obj = payload?.object
  const entries = Array.isArray(payload?.entry) ? payload.entry : []

  const provider = mapObjectToProvider(obj)
  if (!provider) {
    console.warn('[webhook/meta] unknown object — ignoring', { object: obj })
    return
  }

  for (const entry of entries) {
    const externalId = extractExternalId(obj, entry)
    if (!externalId) {
      console.warn('[webhook/meta] entry missing externalId — ignoring', { provider, entry })
      continue
    }

    let account
    try {
      account = await prisma.metaMessagingAccount.findFirst({
        where: { provider, externalId },
      })
    } catch (err) {
      console.error('[webhook/meta] account lookup failed', { provider, externalId, err: err?.message || err })
      continue
    }

    if (!account) {
      console.warn('[webhook/meta] account não reconhecida', { provider, externalId })
      continue
    }

    try {
      await routeInbound(provider, entry, account)
    } catch (err) {
      // Adapters for META_WA/FB/IG land in Tasks 18/21/22 — until then
      // routeInbound throws NO_ADAPTER. Swallow per-entry errors so a single
      // bad entry (or missing adapter) never causes us to return non-200 to
      // Meta, which would trigger indefinite retries.
      console.error('[webhook/meta] routeInbound failed', {
        provider,
        externalId,
        accountId: account.id,
        code: err?.code,
        message: err?.message || String(err),
      })
    }
  }
}

export default router
