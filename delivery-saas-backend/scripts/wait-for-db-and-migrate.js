#!/usr/bin/env node
import 'dotenv/config'
import ensureDatabaseUrl from '../src/configureDatabaseEnv.js'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'

// construct DATABASE_URL from parts if needed before creating PrismaClient
ensureDatabaseUrl()
const prisma = new PrismaClient()

async function waitForDb(retries = 120, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`
      console.log('Database reachable')
      return true
    } catch (err) {
      const attempt = i + 1
      console.log(`Database not ready, retrying (${attempt}/${retries})... - ${err && err.message ? err.message : ''}`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  return false
}

;(async () => {
  try {
    const ok = await waitForDb()
    if (!ok) {
      console.error('Database did not become ready in time')
      process.exit(1)
    }

    console.log('Running prisma db push...')
    execSync('npx prisma db push --skip-generate', { stdio: 'inherit', env: process.env })

    console.log('Running module seeds...')
    try {
      execSync('node src/seeds/seedModules.js', { stdio: 'inherit', env: process.env })
    } catch (seedErr) {
      console.warn('Module seed warning (non-fatal):', seedErr && seedErr.message)
    }

    console.log('Database schema synced successfully')

    // Register Evolution API webhooks on all existing WhatsApp instances
    const EVOLUTION_BASE = process.env.EVOLUTION_API_BASE_URL
    const EVOLUTION_KEY = process.env.EVOLUTION_API_API_KEY
    const BACKEND_URL = process.env.BACKEND_URL || process.env.BASE_URL || ''
    if (EVOLUTION_BASE && EVOLUTION_KEY && BACKEND_URL) {
      console.log('Registering Evolution webhooks...')
      const instances = await prisma.whatsAppInstance.findMany()
      for (const inst of instances) {
        try {
          const res = await fetch(`${EVOLUTION_BASE}/webhook/set/${encodeURIComponent(inst.instanceName)}`, {
            method: 'PUT',
            headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: `${BACKEND_URL}/webhook/evolution`,
              webhook_by_events: true,
              events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
            }),
          })
          console.log(`  ${res.ok ? '✅' : '❌'} ${inst.instanceName}`)
        } catch (e) {
          console.warn(`  ❌ ${inst.instanceName}: ${e.message}`)
        }
      }
    } else {
      console.log('Skipping Evolution webhook registration (missing EVOLUTION_API_BASE_URL, EVOLUTION_API_API_KEY, or BACKEND_URL)')
    }

    await prisma.$disconnect()
    process.exit(0)
  } catch (err) {
    console.error('Migration script failed:', err)
    try {
      await prisma.$disconnect()
    } catch (_) {}
    process.exit(1)
  }
})()
