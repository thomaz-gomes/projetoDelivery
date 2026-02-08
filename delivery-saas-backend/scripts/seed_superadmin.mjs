import { prisma } from '../src/prisma.js'
import bcrypt from 'bcryptjs'

async function main() {
  const email = process.env.SUPERADMIN_EMAIL || 'superadmin@saas.local'
  const password = process.env.SUPERADMIN_PASSWORD || 'admin123'
  const name = process.env.SUPERADMIN_NAME || 'Super Admin'

  const hash = await bcrypt.hash(String(password), 10)

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (existing.role !== 'SUPER_ADMIN' || existing.companyId) {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'SUPER_ADMIN', companyId: null, name } })
      console.log('Updated existing user to SUPER_ADMIN:', existing.id)
    } else {
      console.log('SUPER_ADMIN already exists:', existing.id)
    }
    return
  }

  const created = await prisma.user.create({ data: { email, name, role: 'SUPER_ADMIN', password: hash, companyId: null } })
  console.log('Created SUPER_ADMIN:', created.id, email)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(async () => { try { await prisma.$disconnect() } catch(_){} })
