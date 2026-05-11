// src/messaging/buttonReplies.js
// Pre-automation hook for inbound interactive-button taps. Currently the only
// recognised button is "Repetir pedido" (reorder), which validates the
// referenced order belongs to the conversation's customer/company, generates
// a short magic-link URL, sends it as a text reply, and short-circuits the
// regular automations pipeline so the customer isn't greeted twice in the
// same minute.
//
// The button id format is `reorder:<orderId>` — set in
// automations.js#maybeSendRegisteredGreeting when the remind-last-order
// follow-up button is dispatched.

import { prisma } from '../prisma.js'
import { createShortReorderLink } from '../services/reorderHelpers.js'
import { sendOutbound as routerSendOutbound } from './router.js'

// Returns true when the button was recognised and handled (the pipeline
// should skip its regular automation steps for this turn). Returns false
// when the button doesn't match — caller falls back to runAutomations.
export async function handleButtonReply({ conversation, normalizedMessage }) {
  const reorderButton = normalizedMessage?.reorderButton
  if (!reorderButton?.orderId) return false

  const order = await prisma.order.findFirst({
    where: { id: reorderButton.orderId, companyId: conversation.companyId },
    select: { id: true, customerId: true, companyId: true },
  })
  if (!order) return false

  // Defense: require the conversation's customer to match the order's customer.
  if (conversation.customerId && order.customerId && conversation.customerId !== order.customerId) {
    return false
  }

  const link = await createShortReorderLink({
    companyId: order.companyId,
    orderId: order.id,
    customerId: order.customerId,
  })
  if (!link) {
    console.warn('[buttonReplies] short link not built — PUBLIC_FRONTEND_URL not set or invalid')
    return false
  }

  const text = `Pronto! Toque no link abaixo para revisar e confirmar seu pedido:\n\n${link}\n\nO link é válido por 24h.`
  try {
    await routerSendOutbound({
      conversationId: conversation.id,
      content: { type: 'TEXT', text },
    })
  } catch (err) {
    console.warn('[buttonReplies] failed to send magic link:', err?.message || err)
  }
  return true
}

export default { handleButtonReply }
