import { prisma } from '../../prisma.js'

/**
 * Resolve which WhatsApp channel to use for sending to a customer.
 *
 * Order of preference:
 *   1. Mirror customer's most recent WhatsApp conversation provider
 *      (only when customerId is given AND a recent conv exists for the
 *      same menu/store scope as the order)
 *   2. Menu-level whatsappInstance / metaWaAccount (when menuId given)
 *   3. Store-level whatsappInstance (when storeId given)
 *   4. null — operator must configure
 *
 * Never falls back to "any connected company instance" — that would
 * route messages through the wrong brand/cardápio.
 *
 * Returns one of:
 *   { type: 'META_WA',      account, accountId }
 *   { type: 'EVOLUTION_WA', instanceName }
 *   null
 */
export async function pickConnectedChannel({ companyId, customerId = null, menuId = null, storeId = null }) {
  if (!companyId) return null

  // 1. Mirror last conversation (most accurate for opted-in customers)
  if (customerId) {
    const conv = await prisma.conversation.findFirst({
      where: {
        companyId,
        customerId,
        channel: 'WHATSAPP',
        ...(menuId ? { menuId } : storeId ? { storeId } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { provider: true, providerAccountId: true, instanceName: true },
    })
    if (conv?.provider === 'META_WA' && conv.providerAccountId) {
      const acc = await prisma.metaMessagingAccount.findFirst({
        where: { id: conv.providerAccountId, status: 'ACTIVE' },
      })
      if (acc) return { type: 'META_WA', account: acc, accountId: acc.id }
    }
    if (conv?.provider === 'EVOLUTION_WA' && conv.instanceName) {
      const inst = await prisma.whatsAppInstance.findUnique({
        where: { instanceName: conv.instanceName },
      })
      if (inst?.status === 'CONNECTED') {
        return { type: 'EVOLUTION_WA', instanceName: inst.instanceName }
      }
    }
  }

  // 2. Menu-level
  if (menuId) {
    const menu = await prisma.menu.findUnique({
      where: { id: menuId },
      include: { whatsappInstance: true, metaWaAccount: true },
    })
    if (menu?.whatsappInstance?.status === 'CONNECTED') {
      return { type: 'EVOLUTION_WA', instanceName: menu.whatsappInstance.instanceName }
    }
    if (menu?.metaWaAccount?.status === 'ACTIVE') {
      return { type: 'META_WA', account: menu.metaWaAccount, accountId: menu.metaWaAccount.id }
    }
  }

  // 3. Store-level
  if (storeId) {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { whatsappInstance: true },
    })
    if (store?.whatsappInstance?.status === 'CONNECTED') {
      return { type: 'EVOLUTION_WA', instanceName: store.whatsappInstance.instanceName }
    }
  }

  return null
}
