// src/routes/metaOauth.js
// OAuth flow for connecting tenant Meta accounts (Facebook Pages, Instagram
// Business, WhatsApp WABA phone numbers). Task 19 of the Meta Messaging
// Integration plan.
//
// Routes:
//   GET  /auth/meta/start      → returns Facebook OAuth URL (CSRF state cached)
//   GET  /auth/meta/callback   → handles Meta redirect, exchanges code for
//                                long-lived token, lists available accounts,
//                                caches result and redirects to frontend.
//   GET  /auth/meta/accounts   → frontend reads the cached account list.
//   POST /auth/meta/connect    → upserts MetaMessagingAccount per selection,
//                                links Menu, subscribes webhook with Meta.
//
// Notes / known limitations:
//   * State cache is in-memory (single instance only). For multi-instance
//     production deployments this should move to Redis. TTL is 10 min and
//     entries are GC'd by a periodic sweeper.
//   * WABA registration sends pin '000000' (the 2FA pin used when the
//     business owner enabled 2FA on the WhatsApp number). The user-facing UI
//     should prompt for this pin in a future iteration; v1 documents this
//     limitation.

import { Router } from 'express'
import axios from 'axios'
import crypto from 'node:crypto'
import { authMiddleware } from '../auth.js'
import { getMetaConfig } from '../services/metaConfig.js'
import { encrypt } from '../messaging/crypto.js'
import { prisma } from '../prisma.js'

const router = Router()

// In-memory CSRF + temp-token cache. Each entry expires after STATE_TTL_MS.
const STATE_TTL_MS = 10 * 60 * 1000
const stateCache = new Map()

// Periodic GC of expired state entries. Single instance only — for multi-
// instance prod we'd move to Redis with a native TTL.
const _gcTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, val] of stateCache.entries()) {
    if (!val || (now - (val.ts || 0)) > STATE_TTL_MS) {
      stateCache.delete(key)
    }
  }
}, 60 * 1000)
// Don't keep the event loop alive solely for this timer (tests, graceful shutdown).
if (typeof _gcTimer.unref === 'function') _gcTimer.unref()

// Map MessagingProvider → Menu FK column.
const MENU_FK_BY_PROVIDER = {
  META_WA: 'metaWaAccountId',
  META_FB: 'facebookAccountId',
  META_IG: 'instagramAccountId',
}

function frontendBaseUrl() {
  return (process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
}

function callbackUrl(webhookBaseUrl) {
  // webhookBaseUrl in Meta config is typically `<api>/webhook/meta`; strip
  // the suffix to derive the API base, then append our callback path.
  const base = String(webhookBaseUrl || '').replace(/\/webhook\/meta\/?$/, '').replace(/\/$/, '')
  return `${base}/auth/meta/callback`
}

// ---------------------------------------------------------------------------
// GET /auth/meta/start
// ---------------------------------------------------------------------------
router.get('/auth/meta/start', authMiddleware, async (req, res) => {
  try {
    const { appId, webhookBaseUrl } = await getMetaConfig()
    if (!webhookBaseUrl) {
      return res.status(400).json({ message: 'META_WEBHOOK_BASE_URL não configurado em /admin/meta-config' })
    }

    const state = crypto.randomBytes(16).toString('hex')
    stateCache.set(state, {
      kind: 'csrf',
      userId: req.user?.id || req.user?.userId || null,
      companyId: req.user?.companyId || null,
      ts: Date.now(),
    })

    const scopes = [
      'pages_messaging',
      'pages_show_list',
      'pages_manage_metadata',
      'instagram_basic',
      'instagram_manage_messages',
      'whatsapp_business_messaging',
      'whatsapp_business_management',
      'business_management',
    ].join(',')

    const redirectUri = callbackUrl(webhookBaseUrl)
    const url = `https://www.facebook.com/v21.0/dialog/oauth?` + new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      response_type: 'code',
    }).toString()

    return res.json({ url })
  } catch (e) {
    console.error('[auth/meta/start] failed', e?.message)
    return res.status(500).json({ message: 'Erro ao iniciar OAuth Meta', error: e?.message })
  }
})

