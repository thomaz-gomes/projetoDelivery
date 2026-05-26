#!/usr/bin/env node
// Toggle the marketing_v1_enabled feature flag for a company (beta gating).
//
// Usage:
//   node scripts/toggle-marketing-flag.mjs <companyId> <on|off>
//
// Examples:
//   node scripts/toggle-marketing-flag.mjs 303c0aa3-9393-4161-b5f5-6747f3e6b9d8 on
//   node scripts/toggle-marketing-flag.mjs 303c0aa3-9393-4161-b5f5-6747f3e6b9d8 off
//
// Companies with the flag OFF cannot create or view marketing campaigns even
// when the marketing_campaigns SaaS module is enabled — the flag is a kill
// switch independent of module entitlement.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const [, , companyId, mode] = process.argv
  if (!companyId || !['on', 'off'].includes(mode)) {
    console.error('Usage: node scripts/toggle-marketing-flag.mjs <companyId> <on|off>')
    process.exit(1)
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, flags: true },
  })
  if (!company) {
    console.error(`Company ${companyId} not found`)
    process.exit(2)
  }

  const newFlags = { ...(company.flags || {}), marketing_v1_enabled: mode === 'on' }
  await prisma.company.update({ where: { id: companyId }, data: { flags: newFlags } })

  console.log(`✓ ${company.name} (${company.id}): marketing_v1_enabled = ${mode === 'on'}`)
  console.log('Cache TTL is 60s — change propagates within one minute.')
}

main().catch(e => { console.error(e); process.exit(3) }).finally(() => prisma.$disconnect())
