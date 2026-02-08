#!/usr/bin/env node
// Safe merge script: finds customers matching a phone, proposes merge actions and
// optionally applies them (--apply). Default is dry-run.
// Usage:
//  node scripts/merge-customers-by-phone.mjs --phone 73991429676
//  node scripts/merge-customers-by-phone.mjs --phone 73991429676 --apply --delete-source

import path from 'path'
import { pathToFileURL } from 'url'
const prismaPath = path.join(process.cwd(), 'src', 'prisma.js')
const prismaMod = await import(pathToFileURL(prismaPath).href)
const { prisma } = prismaMod

function normalizeDigits(n){ return String(n||'').replace(/\D+/g,'') }

function parseArgs(){
  const args = process.argv.slice(2)
  const out = { phone: null, apply: false, deleteSource: false }
  for (let i=0;i<args.length;i++){
    const a = args[i]
    if (a === '--phone' && args[i+1]){ out.phone = args[i+1]; i++ }
    else if (a === '--apply') out.apply = true
    else if (a === '--delete-source') out.deleteSource = true
    else if (a === '--help' || a === '-h'){ console.log('Usage: --phone <digits> [--apply] [--delete-source]'); process.exit(0) }
  }
  return out
}

async function main(){
  const { phone, apply, deleteSource } = parseArgs()
  if (!phone){ console.error('Missing --phone argument'); process.exit(2) }
  const digits = normalizeDigits(phone)
  if (!digits) { console.error('Phone seems empty after normalization'); process.exit(2) }

  console.log('Finding customers matching:', digits)
  const customers = await prisma.customer.findMany({ where: { OR: [ { whatsapp: { contains: digits } }, { phone: { contains: digits } } ] }, include: { addresses: true } })
  if (!customers || customers.length < 2){
    console.log('Found', (customers||[]).length, 'customer(s) — nothing to merge.');
    console.dir(customers, { depth: 2 })
    process.exit(0)
  }

  console.log('Candidates:')
  customers.forEach(c => console.log(`- id=${c.id} created=${c.createdAt.toISOString()} whatsapp=${c.whatsapp} phone=${c.phone} addresses=${(c.addresses||[]).length}`))

  // choose target: prefer customer with most addresses, tie-breaker earliest created
  customers.sort((a,b)=>{ const ad = (b.addresses||[]).length - (a.addresses||[]).length; if (ad!==0) return ad; return new Date(a.createdAt) - new Date(b.createdAt) })
  const target = customers[0]
  const sources = customers.slice(1)
  console.log('\nSelected target customer id:', target.id)
  console.log('Will merge sources:', sources.map(s=>s.id).join(', '))

  // list orders and accounts affected (dry run)
  const srcIds = sources.map(s=>s.id)
  const affectedOrders = await prisma.order.findMany({ where: { customerId: { in: srcIds } }, select: { id: true, displayId: true, createdAt: true } })
  const affectedAccounts = await prisma.customerAccount.findMany({ where: { customerId: { in: srcIds } }, select: { id: true, email: true } })

  console.log('\nAffected orders:', affectedOrders.length)
  affectedOrders.forEach(o=>console.log(`  - ${o.id} (${o.displayId})`))
  console.log('Affected customer accounts:', affectedAccounts.length)
  affectedAccounts.forEach(a=>console.log(`  - ${a.id} ${a.email || ''}`))

  // addresses to copy (avoid duplicates by formatted or street+number+postalCode)
  const addressesToCreate = []
  for (const s of sources){
    for (const addr of s.addresses || []){
      // check if target already has matching address
      const exists = (target.addresses || []).some(t => {
        if (t.formatted && addr.formatted && t.formatted === addr.formatted) return true
        if (t.postalCode && addr.postalCode && t.postalCode === addr.postalCode && t.number && addr.number && t.street && addr.street && t.street === addr.street && t.number === addr.number) return true
        return false
      })
      if (!exists){ addressesToCreate.push({ sourceCustomerId: s.id, addr }) }
    }
  }

  console.log('\nAddresses to copy to target:', addressesToCreate.length)
  addressesToCreate.forEach(a=>console.log(`  - from ${a.sourceCustomerId}: ${a.addr.formatted || (a.addr.street+' '+a.addr.number)}`))

  if (!apply){
    console.log('\nDRY RUN complete. To apply changes re-run with --apply. No data was modified.')
    process.exit(0)
  }

  console.log('\nApplying changes...')
  // wrap in transaction
  await prisma.$transaction(async (tx) => {
    // copy addresses
    for (const item of addressesToCreate){
      const a = item.addr
      await tx.customerAddress.create({ data: {
        customerId: target.id,
        label: a.label || null,
        street: a.street || null,
        number: a.number || null,
        complement: a.complement || null,
        neighborhood: a.neighborhood || null,
        city: a.city || null,
        state: a.state || null,
        postalCode: a.postalCode || null,
        formatted: a.formatted || null,
        latitude: a.latitude ?? null,
        longitude: a.longitude ?? null,
        isDefault: false,
      } })
    }

    // reassign orders
    if (affectedOrders.length) await tx.order.updateMany({ where: { customerId: { in: srcIds } }, data: { customerId: target.id } })

    // reassign accounts
    if (affectedAccounts.length) await tx.customerAccount.updateMany({ where: { customerId: { in: srcIds } }, data: { customerId: target.id } })

    if (deleteSource){
      // delete source addresses then customer
      for (const s of sources){
        try { await tx.customerAddress.deleteMany({ where: { customerId: s.id } }) } catch(e){}
        try { await tx.customer.delete({ where: { id: s.id } }) } catch(e){ console.warn('Failed deleting source', s.id, e.message || e) }
      }
    }
  })

  console.log('Merge applied. Summary:')
  console.log(` - Copied ${addressesToCreate.length} addresses to target ${target.id}`)
  console.log(` - Reassigned ${affectedOrders.length} orders and ${affectedAccounts.length} accounts to target ${target.id}`)
  if (deleteSource) console.log(' - Source customer(s) deleted')
}

main().catch(e=>{ console.error('Error', e); process.exit(1) })
