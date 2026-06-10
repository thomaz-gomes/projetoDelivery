// src/services/marketing/triggerEvaluators/windowWithOrder.js
//
// Trigger WINDOW_WITH_ORDER: cliente abriu janela 24h, fez pedido, e após
// delayMinutes desde o pedido a campanha dispara mensagem livre (pós-venda,
// upsell, pedido de avaliação, etc.). Sempre dentro da janela 24h pra
// usar texto livre sem template.

import { prisma } from '../../../prisma.js'

export async function evaluateWindowWithOrder({ campaign, now = new Date() }) {
  const params = campaign.triggerParams || {}
  const delayMinutes = Number(params.delayMinutes ?? 60)
  const maxAgeHours = Math.min(Number(params.maxAgeHours ?? 23), 23.5)
  const onlyMenuId = params.menuId || null
  const minOrderValue = params.minOrderValue !== undefined ? Number(params.minOrderValue) : null
  const onlyFirstTime = !!params.onlyFirstTimeCustomers

  const earliestInbound = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000)
  const orderCutoff = new Date(now.getTime() - delayMinutes * 60 * 1000)

  // Pedidos elegíveis: criados dentro da janela do inbound, com idade >= delay.
  const orders = await prisma.order.findMany({
    where: {
      companyId: campaign.companyId,
      createdAt: { gte: earliestInbound, lte: orderCutoff },
      customerId: { not: null },
      ...(minOrderValue !== null ? { total: { gte: minOrderValue } } : {}),
      ...(onlyMenuId ? { menuId: onlyMenuId } : {}),
    },
    select: { id: true, customerId: true, total: true, createdAt: true, menuId: true },
    orderBy: { createdAt: 'asc' },
  })
  if (orders.length === 0) return []

  const customerIds = [...new Set(orders.map(o => o.customerId))]

  // Quando o operador pinou um canal específico (Meta WA account ou Evolution
  // instance) na campanha, filtramos as conversas pelo MESMO canal — campanha
  // só dispara pra clientes que entraram em contato pelo número escolhido.
  const channelFilter = {}
  if (campaign.metaWaAccountId) {
    channelFilter.providerAccountId = campaign.metaWaAccountId
    channelFilter.provider = 'META_WA'
  } else if (campaign.evolutionInstanceName) {
    channelFilter.instanceName = campaign.evolutionInstanceName
    channelFilter.provider = 'EVOLUTION_WA'
  }

  // Conversas correspondentes — precisa estar dentro da janela inbound.
  const conversations = await prisma.conversation.findMany({
    where: {
      companyId: campaign.companyId,
      channel: 'WHATSAPP',
      customerId: { in: customerIds },
      lastInboundAt: { gte: earliestInbound },
      ...channelFilter,
    },
    select: {
      id: true, customerId: true, lastInboundAt: true,
      menuId: true, provider: true, providerAccountId: true,
    },
  })
  const convByCustomer = new Map()
  for (const conv of conversations) convByCustomer.set(conv.customerId, conv)

  // First-time customer: total de pedidos do customer === 1
  let firstTimeSet = null
  if (onlyFirstTime) {
    const counts = await prisma.order.groupBy({
      by: ['customerId'],
      where: { companyId: campaign.companyId, customerId: { in: customerIds } },
      _count: { _all: true },
    })
    firstTimeSet = new Set(counts.filter(c => c._count._all === 1).map(c => c.customerId))
  }

  // Mensagens já criadas — anti-duplicação por (campaign, customer, inbound)
  const recentMessages = await prisma.marketingMessage.findMany({
    where: {
      companyId: campaign.companyId,
      campaignId: campaign.id,
      customerId: { in: customerIds },
      createdAt: { gte: earliestInbound },
    },
    select: { customerId: true, createdAt: true },
  })

  const out = []
  for (const order of orders) {
    const conv = convByCustomer.get(order.customerId)
    if (!conv) continue
    // Pedido tem que ter sido feito DEPOIS do inbound
    if (order.createdAt < conv.lastInboundAt) continue
    if (firstTimeSet && !firstTimeSet.has(order.customerId)) continue
    const already = recentMessages.find(m =>
      m.customerId === order.customerId && m.createdAt >= conv.lastInboundAt
    )
    if (already) continue

    out.push({
      conversationId: conv.id,
      customerId: order.customerId,
      lastInboundAt: conv.lastInboundAt,
      menuId: conv.menuId || order.menuId,
      provider: conv.provider,
      providerAccountId: conv.providerAccountId,
      orderId: order.id,
      orderTotal: order.total,
    })
  }

  return out
}
