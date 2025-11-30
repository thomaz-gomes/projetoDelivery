#!/usr/bin/env node
import { PrismaClient } from '@prisma/client'
import process from 'process'

const prisma = new PrismaClient()

function usage() {
  console.log('Usage: node tmp/update_printer_interface.mjs --printerName="Print iD" [--companyId=<id>] [--storeId=<id>]')
  console.log('If --storeId is provided the script will resolve the companyId from the store.')
}

async function main() {
  const argv = process.argv.slice(2)
  const args = {}
  argv.forEach(a => {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (m) args[m[1]] = m[2]
  })

  const printerName = args.printerName || args.printername || args.printer || null
  const companyId = args.companyId || args.companyid || null
  const storeId = args.storeId || args.storeid || null

  if (!printerName) {
    usage()
    process.exit(2)
  }

  try {
    let cid = companyId
    if (!cid && storeId) {
      const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, companyId: true } })
      if (!store) {
        console.error('Store not found:', storeId)
        process.exit(3)
      }
      cid = store.companyId
    }

    if (!cid) {
      console.error('companyId not provided and could not be resolved from storeId. Provide --companyId or --storeId')
      process.exit(4)
    }

    // sanitize printerName: remove leading 'printer:' prefix if present
    const sanitized = String(printerName).replace(/^\s*printer:\s*/i, '').trim()

    // check existing setting
    const existing = await prisma.printerSetting.findUnique({ where: { companyId: cid } })
    if (existing) {
      const updated = await prisma.printerSetting.update({ where: { companyId: cid }, data: { interface: sanitized } })
      console.log('Updated printerSetting for company', cid, 'interface ->', sanitized)
      console.log(updated)
    } else {
      const created = await prisma.printerSetting.create({ data: { companyId: cid, interface: sanitized } })
      console.log('Created printerSetting for company', cid, 'interface ->', sanitized)
      console.log(created)
    }

  } catch (e) {
    console.error('Error updating printerSetting:', e && e.message ? e.message : e)
    process.exit(10)
  } finally {
    await prisma.$disconnect()
  }
}

main()
.catch(e => { console.error(e); process.exit(1) })
