// src/services/marketing/sender.js
//
// Picks up due MarketingSendQueue jobs (locked via SELECT ... FOR UPDATE
// SKIP LOCKED so it is parallel-safe) and dispatches each via the
// channel resolved at send time. For now the rendering is minimal — a
// proper Cloud-template renderer arrives in Task 1.12.
//
// Retry policy:
//   - 4xx (except 429) and explicit permanent Meta error codes      → FAILED
//   - 5xx and 429                                                   → exponential backoff
//   - max MAX_ATTEMPTS retries; after that the message is FAILED

import { prisma } from '../../prisma.js'
import { pickConnectedChannel } from '../whatsapp/pickChannel.js'
import { renderTemplate } from './templateRenderer.js'

const MAX_ATTEMPTS = 3
const META_THROTTLE_BACKOFF_MS = 2_000
// Permanent Meta-WA error codes (recipient not on WA, window expired, unsupported type, ...)
const PERMANENT_META_ERROR_CODES = [131026, 131047, 131051]

export async function drainSendQueue() {
  const BATCH = 50
  const now = new Date()
  // FOR UPDATE SKIP LOCKED — parallel-safe even with N workers.
  // Lock for 5 minutes so a crashed/stalled worker doesn't block the row forever.
  const jobs = await prisma.$queryRaw`
    UPDATE "MarketingSendQueue"
    SET "lockUntil" = NOW() + interval '5 minutes'
    WHERE id IN (
      SELECT id FROM "MarketingSendQueue"
      WHERE "scheduledFor" <= ${now}
        AND "lockUntil"   <= ${now}
      ORDER BY "scheduledFor" ASC
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `
  for (const job of jobs) {
    await processSendJob(job)
  }
}

