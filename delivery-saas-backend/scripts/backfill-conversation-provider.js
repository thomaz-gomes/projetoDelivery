#!/usr/bin/env node
// Backfill Conversation.provider and Conversation.providerAccountId for legacy
// WhatsApp conversations created before the Meta messaging integration.
//
// Resolution order (per conversation):
//   1. conv.menu.whatsappInstanceId  -> EVOLUTION_WA + that instance id
//   2. WhatsAppInstance lookup by (companyId, instanceName) when no menu
//
// Idempotent: only touches rows where provider IS NULL.
//
// Usage:
//   node scripts/backfill-conversation-provider.js [--dry-run]

import { prisma } from '../src/prisma.js'

const DRY_RUN = process.argv.includes('--dry-run')

async function resolveAccountId(conv, instanceCache) {
  // Primary: menu.whatsappInstanceId
  const fromMenu = conv.menu?.whatsappInstanceId
  if (fromMenu) return { id: fromMenu, source: 'menu' }

  // Fallback: lookup WhatsAppInstance by (companyId, instanceName)
  if (!conv.instanceName) return null
  const cacheKey = `${conv.companyId}::${conv.instanceName}`
  if (instanceCache.has(cacheKey)) {
    const cached = instanceCache.get(cacheKey)
    return cached ? { id: cached, source: 'instanceName' } : null
  }
  const inst = await prisma.whatsAppInstance.findFirst({
    where: { companyId: conv.companyId, instanceName: conv.instanceName },
    select: { id: true },
  })
  instanceCache.set(cacheKey, inst?.id || null)
  return inst ? { id: inst.id, source: 'instanceName' } : null
}

async function main() {
  if (DRY_RUN) console.log('[dry-run] No writes will be performed.')

  const orphans = await prisma.conversation.findMany({
    where: { provider: null },
    select: {
      id: true,
      companyId: true,
      channel: true,
      instanceName: true,
      menu: { select: { whatsappInstanceId: true } },
    },
  })

  console.log(`Found ${orphans.length} conversations without provider`)

  const total = orphans.length
  let skippedNonWa = 0
  let skippedNoInstance = 0
  // Map<instanceId, string[]> — conversations to update per instance
  const groups = new Map()
  const instanceCache = new Map()
  // Track resolution source counts for reporting
  let resolvedFromMenu = 0
  let resolvedFromInstanceName = 0

  for (const conv of orphans) {
    if (conv.channel !== 'WHATSAPP') {
      skippedNonWa++
      continue
    }
    const resolved = await resolveAccountId(conv, instanceCache)
    if (!resolved) {
      skippedNoInstance++
      continue
    }
    if (resolved.source === 'menu') resolvedFromMenu++
    else resolvedFromInstanceName++
    if (!groups.has(resolved.id)) groups.set(resolved.id, [])
    groups.get(resolved.id).push(conv.id)
  }

  const willUpdate = Array.from(groups.values()).reduce((acc, ids) => acc + ids.length, 0)

  console.log('')
  console.log('Resolution summary:')
  console.log(`  resolved via menu.whatsappInstanceId:   ${resolvedFromMenu}`)
  console.log(`  resolved via instanceName fallback:     ${resolvedFromInstanceName}`)
  console.log(`  skipped (channel != WHATSAPP):          ${skippedNonWa}`)
  console.log(`  skipped (no menu/instance match):       ${skippedNoInstance}`)
  console.log(`  groups (distinct providerAccountId):    ${groups.size}`)
  console.log(`  will update:                            ${willUpdate}`)
  console.log(`  total processed:                        ${total}`)

  if (DRY_RUN) {
    console.log('\n[dry-run] No rows were updated. Re-run without --dry-run to apply.')
    await prisma.$disconnect()
    return
  }

  let updated = 0
  for (const [instanceId, ids] of groups.entries()) {
    const res = await prisma.conversation.updateMany({
      where: { id: { in: ids }, provider: null },
      data: { provider: 'EVOLUTION_WA', providerAccountId: instanceId },
    })
    updated += res.count
  }

  console.log('')
  console.log(`Updated ${updated} conversations`)
  console.log(`Skipped ${skippedNonWa + skippedNoInstance} (non-WA: ${skippedNonWa}, no instance: ${skippedNoInstance})`)
  console.log(`Total processed ${total}`)

  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
