import { prisma } from '../prisma.js'

function isPickupOrder(order) {
  const ot = order?.orderType
    || order?.payload?.orderType
    || order?.payload?.order?.orderType
    || order?.payload?.type
  const upto = ot ? String(ot).toUpperCase() : ''
  return upto === 'TAKEOUT' || upto === 'PICKUP' || upto === 'TAKE-OUT' || upto === 'PICK-UP'
}

function mapStatusToChatKey(internalStatus, order) {
  switch (internalStatus) {
    case 'EM_PREPARO': return 'CONFIRMED'
    // SAIU_PARA_ENTREGA em pedido de retirada significa "aguardando retirada"
    // (não existe entregador a caminho) — avisa que o pedido está pronto.
    case 'SAIU_PARA_ENTREGA': return isPickupOrder(order) ? 'READY_PICKUP' : 'DISPATCHED'
    // PRONTO é o status interno gerado pelo evento READY_TO_PICKUP do iFood —
    // mesmo aviso de retirada. Em delivery, PRONTO (etapa antes do despacho)
    // não notifica o cliente. Dedup por orderId+kind evita mensagem dupla
    // quando o pedido passa por PRONTO e depois SAIU_PARA_ENTREGA.
    case 'PRONTO': return isPickupOrder(order) ? 'READY_PICKUP' : null
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

    const chatKey = mapStatusToChatKey(newStatus, order)
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
    emitirIfoodChat({
      orderNumber,
      orderId: order.id,
      message: finalMessage,
      storeId,
      companyId: order.companyId,
      kind: chatKey,
    })
  } catch (e) {
    console.warn('[ifoodChatEmitter] tryEmitIfoodChat failed:', e?.message || e)
  }
}
