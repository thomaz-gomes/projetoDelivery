import { prisma } from '../prisma.js'

const INACTIVITY_MS = 24 * 60 * 60 * 1000

/**
 * Marks WhatsApp/FB/IG conversations as CLOSED when their last message is
 * older than 24h. Reopen is automatic when a new inbound message arrives
 * (see messaging/inboundPipeline.js#resolveConversation).
 *
 * Idempotent: re-running on the same set is a no-op once the rows have
 * been flipped. Uses lastMessageAt as the inactivity signal — conversations
 * without any message yet are skipped to avoid auto-closing brand-new rows
 * that the operator just opened from the contact search.
 */
export async function closeInactiveConversations() {
  const cutoff = new Date(Date.now() - INACTIVITY_MS)
  const result = await prisma.conversation.updateMany({
    where: {
      status: 'OPEN',
      lastMessageAt: { lt: cutoff, not: null },
    },
    data: { status: 'CLOSED' },
  })
  return { closed: result.count, cutoff }
}
