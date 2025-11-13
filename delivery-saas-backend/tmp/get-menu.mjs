#!/usr/bin/env node
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

;(async ()=>{
  try{
    const company = await prisma.company.findFirst()
    if(!company){ console.error('No company found'); process.exit(1) }
  const port = process.env.TEST_PORT || 3001
  const url = `https://localhost:${port}/public/${company.id}/menu`
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  console.log('Fetching', url)
  const res = await fetch(url)
    const data = await res.json()
    console.log(JSON.stringify(data, null, 2))
  }catch(e){ console.error('err', e) }
  finally{ await prisma.$disconnect(); }
})()
