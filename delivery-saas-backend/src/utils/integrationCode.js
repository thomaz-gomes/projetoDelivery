import crypto from 'crypto'
import { prisma } from '../prisma.js'

function randomAlphaNum(len = 4) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = crypto.randomBytes(len)
  let result = ''
  for (let i = 0; i < len; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}

export async function generateProductCode(companyId) {
  for (let attempts = 0; attempts < 10; attempts++) {
    const code = `P-${randomAlphaNum(4)}`
    const existing = await prisma.product.findFirst({
      where: { companyId, integrationCode: code }
    })
    if (!existing) return code
  }
  // fallback: longer code
  return `P-${randomAlphaNum(6)}`
}

export async function generateOptionCode(groupId) {
  const group = await prisma.optionGroup.findUnique({ where: { id: groupId } })
  if (!group) return `O-${randomAlphaNum(4)}`
  for (let attempts = 0; attempts < 10; attempts++) {
    const code = `O-${randomAlphaNum(4)}`
    const existing = await prisma.option.findFirst({
      where: { integrationCode: code, group: { companyId: group.companyId } }
    })
    if (!existing) return code
  }
  return `O-${randomAlphaNum(6)}`
}
