#!/usr/bin/env node
import { prisma } from '../../src/prisma.js'

function normalizeSlug(v){
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function main(){
  console.log('Generating slugs for companies and stores (best-effort)')
  // Companies
  const companies = await prisma.company.findMany({ select: { id: true, name: true, slug: true } })
  let updatedCompanies = 0
  for(const c of companies){
    if(c.slug && String(c.slug || '').trim()) continue
    let base = normalizeSlug(c.name || c.id)
    let candidate = base
    let suffix = 1
    // ensure uniqueness across companies
    while (true) {
      const exists = await prisma.company.findFirst({ where: { slug: candidate }, select: { id: true } })
      if (!exists) break
      candidate = `${base}-${suffix++}`
    }
    try{
      await prisma.company.update({ where: { id: c.id }, data: { slug: candidate } })
      updatedCompanies++
      console.log('Company', c.id, '->', candidate)
    }catch(e){
      console.warn('Failed to update company slug for', c.id, e.message || e)
    }
  }

  // Stores
  const stores = await prisma.store.findMany({ select: { id: true, name: true, slug: true, companyId: true } })
  let updatedStores = 0
  for(const st of stores){
    if(st.slug && String(st.slug || '').trim()) continue
    let base = normalizeSlug(st.name || st.id)
    let candidate = base
    let suffix = 1
    // ensure uniqueness across stores
    while (true) {
      const exists = await prisma.store.findFirst({ where: { slug: candidate }, select: { id: true } })
      if (!exists) break
      candidate = `${base}-${suffix++}`
    }
    try{
      await prisma.store.update({ where: { id: st.id }, data: { slug: candidate } })
      updatedStores++
      console.log('Store', st.id, '->', candidate)
    }catch(e){
      console.warn('Failed to update store slug for', st.id, e.message || e)
    }
  }

  console.log(`Done. Companies updated: ${updatedCompanies}, Stores updated: ${updatedStores}`)
}

main().then(()=>process.exit(0)).catch(e=>{ console.error('Fatal', e); process.exit(1) })
