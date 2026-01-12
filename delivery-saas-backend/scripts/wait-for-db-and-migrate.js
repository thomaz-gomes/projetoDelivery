#!/usr/bin/env node
import 'dotenv/config'
import ensureDatabaseUrl from '../src/configureDatabaseEnv.js'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// construct DATABASE_URL from parts if needed before creating PrismaClient
ensureDatabaseUrl()
const prisma = new PrismaClient()

async function waitForDb(retries = 120, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      // simple query to test connection
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

(async () => {
  try {
    const ok = await waitForDb()
    if (!ok) {
      console.error('Database did not become ready in time')
      process.exit(1)
    }

    // If migrations were generated for a different provider (e.g. sqlite)
    // and we switched to Postgres, Prisma will refuse to deploy. For
    // local/dev/testing we detect that situation and remove the old
    // migration history so we can create a new one against Postgres.
    // Prisma sometimes keeps migration_lock.toml inside prisma/migrations
    const lockFileCandidates = [
      path.join(process.cwd(), 'prisma', 'migration_lock.toml'),
      path.join(process.cwd(), 'prisma', 'migrations', 'migration_lock.toml'),
      path.join(process.cwd(), 'prisma', 'migrations', 'migration-lock.toml')
    ]
    let lockFile = null
    for (const candidate of lockFileCandidates) {
      if (fs.existsSync(candidate)) {
        lockFile = candidate
        break
      }
    }
    if (lockFile) {
      try {
        const lock = fs.readFileSync(lockFile, 'utf8')
        const providerMatch = lock.match(/provider\s*=\s*"([^"]+)"/)
        if (providerMatch && providerMatch[1] !== 'postgresql') {
          console.log(`Detected migration_lock provider=${providerMatch[1]} != postgresql. Removing old migrations and lock file for fresh migration.`)
          const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations')
          if (fs.existsSync(migrationsDir)) {
            fs.rmSync(migrationsDir, { recursive: true, force: true })
            console.log('Removed prisma/migrations directory')
          }
          fs.rmSync(lockFile, { force: true })
          console.log('Removed prisma migration lock file:', lockFile)
        }
      } catch (err) {
        console.warn('Could not inspect migration_lock.toml:', err && err.message)
      }
    }

  // Choose Prisma schema file depending on database type.
  // Use `prisma/schema.postgres.prisma` when running against Postgres (DB_* envs present
  // or DATABASE_URL indicates Postgres), otherwise default to schema.prisma (sqlite).
  const dbUrl = (process.env.DATABASE_URL || '').toString().trim()

  // Robust detection: try parsing the URL to detect the protocol, fall back to string checks
  let isPostgres = false
  try {
    if (dbUrl) {
      const u = new URL(dbUrl)
      const proto = (u.protocol || '').toString().replace(':', '').toLowerCase()
      if (proto.startsWith('postgres')) isPostgres = true
    }
  } catch (e) {
    // ignore parse errors and fall back
  }
  if (!isPostgres) {
    isPostgres = dbUrl.toLowerCase().startsWith('postgres') || dbUrl.toLowerCase().startsWith('postgresql') || !!(process.env.DB_HOST || process.env.POSTGRES_HOST || process.env.PGHOST)
  }

  const schemaArg = isPostgres ? '--schema=prisma/schema.postgres.prisma' : ''
  console.log('Using schema arg for Prisma:', schemaArg || '<default prisma/schema.prisma>')

  console.log('Running prisma generate...', schemaArg)
  execSync((`npx prisma generate ${schemaArg}`).trim(), { stdio: 'inherit', env: process.env })

  console.log('Running prisma migrate deploy...', schemaArg)
  execSync((`npx prisma migrate deploy ${schemaArg}`).trim(), { stdio: 'inherit', env: process.env })

    console.log('Migrations applied successfully')
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
