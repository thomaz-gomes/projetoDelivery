#!/usr/bin/env node
import { prisma } from '../src/prisma.js'
async function main(){
  const args = process.argv.slice(2)
  if(!args.length) { console.error('Usage: node scripts/enable_cashback.mjs <companyId> [defaultPercent]'); process.exit(1) }
  const companyId = args[0]
  const defaultPercent = args[1] ? Number(args[1]) : 5
  const existing = await prisma.cashbackSetting.findFirst({ where: { companyId } })
  if(existing){
    const updated = await prisma.cashbackSetting.update({ where: { id: existing.id }, data: { enabled: true, defaultPercent: String(defaultPercent) } })
    console.log('updated', updated)
  } else {
    const created = await prisma.cashbackSetting.create({ data: { companyId, enabled: true, defaultPercent: String(defaultPercent) } })
    console.log('created', created)
  }
}
main().catch(e=>{ console.error(e); process.exit(2) })
