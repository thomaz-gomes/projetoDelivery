#!/usr/bin/env node
import { prisma } from '../src/prisma.js'
import fs from 'fs'
import path from 'path'

// Usage: node scripts/migrate-base64-images.js [--baseUrl=http://localhost:3000]
const arg = process.argv.slice(2).find(a => a.startsWith('--baseUrl='))
const baseUrl = arg ? arg.split('=')[1] : (process.env.BACKEND_URL || 'http://localhost:3000')

async function run(){
  console.log('Migration start, baseUrl=', baseUrl)
  const products = await prisma.product.findMany()
  let migrated = 0
  for(const p of products){
    const img = p.image
    if(!img) continue
    try{
      if(img.startsWith('data:')){
        console.log('Migrating base64 for product', p.id)
        const matches = img.match(/^data:(image\/[^;]+);base64,(.+)$/)
        let ext = 'jpg'
        let data = img
        if(matches){
          const mime = matches[1]
          data = matches[2]
          ext = (mime.split('/')[1] || 'jpg').toLowerCase()
          if(ext === 'jpeg') ext = 'jpg'
          if(ext.includes('+')) ext = ext.split('+')[0]
        }
        const buffer = Buffer.from(data, 'base64')
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'products')
        await fs.promises.mkdir(uploadsDir, { recursive: true })
        const outName = `${p.id}.${ext}`
        const outPath = path.join(uploadsDir, outName)
        await fs.promises.writeFile(outPath, buffer)
        const publicUrl = `${baseUrl}/public/uploads/products/${outName}`
        await prisma.product.update({ where: { id: p.id }, data: { image: publicUrl } })
        migrated++
      } else if(img.startsWith('/public/uploads/products/')){
        // convert relative to absolute
        const filename = img.split('/').pop()
        const publicUrl = `${baseUrl}/public/uploads/products/${filename}`
        await prisma.product.update({ where: { id: p.id }, data: { image: publicUrl } })
        migrated++
      }
    }catch(e){
      console.error('Failed migrating product', p.id, e)
    }
  }
  console.log('Migration finished. migrated=', migrated)
  process.exit(0)
}

run().catch(e=>{console.error(e); process.exit(1)})