async function processSendJob(job) {
  const message = await prisma.marketingMessage.findUnique({
    where: { id: job.messageId },
    include: {
      campaign: { include: { template: true, segment: true, coupon: true } },
      customer: true,
    },
  })
  if (!message || message.status !== 'QUEUED') {
    await removeFromQueue(job.id)
    return
  }

  // Re-checks (state may have changed since enqueue)
  if (message.customer.optOutMarketingAt) {
    await prisma.marketingMessage.update({
      where: { id: message.id },
      data: { status: 'OPTED_OUT', excludedFromAttribution: true },
    })
    await removeFromQueue(job.id)
    return
  }
  if (
    message.campaign.status === 'PAUSED' ||
    message.campaign.status === 'CANCELLED'
  ) {
    // Leave in the queue. If the campaign resumes, the job picks up again.
    // The lock will expire on its own so we don't spin on it.
    return
  }

  if (!message.customer.whatsapp) {
    await failPermanent(message, job, 'customer-no-whatsapp')
    return
  }

  const provider = await resolveChannelForSend(message)
  if (!provider) {
    await failPermanent(message, job, 'no-channel')
    return
  }

  // Atomically claim the message: only proceed if we successfully flip
  // QUEUED → SENDING. Without this, a worker that crashes between a
  // successful provider call and the SENT update would let another worker
  // re-fetch the row after lockUntil expires and the recipient would get
  // the same message twice.
  //
  // V1 limitation: a worker that crashes after this transition leaves the
  // row in SENDING with the queue lock eventually expiring. The next
  // worker sees SENDING (not QUEUED) and skips — the message will appear
  // "stuck" and needs human investigation (reset to QUEUED or mark FAILED).
  // We accept this stale-row risk in exchange for at-most-once delivery.
  const claimed = await prisma.marketingMessage.updateMany({
    where: { id: message.id, status: 'QUEUED' },
    data: { status: 'SENDING' },
  })
  if (claimed.count === 0) {
    // Another worker already claimed the row (or status moved away from QUEUED).
    await removeFromQueue(job.id)
    return
  }

  const rendered = renderMessage(message)

  try {
    let result
    if (provider.type === 'META_WA') {
      // Cloud API requires template send outside the 24h window.
      const adapterMod = await import('../../messaging/adapters/whatsappMeta.adapter.js')
      const adapter = adapterMod.default || adapterMod
      if (typeof adapter.sendTemplate === 'function' && rendered.template) {
        result = await adapter.sendTemplate(provider.account, message.customer.whatsapp, {
          name: rendered.template.name,
          languageCode: rendered.template.languageCode,
          components: rendered.template.components,
        })
      } else {
        result = await adapter.sendMessage(provider.account, message.customer.whatsapp, {
          type: 'TEXT',
          text: rendered.text,
        })
      }
    } else {
      const wa = await import('../../wa.js')
      const to = wa.normalizePhone(message.customer.whatsapp)
      // Evolution path branches by whether the campaign has a media
      // attachment: image-with-caption uses /message/sendMedia, plain
      // text uses /message/sendText. The freeText acts as the caption.
      let evoResp
      if (message.campaign.mediaUrl) {
        evoResp = await wa.evoSendImage({
          instanceName: provider.instanceName,
          to,
          mediaUrl: message.campaign.mediaUrl,
          caption: rendered.text || '',
        })
      } else {
        evoResp = await wa.evoSendText({
          instanceName: provider.instanceName,
          to,
          text: rendered.text,
        })
      }
      // Evolution (Baileys-style) returns the WhatsApp message identifier as
      // `key.id`. webhookEvolution.handleMessagesUpdate matches incoming
      // delivered/read events by this exact field — without capturing it,
      // the funnel showed zero delivered/read for Evolution-only campaigns.
      const externalId =
        evoResp?.key?.id ||
        evoResp?.id ||
        evoResp?.messageId ||
        null
      result = { externalId }
    }

    await prisma.marketingMessage.update({
      where: { id: message.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerUsed: provider.type,
        providerAccountId: provider.accountId || null,
        instanceName: provider.instanceName || null,
        externalId: result?.externalId || null,
      },
    })

    // Mirror to Conversation/Message for inbox visibility (best-effort)
    try {
      const notify = await import('../notify.js')
      if (typeof notify.persistOutboundWhatsappMessage === 'function') {
        await notify.persistOutboundWhatsappMessage({
          companyId: message.companyId,
          provider: provider.type,
          providerAccountId: provider.accountId || null,
          instanceName: provider.instanceName || null,
          phone: message.customer.whatsapp,
          text: rendered.text,
          externalId: result?.externalId || null,
          customerId: message.customerId,
          contactName: message.customer.fullName,
          menuId: message.campaign.segmentMenuId || null,
          storeId: null,
        })
      } else {
        console.warn('[marketing-sender] persistOutboundWhatsappMessage not exported — skipping inbox mirror')
      }
    } catch (_) { /* persist-to-inbox is best-effort */ }

    await removeFromQueue(job.id)

    // Crude Meta throttle: usagePercent not always available; if provider returned a hint, slow down.
    if (provider.type === 'META_WA' && (result?.usagePercent || 0) > 80) {
      await new Promise(r => setTimeout(r, META_THROTTLE_BACKOFF_MS))
    }
  } catch (err) {
    await handleSendError(job, message, err)
  }
}

