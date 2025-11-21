import { prisma } from '../src/prisma.js'

async function run() {
  const code = process.argv[2] || 'CUPOM11'
  const companyId = process.argv[3] || undefined
  try {
    const where = companyId ? { code, companyId } : { code }
    // find all coupons with this code (raw SQL helpful if duplicates differ in case)
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "Coupon" WHERE lower("code") = lower($1)`, code)
    console.log('Found coupons with code:', code)
    for (const r of rows) {
      console.log({ id: r.id, code: r.code, value: r.value, isPercentage: r.isPercentage, isActive: r.isActive, companyId: r.companyId, updatedAt: r.updatedAt })
    }
  } catch (e) {
    console.error('Error', e)
  } finally {
    await prisma.$disconnect()
  }
}

run()
