// src/messaging/automations.js
//
// Channel-agnostic automation pipeline. Receives a Conversation, the just-
// persisted inbound Message, the resolved Customer, and the original
// NormalizedMessage from the inbound adapter, and runs the same automation
// rules that webhookEvolution.js used to run inline:
//
//   1. Greeting on first contact / after 6h inactivity
//   2. Registered-customer greeting (when the customer has ≥1 order)
//   3. "Remind last order" follow-up (WhatsApp-only — interactive button)
//   4. Out-of-hours auto-reply when the menu is closed
//   5. Keyword → tag matching on the inbound body
//
// The logic is ported verbatim from webhookEvolution.js (~Feb 2026) with one
// structural change: all outbound sends go through the local sendOutbound()
// helper, which is a stub for Task 8 and will be wired up to the messaging
// router in Task 12. Until then automations log what they would send but do
// not actually emit anything to the channel.
//
// The "remind last order" rule is the only channel-specific automation —
// the rest run for any Conversation regardless of channel/provider.

import { prisma } from '../prisma.js'
import { renderQuickReplyVariables } from '../utils/quickReplyVars.js'
import { renderRemindLastOrderTemplate } from '../services/reorderHelpers.js'

// ---------------------------------------------------------------------------
// Outbound dispatch (wired in Task 12)
// ---------------------------------------------------------------------------
// Routes automation-generated messages through the messaging router so the
// correct adapter (Evolution / Meta) is selected based on
// conversation.provider. We use a dynamic import to side-step the
// router ↔ inboundPipeline ↔ automations import cycle — at call time the
// router module is fully initialised so binding resolution is safe.
//
// The router's sendOutbound persists its own OUTBOUND Message and emits the
// inbox:new-message socket event, so callers must NOT also persist the
// message themselves (the previous stub used to log + the caller persisted).
async function sendOutbound({ conversation, content }) {
  // content shape from automation callers:
  //   { type, body?, mediaUrl?, mediaMimeType?, mediaFileName?, buttons? }
  // Router/adapter expect: { type, text, mediaUrl, mimeType, ... }
  try {
    const { sendOutbound: routerSendOutbound } = await import('./router.js')
    await routerSendOutbound({
      conversationId: conversation.id,
      content: {
        type: content.type || 'TEXT',
        text: content.body || null,
        mediaUrl: content.mediaUrl || null,
        mimeType: content.mediaMimeType || null,
        mediaFileName: content.mediaFileName || null,
        buttons: content.buttons || null,
      },
    })
  } catch (err) {
    console.warn('[automations] outbound dispatch failed:', err?.message || err)
  }
}

// ---------------------------------------------------------------------------
// Helpers ported from webhookEvolution.js
// ---------------------------------------------------------------------------

function isMenuOpen(menu) {
  if (!menu) return true
  if (menu.open24Hours) return true
  const schedule = menu.weeklySchedule
  if (!schedule || !Array.isArray(schedule)) return true

  const tz = menu.timezone || 'America/Sao_Paulo'
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
  const dayOfWeek = now.getDay()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const hhmm = `${hh}:${mm}`

  const today = schedule.find(s => Number(s.day) === dayOfWeek)
  if (!today || !today.enabled) return false
  if (!today.from || !today.to) return true
  return hhmm >= today.from && hhmm <= today.to
}

function detectMessageTypeFromMime(mime) {
  if (!mime) return 'DOCUMENT'
  if (mime.startsWith('image/')) return 'IMAGE'
  if (mime.startsWith('video/')) return 'VIDEO'
  if (mime.startsWith('audio/')) return 'AUDIO'
  return 'DOCUMENT'
}

function timeInRange(current, start, end) {
  // current, start, end are "HH:MM" strings
  if (start <= end) {
    return current >= start && current < end
  }
  // overnight: e.g. 22:00–06:00
  return current >= start || current < end
}

