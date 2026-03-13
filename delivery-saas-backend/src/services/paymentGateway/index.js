import { prisma } from '../../prisma.js'
import { decrypt } from '../encryption.js'
import { MercadoPagoAdapter } from './mercadopago.adapter.js'

const adapters = {
  MERCADOPAGO: MercadoPagoAdapter,
}

/**
 * Returns the active gateway adapter instance with decrypted credentials.
 * @returns {Promise<{adapter, config}>}
 */
export async function getActiveGateway() {
  const config = await prisma.saasGatewayConfig.findFirst({
    where: { isActive: true },
  })
  if (!config) {
    throw new Error('Nenhum gateway de pagamento configurado. Configure em SaaS > Gateway.')
  }

  const AdapterClass = adapters[config.provider.toUpperCase()]
  if (!AdapterClass) {
    throw new Error(`Gateway adapter não encontrado para provider: ${config.provider}`)
  }

  const credentials = JSON.parse(decrypt(config.credentials))
  const adapter = new AdapterClass(credentials, config)
  return { adapter, config }
}

/**
 * Returns adapter for a specific provider (used by webhook routes).
 */
export async function getGatewayByProvider(provider) {
  const config = await prisma.saasGatewayConfig.findFirst({
    where: { provider, isActive: true },
  })
  if (!config) return null

  const AdapterClass = adapters[provider.toUpperCase()]
  if (!AdapterClass) return null

  const credentials = JSON.parse(decrypt(config.credentials))
  const adapter = new AdapterClass(credentials, config)
  return { adapter, config }
}

/**
 * Get billing mode for a given type (plan, module, credits).
 */
export function getBillingMode(config, type) {
  const modes = typeof config.billingMode === 'string'
    ? JSON.parse(config.billingMode)
    : config.billingMode
  return modes[type] || 'MANUAL'
}
