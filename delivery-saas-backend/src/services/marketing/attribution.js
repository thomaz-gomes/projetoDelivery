import { prisma } from '../../prisma.js'

const ATTRIBUTABLE_STATUSES = [
  'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA',
  'CONFIRMACAO_PAGAMENTO', 'CONCLUIDO',
]

/**
 * Last-touch attribution within each campaign's configurable window.
 *
 * When an order is created (or transitions into an attributable status),
 * find the most recent MarketingMessage sent to that customer that is
 * still inside its campaign's `conversionWindowHours` window AND not yet
 * attributed AND not excluded (e.g. opt-out mid-window). If a match
 * exists, link the order to the message + campaign and tag the
 * attribution signal:
 *   STRONG — campaign had an attached coupon AND the order used it
 *   WEAK   — window-only attribution (no coupon causality)
 *
 * Idempotent: skips if the order already has attributedCampaignId.
 * Returns { campaignId, messageId, signal } on success, or null.
 */
export async function attributeOrderToCampaign(orderId) {
  if (!orderId) return null
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, companyId: true, customerId: true, menuId: true,
      total: true, status: true, couponId: true,
      attributedCampaignId: true,
    },
  })
  if (!order || !order.customerId) return null
  if (!ATTRIBUTABLE_STATUSES.includes(order.status)) return null
  if (order.attributedCampaignId) return null

  // Use $queryRaw because Prisma's where-builder can't do interval arithmetic
  // against a related field (mc."conversionWindowHours") yet.
  const candidates = await prisma.$queryRaw`
    SELECT mm.id            AS "messageId",
           mm."campaignId"  AS "campaignId",
           mm."sentAt"      AS "sentAt",
           mc."conversionWindowHours" AS "windowHours",
           mc."attributionScope"      AS "scope",
           mc."segmentMenuId"         AS "campaignMenuId",
           mc."couponId"              AS "campaignCouponId"
    FROM   "MarketingMessage" mm
    JOIN   "MarketingCampaign" mc ON mc.id = mm."campaignId"
    WHERE  mm."customerId" = ${order.customerId}::text
      AND  mm."companyId"  = ${order.companyId}::text
      AND  mm."sentAt" IS NOT NULL
      AND  mm."sentAt" + (mc."conversionWindowHours" || ' hours')::interval > NOW()
      AND  mm."convertedOrderId" IS NULL
      AND  mm."excludedFromAttribution" = false
    ORDER BY mm."sentAt" DESC
    LIMIT 1
  `
  const row = candidates?.[0]
  if (!row) return null

  // Scope guard
  if (row.scope === 'menu' && row.campaignMenuId && order.menuId !== row.campaignMenuId) {
    return null
  }

  const signal = (row.campaignCouponId && order.couponId === row.campaignCouponId)
    ? 'STRONG' : 'WEAK'

  await prisma.$transaction([
    prisma.marketingMessage.update({
      where: { id: row.messageId },
      data: {
        convertedOrderId: order.id,
        convertedAt: new Date(),
        convertedValue: order.total,
        attributionSignal: signal,
      },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: { attributedCampaignId: row.campaignId, attributedMessageId: row.messageId },
    }),
  ])
  console.log('[attribution] order', order.id, '→ campaign', row.campaignId, signal)
  return { campaignId: row.campaignId, messageId: row.messageId, signal }
}

/**
 * Reverses attribution when an order is cancelled. Restores the
 * MarketingMessage so a different order in the same window could
 * attribute to it later (rare, but correct).
 */
export async function revokeAttribution(orderId) {
  if (!orderId) return null
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, attributedMessageId: true },
  })
  if (!order?.attributedMessageId) return null
  await prisma.$transaction([
    prisma.marketingMessage.update({
      where: { id: order.attributedMessageId },
      data: {
        convertedOrderId: null,
        convertedAt: null,
        convertedValue: null,
        attributionSignal: null,
      },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: { attributedCampaignId: null, attributedMessageId: null },
    }),
  ])
  console.log('[attribution] revoked for order', order.id)
}