// ---------------------------------------------------------------------------
// GET /auth/meta/callback
// Public: Meta redirects the user's browser here after consent. We validate
// the state CSRF token (which carries the originating companyId/userId) and
// then trade the code for a long-lived token. No authMiddleware — the user
// arrives via an external redirect, not from our SPA.
// ---------------------------------------------------------------------------
router.get('/auth/meta/callback', async (req, res) => {
  const { code, state } = req.query
  const frontend = frontendBaseUrl()

  if (!code || !state) {
    return res.redirect(`${frontend}/settings/meta-integrations?error=missing_code_or_state`)
  }

  const cached = stateCache.get(state)
  if (!cached || cached.kind !== 'csrf' || (Date.now() - cached.ts) > STATE_TTL_MS) {
    return res.redirect(`${frontend}/settings/meta-integrations?error=invalid_state`)
  }
  stateCache.delete(state)

  try {
    const { appId, appSecret, graphVersion, webhookBaseUrl } = await getMetaConfig()
    const redirectUri = callbackUrl(webhookBaseUrl)

    // 1. Exchange code → short-lived token.
    const shortRes = await axios.get(`https://graph.facebook.com/${graphVersion}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
      timeout: 15000,
    })
    const shortToken = shortRes.data.access_token

    // 2. Short → long-lived (~60 days).
    const longRes = await axios.get(`https://graph.facebook.com/${graphVersion}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      },
      timeout: 15000,
    })
    const longToken = longRes.data.access_token
    const expiresIn = longRes.data.expires_in || 60 * 24 * 60 * 60 // fallback 60d

    // 3. List available Pages, IG accounts and WhatsApp phone numbers.
    const accounts = await listAvailableAccounts(longToken, graphVersion)

    // Stash result against a fresh temp key tied to the same tenant.
    const tempKey = crypto.randomBytes(16).toString('hex')
    stateCache.set(tempKey, {
      kind: 'temp',
      userId: cached.userId,
      companyId: cached.companyId,
      longToken,
      expiresIn,
      accounts,
      ts: Date.now(),
    })

    return res.redirect(`${frontend}/settings/meta-integrations?temp=${tempKey}`)
  } catch (e) {
    console.error('[auth/meta/callback] failed', e?.response?.data || e?.message)
    const msg = encodeURIComponent(e?.response?.data?.error?.message || e?.message || 'oauth_failed')
    return res.redirect(`${frontend}/settings/meta-integrations?error=${msg}`)
  }
})

// ---------------------------------------------------------------------------
// GET /auth/meta/accounts?temp=<key>
// Reads the cached account list so the SPA can render the selection UI.
// Enforces tenant isolation: the cached entry must belong to req.user.companyId.
// ---------------------------------------------------------------------------
router.get('/auth/meta/accounts', authMiddleware, async (req, res) => {
  const temp = req.query.temp
  if (!temp) return res.status(400).json({ message: 'temp é obrigatório' })
  const data = stateCache.get(temp)
  if (!data || data.kind !== 'temp' || (Date.now() - data.ts) > STATE_TTL_MS) {
    return res.status(404).json({ error: 'expired' })
  }
  if (data.companyId !== req.user.companyId) {
    return res.status(403).json({ error: 'forbidden' })
  }
  return res.json({ accounts: data.accounts, expiresIn: data.expiresIn })
})

