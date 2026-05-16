#!/usr/bin/env node
// Preenche Product.sku para produtos legados que ainda têm NULL no campo.
//
// Gera valores aleatórios de 8 dígitos começando em "1" (range 10000000 a
// 19999999), garantindo unicidade por companyId — duas empresas distintas
// podem ter SKU 12345678 sem problema.
//
// Idempotente: produtos com SKU já preenchido são ignorados.
//
// Uso:
//   node scripts/backfill-product-sku.js            # roda de verdade
//   node scripts/backfill-product-sku.js --dry-run  # só mostra o que faria

import { prisma } from '../src/prisma.js'

function randomSku() {
  // 8 dígitos começando em "1": 10000000 a 19999999
  return String(10000000 + Math.floor(Math.random() * 10000000))
}

async function pickUniqueSku(companyId, taken) {
  // Tenta até 10 vezes antes de desistir — colisão é raríssima em 10M valores
  for (let i = 0; i < 10; i++) {
    const sku = randomSku()
    if (taken.has(sku)) continue
    const clash = await prisma.product.findFirst({
      where: { companyId, sku },
      select: { id: true },
    })
    if (!clash) { taken.add(sku); return sku }
  }
  throw new Error(`Falha gerando SKU único após 10 tentativas para company ${companyId}`)
}

/**
 * Preenche Product.sku para todos os produtos com NULL.
 * Idempotente — registros com SKU já preenchido são ignorados.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false]  Quando true, apenas loga sem persistir.
 * @returns {Promise<{ scanned: number, updated: number }>}
 */
export async function backfillProductSku(opts = {}) {
  const dryRun = !!opts.dryRun
  const missing = await prisma.product.findMany({
    where: { sku: null },
    select: { id: true, companyId: true, name: true },
  })
  if (missing.length === 0) return { scanned: 0, updated: 0 }

  // Pre-cache de SKUs já usados por company para evitar N queries
  const usedByCompany = new Map()
  const companies = [...new Set(missing.map((p) => p.companyId))]
  for (const cid of companies) {
    const existing = await prisma.product.findMany({
      where: { companyId: cid, sku: { not: null } },
      select: { sku: true },
    })
    usedByCompany.set(cid, new Set(existing.map((r) => r.sku).filter(Boolean)))
  }

  let updated = 0
  for (const p of missing) {
    const taken = usedByCompany.get(p.companyId)
    const sku = await pickUniqueSku(p.companyId, taken)
    if (!dryRun) {
      await prisma.product.update({ where: { id: p.id }, data: { sku } })
      updated++
    }
  }
  return { scanned: missing.length, updated }
}

// CLI: `node scripts/backfill-product-sku.js [--dry-run]`
const isCli = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || process.argv[1]?.endsWith('backfill-product-sku.js')
if (isCli) {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[backfill-sku] iniciando${dryRun ? ' (dry-run)' : ''}`)
  backfillProductSku({ dryRun })
    .then((r) => {
      console.log(`[backfill-sku] ${dryRun ? 'simulado' : 'preenchidos'}: ${dryRun ? r.scanned : r.updated} de ${r.scanned}`)
      return prisma.$disconnect()
    })
    .catch((e) => { console.error(e); prisma.$disconnect().finally(() => process.exit(1)) })
}
