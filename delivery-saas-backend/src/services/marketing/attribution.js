import { prisma } from '../../prisma.js'

const ATTRIBUTABLE_STATUSES = [
  'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA',
  'CONFIRMACAO_PAGAMENTO', 'CONCLUIDO',
]

// Stub: real implementation in Task 1.19. Kept exported so orders.js
// and ifoodWebhookProcessor.js can wire the hooks now without breaking.
export async function attributeOrderToCampaign(orderId) {
  if (!orderId) return null
  return null
}

// Stub: real implementation in Task 1.19.
export async function revokeAttribution(orderId) {
  if (!orderId) return null
  return null
}
