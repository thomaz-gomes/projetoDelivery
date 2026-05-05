'use strict'
/**
 * One-shot: restaura o status de pedidos cuja única razão para estarem em
 * INVOICE_AUTHORIZED foi a emissão da NF-e. Esses pedidos passam a CONCLUIDO,
 * que é o status mais provável antes da emissão.
 *
 * Uso (host):
 *   node prisma/scripts/restore-invoice-authorized-status.js
 *
 * Uso (Docker):
 *   docker compose exec backend node prisma/scripts/restore-invoice-authorized-status.js
 */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const candidates = await prisma.order.findMany({
    where: { status: 'INVOICE_AUTHORIZED' },
    select: { id: true, displaySimple: true, payload: true },
  })

  const withNfe = candidates.filter((o) => o.payload && o.payload.nfe && o.payload.nfe.nProt)
  const withoutNfe = candidates.filter((o) => !(o.payload && o.payload.nfe && o.payload.nfe.nProt))

  console.log(`Encontrados: ${candidates.length} pedidos com status=INVOICE_AUTHORIZED`)
  console.log(`  com payload.nfe.nProt: ${withNfe.length} → migrar para CONCLUIDO`)
  console.log(`  sem payload.nfe.nProt: ${withoutNfe.length} → mantidos (caso atípico, revisar manualmente)`)

  if (withNfe.length === 0) {
    console.log('Nada a fazer.')
    return
  }

  const result = await prisma.order.updateMany({
    where: { id: { in: withNfe.map((o) => o.id) } },
    data: { status: 'CONCLUIDO' },
  })

  console.log(`Atualizados: ${result.count} pedidos para CONCLUIDO.`)
}

main()
  .catch((err) => {
    console.error('Falha na migração:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
