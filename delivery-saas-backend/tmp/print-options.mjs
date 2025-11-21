#!/usr/bin/env node
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

;(async ()=>{
  try{
    const company = await prisma.company.findFirst()
    if(!company){ console.error('No company found'); process.exit(1) }
    console.log('Company:', company.id, company.name)
    const groups = await prisma.optionGroup.findMany({ where: { companyId: company.id }, include: { options: true } })
    for(const g of groups){
      console.log(`Group: ${g.id} - ${g.name}`)
      for(const o of g.options){
        console.log('  Option:', o.id, o.name, 'price=', String(o.price))
      }
    }
  }catch(e){ console.error('err', e) }
  finally{ await prisma.$disconnect(); }
})()
