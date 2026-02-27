import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/prisma.js'

async function main() {
  // Support both SUPER_ADMIN_* and SUPERADMIN_* env names
  const email = process.env.SUPER_ADMIN_EMAIL || process.env.SUPERADMIN_EMAIL || 'superadmin@saas.local'
  const password = process.env.SUPER_ADMIN_PASSWORD || process.env.SUPERADMIN_PASSWORD || 'admin123'
  const name = process.env.SUPER_ADMIN_NAME || process.env.SUPERADMIN_NAME || 'Super Admin'

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'SUPER_ADMIN', name, emailVerified: true } })
    console.log('Updated SUPER_ADMIN user:', email)
  } else {
    const hash = await bcrypt.hash(String(password), 10)
    await prisma.user.create({ data: { name, email, password: hash, role: 'SUPER_ADMIN', emailVerified: true } })
    console.log('Created SUPER_ADMIN:', email)
  }

  console.log('Login credentials ->', email, '/', password)
}

main()
  .then(async () => { try { await prisma.$disconnect() } catch (_) {} process.exit(0) })
  .catch(async (e) => { console.error('seed_super_admin failed:', e?.message || e); try { await prisma.$disconnect() } catch (_) {} process.exit(1) })
