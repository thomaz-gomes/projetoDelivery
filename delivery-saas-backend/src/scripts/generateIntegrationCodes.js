/**
 * One-time script to generate integrationCode for existing Products and Options
 * that don't have one yet.
 *
 * Usage: node --experimental-specifier-resolution=node src/scripts/generateIntegrationCodes.js
 * Or via: npm run generate-integration-codes
 */
import 'dotenv/config'
import ensureDatabaseUrl from '../configureDatabaseEnv.js'
ensureDatabaseUrl()

import pkg from '@prisma/client'
const { PrismaClient } = pkg
const prisma = new PrismaClient()

import crypto from 'crypto'

function randomAlphaNum(len = 4) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = crypto.randomBytes(len)
  let result = ''
  for (let i = 0; i < len; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}

async function generateForProducts() {
  const products = await prisma.product.findMany({
    where: { integrationCode: null },
    select: { id: true, companyId: true }
  })
  console.log(`Found ${products.length} products without integrationCode`)

  const usedByCompany = {}
  for (const p of products) {
    if (!usedByCompany[p.companyId]) {
      const existing = await prisma.product.findMany({
        where: { companyId: p.companyId, integrationCode: { not: null } },
        select: { integrationCode: true }
      })
      usedByCompany[p.companyId] = new Set(existing.map(e => e.integrationCode))
    }
    let code
    do {
      code = `P-${randomAlphaNum(4)}`
    } while (usedByCompany[p.companyId].has(code))
    usedByCompany[p.companyId].add(code)

    await prisma.product.update({ where: { id: p.id }, data: { integrationCode: code } })
  }
  console.log(`Updated ${products.length} products`)
}

async function generateForOptions() {
  const options = await prisma.option.findMany({
    where: { integrationCode: null },
    select: { id: true, group: { select: { companyId: true } } }
  })
  console.log(`Found ${options.length} options without integrationCode`)

  const usedByCompany = {}
  for (const o of options) {
    const companyId = o.group.companyId
    if (!usedByCompany[companyId]) {
      const existing = await prisma.option.findMany({
        where: { integrationCode: { not: null }, group: { companyId } },
        select: { integrationCode: true }
      })
      usedByCompany[companyId] = new Set(existing.map(e => e.integrationCode))
    }
    let code
    do {
      code = `O-${randomAlphaNum(4)}`
    } while (usedByCompany[companyId].has(code))
    usedByCompany[companyId].add(code)

    await prisma.option.update({ where: { id: o.id }, data: { integrationCode: code } })
  }
  console.log(`Updated ${options.length} options`)
}

async function main() {
  console.log('Generating integration codes for existing records...')
  await generateForProducts()
  await generateForOptions()
  console.log('Done!')
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
