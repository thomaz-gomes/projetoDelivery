#!/usr/bin/env node
import bcrypt from 'bcryptjs'
import { prisma } from '../src/prisma.js'

function normalize(raw){
  return String(raw||'').replace(/\D/g,'')
}

async function main(){
  const args = process.argv.slice(2)
  if(args.length < 2){
    console.error('Usage: node set_password_by_whatsapp.mjs <whatsappDigits> <newPassword>')
    process.exit(1)
  }
  const raw = args[0]
  const newPass = args[1]
  const digits = normalize(raw)
  if(!digits){
    console.error('Invalid whatsapp digits')
    process.exit(1)
  }

  console.log('Searching for records matching digits:', digits)

  // find riders matching the digits and collect linked user ids
  const riderCandidates = await prisma.rider.findMany({ where: { OR: [ { whatsapp: digits }, { whatsapp: { endsWith: digits } }, { whatsapp: '55' + digits }, { whatsapp: { contains: digits } } ] } })

  const userIds = new Set()
  for(const r of riderCandidates){ if(r.userId) userIds.add(r.userId) }

  const hashed = await bcrypt.hash(String(newPass), 10)

  if(userIds.size === 0){
    console.log('No user records found matching phone. Will attempt Customer / Affiliate / CustomerAccount matches.')
  }

  for(const uid of Array.from(userIds)){
    try{
      await prisma.user.update({ where: { id: uid }, data: { password: hashed } })
      console.log('Updated user password for id', uid)
    }catch(e){
      console.error('Failed updating user', uid, e?.message || e)
    }
  }

  // Affiliates
  const affiliates = await prisma.affiliate.findMany({ where: { whatsapp: { contains: digits } } })
  for(const a of affiliates){
    try{
      await prisma.affiliate.update({ where: { id: a.id }, data: { password: hashed } })
      console.log('Updated affiliate password for id', a.id)
    }catch(e){ console.error('Failed updating affiliate', a.id, e?.message || e) }
  }

  // Customers -> CustomerAccount
  const customers = await prisma.customer.findMany({ where: { OR: [ { whatsapp: digits }, { whatsapp: { endsWith: digits } }, { whatsapp: '55' + digits }, { whatsapp: { contains: digits } } ] } })
  for(const c of customers){
    try{
      const accounts = await prisma.customerAccount.findMany({ where: { customerId: c.id } })
      for(const acc of accounts){
        try{
          await prisma.customerAccount.update({ where: { id: acc.id }, data: { password: hashed } })
          console.log('Updated customerAccount password for account id', acc.id, 'customer', c.id)
        }catch(e){ console.error('Failed updating customerAccount', acc.id, e?.message || e) }
      }
    }catch(e){ console.error('Failed processing customer', c.id, e?.message || e) }
  }

  console.log('Done.');
  process.exit(0)
}

main().catch(e=>{ console.error(e); process.exit(1) })
