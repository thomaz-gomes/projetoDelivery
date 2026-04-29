import { prisma } from '../prisma.js'

function mapStatusToChatKey(internalStatus) {
  switch (internalStatus) {
    case 'EM_PREPARO': return 'CONFIRMED'
    case 'SAIU_PARA_ENTREGA': return 'DISPATCHED'
    case 'CONCLUIDO': return 'DELIVERED'
    default: return null
  }
}

function isIfoodOrder(order) {
  // Most reliable signal: all iFood orders have an externalId set by the webhook processor.
  // Manual orders created in the system never have one.
  if (order?.externalId) return true
  if (!order?.payload) return false
  const p = order.payload
  return (
    p.provider === 'IFOOD' ||
    p.order?.salesChannel === 'IFOOD' ||
    p.salesChannel === 'IFOOD' ||
    Boolean(p.order?.merchant || p.merchant)
  )
}

export async function tryEmitIfoodChat(order, newStatus) {
  try {
    if (!isIfoodOrder(order)) return

    const chatKey = mapStatusToChatKey(newStatus)
    if (!chatKey) return

    const storeId = order.storeId
    if (!storeId) return

    const msgConfig = await prisma.ifoodChatMessage.findUnique({
      where: { storeId_status: { storeId, status: chatKey } },
    })
    if (!msgConfig || !msgConfig.enabled) return

    const orderNumber = order.displayId || order.externalId || String(order.id)
    const customerName = order.payload?.customer?.name || order.payload?.order?.customer?.name || 'Cliente'

    const finalMessage = msgConfig.message
      .replace(/\{nome\}/g, customerName)
      .replace(/\{numero\}/g, orderNumber)

    const { emitirIfoodChat } = await import('../index.js')
    emitirIfoodChat({ orderNumber, message: finalMessage, storeId, companyId: order.companyId })
  } catch (e) {
    console.warn('[ifoodChatEmitter] tryEmitIfoodChat failed:', e?.message || e)
  }
}