async function resolveChannelForSend(message) {
  const campaign = message.campaign

  // Explicit channel pin takes precedence over the type-only `channel`
  // field. The campaign create/patch routes set BOTH (channel +
  // pin) atomically, so reading either is consistent — but the pin is
  // the authoritative selector when present.
  if (campaign.metaWaAccountId) {
    const acc = await prisma.metaMessagingAccount.findUnique({
      where: { id: campaign.metaWaAccountId },
    })
    if (acc && acc.status === 'ACTIVE') {
      return { type: 'META_WA', account: acc, accountId: acc.id }
    }
    return null  // pinned account no longer active — fail loud, no fallback
  }
  if (campaign.evolutionInstanceName) {
    const inst = await prisma.whatsAppInstance.findUnique({
      where: { instanceName: campaign.evolutionInstanceName },
    })
    if (inst && inst.status === 'CONNECTED') {
      return { type: 'EVOLUTION_WA', instanceName: inst.instanceName }
    }
    return null  // pinned instance disconnected — fail loud
  }

  // AUTO: mirror customer's last conversation
  if (campaign.channel === 'AUTO') {
    return pickConnectedChannel({
      companyId: message.companyId,
      customerId: message.customerId,
      menuId: campaign.segmentMenuId,
    })
  }
  if (campaign.channel === 'META_WA') {
    // Prefer menu-bound Meta account; else any active company account
    if (campaign.segmentMenuId) {
      const menu = await prisma.menu.findUnique({
        where: { id: campaign.segmentMenuId },
        include: { metaWaAccount: true },
      })
      if (menu?.metaWaAccount?.status === 'ACTIVE') {
        return { type: 'META_WA', account: menu.metaWaAccount, accountId: menu.metaWaAccount.id }
      }
    }
    const acc = await prisma.metaMessagingAccount.findFirst({
      where: { companyId: message.companyId, provider: 'META_WA', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    return acc ? { type: 'META_WA', account: acc, accountId: acc.id } : null
  }
  if (campaign.channel === 'EVOLUTION_WA') {
    if (campaign.segmentMenuId) {
      const menu = await prisma.menu.findUnique({
        where: { id: campaign.segmentMenuId },
        include: { whatsappInstance: true },
      })
      if (menu?.whatsappInstance?.status === 'CONNECTED') {
        return { type: 'EVOLUTION_WA', instanceName: menu.whatsappInstance.instanceName }
      }
    }
    const inst = await prisma.whatsAppInstance.findFirst({
      where: { companyId: message.companyId, status: 'CONNECTED' },
      orderBy: { createdAt: 'desc' },
    })
    return inst ? { type: 'EVOLUTION_WA', instanceName: inst.instanceName } : null
  }
  return null
}

function renderMessage(message) {
  // Evolution free text (with simple placeholders)
  const firstName = (message.customer.fullName || '').split(/\s+/)[0] || ''
  let text = message.campaign.freeText || ''
  text = text
    .replace(/\{nome\}/g, firstName)
    .replace(/\{cliente\}/g, message.customer.fullName || '')
    .replace(/\{cupom\}/g, message.campaign.coupon?.code || '')

  // Cloud template
  let template = null
  if (message.campaign.template && message.campaign.templateVariableMap) {
    template = renderTemplate(message, message.campaign.template, message.campaign.templateVariableMap)
  } else if (message.campaign.template) {
    // Template selected but no variable mapping — render with empty components
    template = {
      name: message.campaign.template.name,
      languageCode: message.campaign.template.language || 'pt_BR',
      components: [],
    }
  }

  return { text, template }
}

async function failPermanent(message, job, errorMessage) {
  await prisma.marketingMessage.update({
    where: { id: message.id },
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      errorMessage: String(errorMessage).slice(0, 500),
    },
  })
  await removeFromQueue(job.id)
}

async function handleSendError(job, message, err) {
  const status = err?.response?.status
  const errorCode = err?.response?.data?.error?.code
  const isPermanent =
    (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) ||
    PERMANENT_META_ERROR_CODES.includes(errorCode)

  if (isPermanent) return failPermanent(message, job, err.message)

  const attempts = (job.attempts || 0) + 1
  if (attempts >= MAX_ATTEMPTS) {
    return failPermanent(message, job, `max attempts: ${err.message}`)
  }
  // Reset message status back to QUEUED so the next attempt's atomic
  // QUEUED→SENDING claim succeeds. Without this, retried jobs would be
  // dropped by the claim check.
  await prisma.marketingMessage.update({
    where: { id: message.id },
    data: { status: 'QUEUED' },
  })
  const backoffMs = Math.min(30_000 * Math.pow(2, attempts), 10 * 60_000)
  await prisma.marketingSendQueue.update({
    where: { id: job.id },
    data: {
      attempts,
      scheduledFor: new Date(Date.now() + backoffMs),
      lockUntil: new Date(),
      lastError: String(err.message).slice(0, 500),
    },
  })
}

async function removeFromQueue(jobId) {
  await prisma.marketingSendQueue.delete({ where: { id: jobId } }).catch(() => {})
}
