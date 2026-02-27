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

    console.log('Database schema synced successfully')
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
