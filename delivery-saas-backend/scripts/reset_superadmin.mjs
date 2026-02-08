#!/usr/bin/env node
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// Usage: node scripts/reset_superadmin.mjs NEW_PASSWORD
const password = process.argv[2] || 'admin123'

async function main() {
  const prisma = new PrismaClient()
  try {
    const hash = await bcrypt.hash(password, 10)
    await prisma.user.update({
      where: { email: 'superadmin@saas.local' },
      data: { password: hash }
    })
    console.log('superadmin password reset')
  } catch (err) {
    console.error('reset failed', err && err.message)
    process.exitCode = 2
  } finally {
    await prisma.$disconnect()
  }
}

main()
