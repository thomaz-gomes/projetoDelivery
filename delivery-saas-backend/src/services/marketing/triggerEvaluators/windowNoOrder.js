// src/services/marketing/triggerEvaluators/windowNoOrder.js
//
// Trigger WINDOW_NO_ORDER: identifica conversas onde o cliente abriu a
// janela de 24h da Meta enviando mensagem inbound, esperou X minutos
// (delayMinutes) e AINDA não fez nenhum pedido. Usado pra mandar uma
// mensagem livre de engajamento dentro da janela (gratuita pela Meta).
//
// Anti-duplicação: query exclui customers que já têm MarketingMessage da
// mesma campanha criada DEPOIS do último inbound. Reabertura da janela
// (nova mensagem do cliente após 24h) qualifica de novo.

import { prisma } from '../../../prisma.js'

export async function evaluateWindowNoOrder({ campaign, now = new Date() }) {
  const params = campaign.triggerParams || {}
  const delayMinutes = Number(params.delayMinutes ?? 30)
  const maxAgeHours = Math.min(Number(params.maxAgeHours ?? 23), 23.5) // margem pra janela 24h
  const onlyMenuId = params.menuId || null

  const earliestInbound = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000)
  const latestInbound = new Date(now.getTime() - delayMinutes * 60 * 1000)

  // Quando o operador pinou um canal específico (Meta WA account ou Evolution
  // instance) na campanha, filtramos as conversas pelo MESMO providerAccountId
  // / instanceName — campanha só dispara pra clientes que entraram em contato
  // pelo número escolhido. Sem pin, vale qualquer canal WhatsApp da empresa.
  const channelFilter = {}
  if (campaign.metaWaAccountId) {
    channelFilter.providerAccountId = campaign.metaWaAccountId
    channelFilter.provider = 'META_WA'
  } else if (campaign.evolutionInstanceName) {
    channelFilter.instanceName = campaign.evolutionInstanceName
    channelFilter.provider = 'EVOLUTION_WA'
  }

  // Candidatas: conversas WhatsApp com inbound recente, ainda dentro da
  // janela de 24h e além do delay. Filtra por menuId/canal se especificado.
  const conversations = await prisma.conversation.findMany({
    where: {
      companyId: campaign.companyId,
      channel: 'WHATSAPP',
      lastInboundAt: { gte: earliestInbound, lte: latestInbound },
      customerId: { not: null },
      ...(onlyMenuId ? { menuId: onlyMenuId } : {}),
      ...channelFilter,
    },
    select: {
      id: true,
      customerId: true,
      lastInboundAt: true,
      menuId: true,
      provider: true,
      providerAccountId: true,
    },
  })

  const customerIds = conversations.map(c => c.customerId).filter(Boolean)
  if (customerIds.length === 0) return []

  // Pedidos criados após o inbound desses customers.
  const recentOrders = await prisma.order.findMany({
    where: {
      companyId: campaign.companyId,
      customerId: { in: customerIds },
      createdAt: { gte: earliestInbound },
    },
    select: { customerId: true, createdAt: true },
  })
  const customersWithRecentOrder = new Set()
  for (const conv of conversations) {
    const order = recentOrders.find(o =>
      o.customerId === conv.customerId && o.createdAt >= conv.lastInboundAt
    )
    if (order) customersWithRecentOrder.add(conv.customerId)
  }

  // Mensagens da campanha já criadas para esses customers — anti-duplicação.
  // Critério: existe MarketingMessage cujo createdAt >= conv.lastInboundAt.
  const recentMessages = await prisma.marketingMessage.findMany({
    where: {
      companyId: campaign.companyId,
      campaignId: campaign.id,
      customerId: { in: customerIds },
      createdAt: { gte: earliestInbound },
    },
    select: { customerId: true, createdAt: true },
  })
  const alreadyMessaged = new Set()
  for (const conv of conversations) {
    if (recentMessages.find(m =>
      m.customerId === conv.customerId && m.createdAt >= conv.lastInboundAt
    )) {
      alreadyMessaged.add(conv.customerId)
    }
  }

  // Filtra qualificadas
  const qualified = conversations.filter(conv =>
    !customersWithRecentOrder.has(conv.customerId) &&
    !alreadyMessaged.has(conv.customerId)
  )

  return qualified.map(conv => ({
    conversationId: conv.id,
    customerId: conv.customerId,
    lastInboundAt: conv.lastInboundAt,
    menuId: conv.menuId,
    provider: conv.provider,
    providerAccountId: conv.providerAccountId,
  }))
}