// ---------------------------------------------------------------------------
// POST /auth/meta/connect
// body: { temp, selections: [{ provider, externalId, displayName?, wabaId?, fbPageId?, menuId? }] }
// Upserts MetaMessagingAccount per selection, links Menu via the right FK
// column, and subscribes the webhook with Meta.
// ---------------------------------------------------------------------------
router.post('/auth/meta/connect', authMiddleware, async (req, res) => {
  const { temp, selections } = req.body || {}
  if (!temp || !Array.isArray(selections) || !selections.length) {
    return res.status(400).json({ message: 'temp e selections são obrigatórios' })
  }

  const data = stateCache.get(temp)
  if (!data || data.kind !== 'temp' || (Date.now() - data.ts) > STATE_TTL_MS) {
    return res.status(400).json({ error: 'expired' })
  }
  if (data.companyId !== req.user.companyId) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const created = []
  const errors = []

  for (const sel of selections) {
    try {
      const provider = sel.provider
      if (!provider || !MENU_FK_BY_PROVIDER[provider]) {
        errors.push({ selection: sel, error: 'invalid_provider' })
        continue
      }
      if (!sel.externalId) {
        errors.push({ selection: sel, error: 'missing_externalId' })
        continue
      }

      const verifyToken = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + data.expiresIn * 1000)

      // Pick the right access token per provider:
      // - META_FB: the Page's own access_token (required for /subscribed_apps and Messenger sends)
      // - META_IG: the linked FB Page's access_token (IG events go through the Page)
      // - META_WA: the user's long-lived token (Cloud API accepts it for /messages and /register)
      let tokenForAccount = data.longToken
      if (provider === 'META_FB') {
        const page = data.accounts?.pages?.find(p => p.id === sel.externalId)
        if (page?.access_token) tokenForAccount = page.access_token
      } else if (provider === 'META_IG') {
        const linkedPageId = sel.fbPageId
        const page = linkedPageId ? data.accounts?.pages?.find(p => p.id === linkedPageId) : null
        if (page?.access_token) tokenForAccount = page.access_token
      }
      const encToken = encrypt(tokenForAccount)

      const acc = await prisma.metaMessagingAccount.upsert({
        where: {
          companyId_provider_externalId: {
            companyId: req.user.companyId,
            provider,
            externalId: sel.externalId,
          },
        },
        create: {
          companyId: req.user.companyId,
          provider,
          externalId: sel.externalId,
          displayName: sel.displayName || null,
          accessToken: encToken,
          tokenExpiresAt: expiresAt,
          wabaId: sel.wabaId || null,
          fbPageId: sel.fbPageId || null,
          webhookVerifyToken: verifyToken,
          status: 'ACTIVE',
        },
        update: {
          displayName: sel.displayName || undefined,
          accessToken: encToken,
          tokenExpiresAt: expiresAt,
          wabaId: sel.wabaId || undefined,
          fbPageId: sel.fbPageId || undefined,
          status: 'ACTIVE',
          lastError: null,
        },
      })

      if (sel.menuId) {
        // Verify the menu belongs to the same tenant before linking.
        // Menu has no direct companyId column; tenant is enforced via Menu.store.companyId.
        const menu = await prisma.menu.findFirst({
          where: { id: sel.menuId, store: { companyId: req.user.companyId } },
          select: { id: true },
        })
        if (menu) {
          const field = MENU_FK_BY_PROVIDER[provider]
          await prisma.menu.update({ where: { id: menu.id }, data: { [field]: acc.id } })
        }
      }

      try {
        // FB/IG: use the page-specific token; WA: user long-lived token.
        await subscribeWebhook(acc, tokenForAccount)
      } catch (subErr) {
        console.error('[auth/meta/connect] subscribe failed', {
          provider,
          externalId: sel.externalId,
          fbPageId: sel.fbPageId,
          status: subErr?.response?.status,
          metaError: subErr?.response?.data?.error,
          message: subErr?.message,
        })
        // Webhook subscription failed but the account row is saved: surface
        // the error via lastError so the SPA can show a retry prompt.
        const metaErr = subErr?.response?.data?.error
        const lastError = metaErr?.message
          ? `${metaErr.message}${metaErr.code ? ` (code=${metaErr.code})` : ''}`
          : subErr?.message || 'subscribe_failed'
        await prisma.metaMessagingAccount.update({
          where: { id: acc.id },
          data: { lastError },
        })
        errors.push({ selection: sel, error: 'subscribe_failed', detail: lastError })
      }

      created.push(acc.id)
    } catch (e) {
      console.error('[auth/meta/connect] selection failed', sel, e?.response?.data || e?.message)
      errors.push({ selection: sel, error: e?.message || 'unknown' })
    }
  }

  stateCache.delete(temp)
  return res.json({ created, errors })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listAvailableAccounts(token, version) {
  const out = { pages: [], igAccounts: [], waNumbers: [] }

  // Pages the user administers.
  try {
    const pagesRes = await axios.get(`https://graph.facebook.com/${version}/me/accounts`, {
      params: { access_token: token, fields: 'id,name,access_token' },
      timeout: 15000,
    })
    out.pages = (pagesRes.data?.data || []).map((p) => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
    }))
  } catch (e) {
    console.warn('[listAvailableAccounts] /me/accounts failed', e?.response?.data || e?.message)
  }

  // Instagram Business accounts linked to each Page.
  for (const p of out.pages) {
    try {
      const ig = await axios.get(`https://graph.facebook.com/${version}/${p.id}`, {
        params: { access_token: p.access_token, fields: 'instagram_business_account{id,username}' },
        timeout: 15000,
      })
      const linked = ig.data?.instagram_business_account
      if (linked) out.igAccounts.push({ ...linked, fbPageId: p.id })
    } catch (_) {
      // No IG linked or no permission — skip.
    }
  }

  // WABAs and phone numbers accessible via the user's businesses.
  try {
    const biz = await axios.get(`https://graph.facebook.com/${version}/me/businesses`, {
      params: { access_token: token },
      timeout: 15000,
    })
    for (const b of biz.data?.data || []) {
      try {
        const wabas = await axios.get(`https://graph.facebook.com/${version}/${b.id}/owned_whatsapp_business_accounts`, {
          params: { access_token: token },
          timeout: 15000,
        })
        for (const w of wabas.data?.data || []) {
          try {
            const numbers = await axios.get(`https://graph.facebook.com/${version}/${w.id}/phone_numbers`, {
              params: { access_token: token },
              timeout: 15000,
            })
            for (const n of numbers.data?.data || []) {
              out.waNumbers.push({
                phoneNumberId: n.id,
                displayPhoneNumber: n.display_phone_number,
                wabaId: w.id,
              })
            }
          } catch (_) { /* skip */ }
        }
      } catch (_) { /* skip */ }
    }
  } catch (_) {
    // No business_management permission — skip silently.
  }

  return out
}

async function subscribeWebhook(account, token) {
  const { graphVersion } = await getMetaConfig()

  if (account.provider === 'META_FB' || account.provider === 'META_IG') {
    // Subscribe the Page to our app. FB/IG both go through the Page id; IG
    // events are delivered when the Page has a linked IG business account.
    const pageId = account.provider === 'META_FB' ? account.externalId : account.fbPageId
    if (!pageId) throw new Error('missing_pageId_for_subscription')
    await axios.post(`https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`, null, {
      params: {
        access_token: token,
        subscribed_fields: account.provider === 'META_FB' ? 'messages,messaging_postbacks' : 'messages',
      },
      timeout: 15000,
    })
    return
  }

  if (account.provider === 'META_WA') {
    // Register the phone number with the Cloud API. The pin is the 2FA pin
    // configured for the phone number; v1 hardcodes '000000' (known
    // limitation — user prompt to be added in a follow-up).
    await axios.post(
      `https://graph.facebook.com/${graphVersion}/${account.externalId}/register`,
      { messaging_product: 'whatsapp', pin: '000000' },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
    )
    return
  }
}

export default router
