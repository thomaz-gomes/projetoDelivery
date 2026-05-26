// src/services/marketing/messageStatusHooks.js
// Webhook-side hook that mirrors provider delivery/read receipts onto the
// MarketingMessage row whose externalId matches. Called from both
// webhookMeta.js (Meta statuses[]) and webhookEvolution.js
// (messages.update / MESSAGES_UPDATE). Wrapped at the callsite in
// try/catch so a marketing-side failure never blocks the webhook flow.
//
// Status progression rules:
//   - READ never downgrades to DELIVERED (DELIVERED is only applied when
//     the current status is not already READ)
//   - FAILED / OPTED_OUT are terminal-ish in the marketing sense; we do
//     not overwrite them with DELIVERED/READ
//   - Idempotent: if no MarketingMessage matches the externalId, the call
//     is a no-op (regular outbound messages will not match by design)

import { prisma } from '../../prisma.js'

/**
 * Apply a provider status (delivered/read) to the MarketingMessage row
 * tagged with `externalId`. Channel-agnostic — caller maps provider-
 * specific status names ('delivered' / 'read' for Meta, '3' / '4' / '5'
 * for Baileys/Evolution) into one of: 'delivered' | 'read'.
 *
 * @param {string} externalId  Provider-side message id (e.g. wamid)
 * @param {'delivered'|'read'} status  Normalized status name
 * @param {Date} [timestamp]   Provider-provided timestamp; defaults to now
 */
export async function applyMarketingStatusFromWebhook(externalId, status, timestamp) {
  if (!externalId || !status) return
  const ts = timestamp instanceof Date ? timestamp : new Date()

  const mm = await prisma.marketingMessage.findFirst({
    where: { externalId: String(externalId) },
    select: { id: true, status: true },
  })
  if (!mm) return

  // FAILED / OPTED_OUT are not overwritten — they encode an explicit
  // decision (provider rejection, customer opt-out) we don't want a
  // late-arriving delivered/read receipt to mask.
  if (mm.status === 'FAILED' || mm.status === 'OPTED_OUT') return

  const updateData = {}
  if (status === 'delivered') {
    // Don't downgrade READ → DELIVERED. The deliveredAt timestamp is still
    // useful (some providers fire delivered after read out of order) so we
    // record it, but we leave the enum at READ.
    updateData.deliveredAt = ts
    if (mm.status !== 'READ') updateData.status = 'DELIVERED'
  } else if (status === 'read') {
    updateData.readAt = ts
    updateData.status = 'READ'
  } else {
    return
  }

  if (Object.keys(updateData).length === 0) return
  await prisma.marketingMessage.update({
    where: { id: mm.id },
    data: updateData,
  })
}
