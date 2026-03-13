/**
 * One-time migration: copies the first active MercadoPagoConfig into SaasGatewayConfig.
 * Run: node scripts/migrate-mp-to-gateway.js
 */
import { PrismaClient } from '@prisma/client'
import { decrypt, encrypt } from '../src/services/encryption.js'

const prisma = new PrismaClient()

async function main() {
  const existing = await prisma.saasGatewayConfig.findFirst({ where: { isActive: true } })
  if (existing) {
    console.log('SaasGatewayConfig already exists, skipping migration')
    return
  }

  const mpConfig = await prisma.mercadoPagoConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!mpConfig) {
    console.log('No MercadoPagoConfig found, nothing to migrate')
    return
  }

  // Decrypt the existing accessToken and re-encrypt as JSON
  const accessToken = decrypt(mpConfig.accessToken)
  const credentials = encrypt(JSON.stringify({
    accessToken,
    publicKey: mpConfig.publicKey || '',
  }))

  await prisma.saasGatewayConfig.create({
    data: {
      provider: 'MERCADOPAGO',
      displayName: 'Mercado Pago',
      credentials,
      isActive: true,
      billingMode: { plan: 'MANUAL', module: 'MANUAL', credits: 'MANUAL' },
      platformFee: 2.00,
    },
  })

  console.log('Migrated MercadoPagoConfig to SaasGatewayConfig successfully')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
