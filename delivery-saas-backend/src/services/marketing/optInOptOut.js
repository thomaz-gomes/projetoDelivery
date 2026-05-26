// src/services/marketing/optInOptOut.js
//
// Customer marketing opt-in/out lifecycle helpers. Used by inbound webhook
// processing to:
//
//   - Tacit-opt-in customers who message us (Meta permits this while the
//     conversation is active — see LGPD doc in docs/marketing-campaigns).
//   - Respect opt-out keywords (PARAR, STOP, etc.) and exclude any in-flight
//     marketing messages from attribution so the campaign report does not
//     credit conversions to customers who just told us to stop.
//
// Both helpers are no-ops when the customer is already in the target state,
// keeping the call sites cheap to run on every inbound event.

import { prisma } from '../../prisma.js'

const OPT_OUT_KEYWORDS = ['PARAR', 'STOP', 'SAIR', 'CANCELAR', 'DESCADASTRAR', 'PARE']

export function isOptOutMessage(text) {
  const normalized = String(text || '').trim().toUpperCase()
  return OPT_OUT_KEYWORDS.includes(normalized)
}

/**
 * Tacit opt-in for customers who send an inbound message — Meta permits
 * this while the conversation is active. Skips if the customer has
 * explicitly opted out.
 *
 * Returns true if a state change occurred.
 */
export async function maybeAutoOptIn(customerId) {
  if (!customerId) return false
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { optInMarketing: true, optOutMarketingAt: true },
  })
  if (c?.optOutMarketingAt) return false
  if (c?.optInMarketing) return false
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      optInMarketing: true,
      optInMarketingAt: new Date(),
      optInMarketingSource: 'inbound',
    },
  })
  return true
}

/**
 * If the inbound text is a recognized opt-out keyword, mark the customer
 * as opted out and exclude any in-flight marketing messages from
 * attribution.
 *
 * Returns true if an opt-out was processed.
 */
export async function maybeAutoOptOut(customerId, text) {
  if (!isOptOutMessage(text)) return false
  if (!customerId) return false
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      optInMarketing: false,
      optOutMarketingAt: new Date(),
    },
  })
  await prisma.marketingMessage.updateMany({
    where: {
      customerId,
      attributionLockedAt: null,
      excludedFromAttribution: false,
    },
    data: { excludedFromAttribution: true },
  })
  return true
}