function pickGreetingByTime(rules, timezone) {
  if (!rules || !rules.length) return null
  const tz = timezone || 'America/Sao_Paulo'
  const currentTime = new Date()
    .toLocaleTimeString('pt-BR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .substring(0, 5) // "HH:MM"

  const sorted = [...rules].sort((a, b) => a.sortOrder - b.sortOrder)
  for (const rule of sorted) {
    if (timeInRange(currentTime, rule.startTime, rule.endTime)) {
      const qr = rule.quickReply
      if ((qr?.body && qr.body.trim()) || qr?.mediaUrl) {
        return qr
      }
    }
  }
  return null
}

// Sends a QuickReply-like object via the outbound stub and persists the
// corresponding outbound Message. Resolves {{nome}}/{{cashback}}/{{endereco}}
// placeholders against the conversation's customer first.
async function sendAutoReply(conversation, quickReply) {
  if (!quickReply) return
  const hasBody = quickReply.body && quickReply.body.trim()
  const hasMedia = !!quickReply.mediaUrl
  if (!hasBody && !hasMedia) return

  const resolvedBody = hasBody
    ? await renderQuickReplyVariables(quickReply.body.trim(), {
        conversation,
        companyId: conversation.companyId,
      })
    : ''

  // The router's sendOutbound persists the OUTBOUND Message and emits the
  // inbox:new-message socket event, so we don't duplicate persistence here.
  try {
    await sendOutbound({
      conversation,
      content: {
        type: hasMedia ? detectMessageTypeFromMime(quickReply.mediaMimeType) : 'TEXT',
        body: resolvedBody || null,
        mediaUrl: quickReply.mediaUrl || null,
        mediaMimeType: quickReply.mediaMimeType || null,
        mediaFileName: quickReply.mediaFileName || null,
      },
    })
  } catch (e) {
    console.warn('[automations] auto-reply send failed:', e.message)
  }
}

// ---------------------------------------------------------------------------
// Registered-customer greeting + remind-last-order
// ---------------------------------------------------------------------------
// Returns true when a registered-customer greeting + (optionally) the
// remind-last-order follow-up were sent. Returns false when the conversation
// is not associated with a registered customer or the menu has no registered
// greeting configured — caller falls back to the regular greeting.
async function maybeSendRegisteredGreeting({ conversation, menu }) {
  if (!menu?.registeredGreetingReply) return false
  if (!conversation?.customerId) return false
  const customer = await prisma.customer.findUnique({
    where: { id: conversation.customerId },
    select: { id: true, fullName: true },
  })
  if (!customer) return false

  // Trigger: customer has at least ONE order in the base, regardless of
  // status. The customer record alone is not enough — a customer auto-
  // created on the first inbound message would otherwise also receive the
  // registered greeting.
  const orderCount = await prisma.order.count({
    where: { customerId: customer.id, companyId: conversation.companyId },
  })
  if (orderCount === 0) return false

  // 1. Send the registered greeting.
  await sendAutoReply(conversation, menu.registeredGreetingReply)

  // 2. If remind-last-order is enabled AND this is WhatsApp, follow with the
  // interactive button pointing at the magic-link reorder flow. Other
  // channels (Meta WA, FB, IG) skip this — the button payload is a WA-only
  // construct in the current adapters.
  if (menu.remindLastOrderEnabled && conversation.channel === 'WHATSAPP') {
    const lastOrder = await prisma.order.findFirst({
      where: {
        customerId: customer.id,
        companyId: conversation.companyId,
        status: 'CONCLUIDO',
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    })
    if (!lastOrder) return true // greeting sent, no completed order to repeat
    const text = renderRemindLastOrderTemplate(menu.remindLastOrderTemplate, {
      customer,
      order: lastOrder,
    })
    // The router's sendOutbound persists the OUTBOUND Message, updates
    // Conversation.lastMessageAt and emits inbox:new-message, so we don't
    // duplicate that work here.
    try {
      await sendOutbound({
        conversation,
        content: {
          type: 'BUTTONS',
          body: text,
          buttons: [{ id: `reorder:${lastOrder.id}`, displayText: 'Repetir pedido' }],
        },
      })
    } catch (e) {
      console.warn(
        '[automations] remind-last-order button send failed:',
        e?.message || e
      )
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Menu resolution
// ---------------------------------------------------------------------------
// The conversation already carries menuId (set by the inbound pipeline when
// the account → menu link is known). If not, we try to resolve it via the
// providerAccountId against the four candidate columns on Menu, dispatching
// by conversation.provider so we don't accidentally cross-match (e.g. an
// Evolution instance UUID happens to equal a Meta account UUID).
async function resolveMenuFromAccount(conversation) {
  if (conversation?.menuId) {
    return loadMenu(conversation.menuId)
  }

  // Provider-specific account lookup: the instance/account may be linked
  // directly to a Menu via one of the four FKs.
  if (conversation?.providerAccountId) {
    const where = (() => {
      switch (conversation.provider) {
        case 'EVOLUTION_WA':
          return { whatsappInstanceId: conversation.providerAccountId }
        case 'META_WA':
          return { metaWaAccountId: conversation.providerAccountId }
        case 'META_FB':
          return { facebookAccountId: conversation.providerAccountId }
        case 'META_IG':
          return { instagramAccountId: conversation.providerAccountId }
        default:
          return null
      }
    })()
    if (where) {
      const menu = await prisma.menu.findFirst({ where, select: { id: true } })
      if (menu) return loadMenu(menu.id)
    }
  }

  // Final fallback: instance assigned only to a Store (no direct Menu link).
  // Pick the first active menu of the conversation's store so per-menu
  // automations still fire. Covers legacy conversations created before the
  // adapter started persisting a fallback menuId.
  if (conversation?.storeId) {
    const menu = await prisma.menu.findFirst({
      where: { storeId: conversation.storeId, isActive: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    })
    if (menu) return loadMenu(menu.id)
  }

  return null
}

function loadMenu(menuId) {
  return prisma.menu.findUnique({
    where: { id: menuId },
    select: {
      id: true,
      weeklySchedule: true,
      open24Hours: true,
      timezone: true,
      outOfHoursReply: {
        select: { body: true, mediaUrl: true, mediaMimeType: true, mediaFileName: true },
      },
      greetingReply: {
        select: { body: true, mediaUrl: true, mediaMimeType: true, mediaFileName: true },
      },
      registeredGreetingReply: {
        select: { body: true, mediaUrl: true, mediaMimeType: true, mediaFileName: true },
      },
      remindLastOrderEnabled: true,
      remindLastOrderTemplate: true,
      greetingTimeRules: {
        select: {
          startTime: true,
          endTime: true,
          sortOrder: true,
          quickReply: {
            select: { body: true, mediaUrl: true, mediaMimeType: true, mediaFileName: true },
          },
        },
      },
      store: { select: { company: { select: { evolutionEnabled: true } } } },
    },
  })
}

// ---------------------------------------------------------------------------
// Automation rule handlers (each may short-circuit the pipeline)
// ---------------------------------------------------------------------------

// 1. Greeting on first contact or after 6h of inbound inactivity. Takes
//    priority over out-of-hours. Returns true when a greeting was sent (the
//    pipeline should stop for this message so the customer isn't greeted
//    twice in the same minute).
async function maybeSendGreeting({ conversation, message, menu }) {
  const activeGreeting = menu.greetingTimeRules?.length
    ? pickGreetingByTime(menu.greetingTimeRules, menu.timezone) ?? menu.greetingReply
    : menu.greetingReply

  if (!activeGreeting) return false

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
  const recentInbound = await prisma.message.findFirst({
    where: {
      conversationId: conversation.id,
      direction: 'INBOUND',
      createdAt: { gte: sixHoursAgo },
      id: { not: message.id },
    },
    select: { id: true },
  })
  if (recentInbound) return false

  // Registered customer greeting takes precedence when configured (it also
  // owns the "remind last order" follow-up).
  const registeredHandled = await maybeSendRegisteredGreeting({ conversation, menu })
  if (registeredHandled) return true

  await sendAutoReply(conversation, activeGreeting)
  return true
}

// 2. Out-of-hours for subsequent messages when the menu is closed. Skipped
//    when the greeting fired (the greeting already covered this turn).
async function maybeSendOutOfHours({ conversation, menu }) {
  if (!menu.outOfHoursReply) return false
  if (isMenuOpen(menu)) return false
  await sendAutoReply(conversation, menu.outOfHoursReply)
  return true
}

// 3. Keyword → tag matching. Pulls every distinct tag in use for the
//    company and adds any tag whose lowercased text appears in the inbound
//    body. Best-effort; failures are logged but never throw.
async function applyKeywordTags({ conversation, message }) {
  try {
    const allTags = await prisma.$queryRaw`
      SELECT DISTINCT unnest(tags) as tag
      FROM "Conversation"
      WHERE "companyId" = ${conversation.companyId} AND array_length(tags, 1) > 0
    `
    const bodyLower = String(message.body || '').toLowerCase()
    if (!bodyLower) return
    const matched = allTags
      .map(r => r.tag)
      .filter(t => t && bodyLower.includes(String(t).toLowerCase()))
    if (!matched.length) return
    const currentTags = conversation.tags || []
    const newTags = [...new Set([...currentTags, ...matched])]
    if (newTags.length === currentTags.length) return
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { tags: newTags },
    })
  } catch (e) {
    console.warn('[automations] keyword match failed:', e.message)
  }
}

// "Remind last order" as a standalone automation is folded into
// maybeSendRegisteredGreeting above — the WhatsApp-only button is sent
// immediately after the registered greeting and shares the same trigger
// (customer has ≥1 order, menu has the toggle on). We keep the explicit
// channel guard there to make the WA-only constraint visible at the call
// site.

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAutomations({ conversation, message, customer, normalizedMessage }) {
  // eslint-disable-next-line no-unused-vars
  const _customer = customer
  // eslint-disable-next-line no-unused-vars
  const _normalized = normalizedMessage

  if (!conversation || !message) return

  const menu = await resolveMenuFromAccount(conversation)
  if (!menu) {
    console.warn('[automations] no menu resolved for conversation', conversation.id)
    return
  }
  if (!menu.store?.company?.evolutionEnabled) {
    // Historically gated by the Evolution toggle on Company. Kept as-is so
    // automations stay opt-in per company until a multi-channel toggle is
    // introduced.
    console.log(`[automations] evolutionEnabled=false — skipping (menu=${menu.id})`)
    return
  }

  // Greeting may short-circuit the rest of the pipeline so the customer
  // isn't greeted AND told the store is closed in the same turn.
  const greeted = await maybeSendGreeting({ conversation, message, menu })
  if (greeted) return

  const closedReplied = await maybeSendOutOfHours({ conversation, menu })
  if (closedReplied) return

  await applyKeywordTags({ conversation, message })
}

export default { runAutomations }
