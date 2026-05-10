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

// Resets the account's password to a freshly hashed value. Returns the
// updated account row. Caller is responsible for sending the plain password
// to the customer through a trusted channel (e.g., the WhatsApp instance
// already connected to their company).
export async function resetCustomerAccountPassword({ accountId, plainPassword }){
  const hashed = await bcrypt.hash(String(plainPassword || ''), 10)
  return prisma.customerAccount.update({ where: { id: accountId }, data: { password: hashed } })
}
