import { prisma } from '../prisma.js'
import bcrypt from 'bcryptjs'

export async function createCustomerAccount({ companyId, customerId, email, password }){
  const hashed = await bcrypt.hash(String(password || ''), 10)
  const data = { companyId, customerId, password: hashed }
  if (email) data.email = String(email).toLowerCase()
  return prisma.customerAccount.create({ data })
}

export async function findAccountByEmail({ companyId, email }){
  if(!email) return null
  return prisma.customerAccount.findFirst({ where: { companyId, email: String(email).toLowerCase() } })
}

// find account by customerId (useful when primary identifier is whatsapp)
export async function findAccountByCustomerId({ companyId, customerId }){
  return prisma.customerAccount.findFirst({ where: { companyId, customerId } })
}

export async function verifyPassword(account, password){
  if(!account) return false
  return bcrypt.compare(String(password || ''), account.password)
}
