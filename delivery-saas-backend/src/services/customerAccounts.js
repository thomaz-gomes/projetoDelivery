import { prisma } from '../prisma.js'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { pickConnectedChannel } from './whatsapp/pickChannel.js'

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

// 8-char alphanumeric, excluding confusable glyphs (0/O, 1/I/l/L) so the
// customer can re-type without guessing. L (capital) is also excluded
// because in most sans-serif fonts it looks identical to 1 / l.
const PWD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
export function generateAccountPassword(){
  return Array.from(crypto.randomBytes(8)).map(b => PWD_ALPHABET[b % PWD_ALPHABET.length]).join('')
}

// Pick a connected WhatsApp channel for the given company (Evolution
// preferred, Meta Cloud as fallback) and use it to deliver a plaintext
// password to the customer. Used by forgot-password and by manual customer
// creation when the operator opts in to notify the new account holder.
//
// Channel resolution is delegated to pickConnectedChannel() which mirrors
// the customer's last WhatsApp conversation when available — same brand,
// same cardápio. The legacy `lastConversation` argument is accepted for
// backward compatibility but no longer used (the helper queries the
// Conversation table directly from customerId).
//
// Returns one of:
//   { status: 'sent', provider: 'EVOLUTION_WA' | 'META_WA' }
//   { status: 'no-channel' }   — company has no connected WhatsApp at all
//   { status: 'failed', error } — channel exists but the send threw
export async function sendCustomerPasswordViaWhatsApp({ companyId, customer, plainPassword, lastConversation = null, reason = 'created' }){
  if (!companyId || !customer?.whatsapp || !plainPassword) return { status: 'failed', error: 'missing-args' }

  const channel = await pickConnectedChannel({ companyId, customerId: customer.id || null })
  if (!channel) return { status: 'no-channel' }

  const { normalizePhone, evoSendText } = await import('../wa.js')
  const to = normalizePhone(customer.whatsapp)
  const firstName = (customer.fullName || '').split(/\s+/)[0] || ''
  const greeting = firstName ? `Olá, ${firstName}!` : 'Olá!'
  // Important: leave the password on its own line with no surrounding
  // markdown (asterisks, backticks) — when the customer long-presses to
  // copy on WhatsApp, those decorators come along with the text and break
  // the subsequent login. Double-tap on the bare line selects just the
  // password.
  const intro = reason === 'reset'
    ? 'Você pediu para lembrar sua senha. Geramos uma nova:'
    : 'Sua conta foi criada. Use a senha abaixo para entrar e troque-a depois nas configurações da sua conta:'
  const text = `${greeting} 🔐\n\n${intro}\n\nSenha:\n${plainPassword}\n\nSe não foi você quem solicitou, ignore esta mensagem.`

  try {
    if (channel.type === 'EVOLUTION_WA') {
      await evoSendText({ instanceName: channel.instanceName, to, text })
      return { status: 'sent', provider: 'EVOLUTION_WA' }
    }
    const adapter = (await import('../messaging/adapters/whatsappMeta.adapter.js')).default
    await adapter.sendMessage(channel.account, to, { type: 'TEXT', text })
    return { status: 'sent', provider: 'META_WA' }
  } catch (e) {
    console.error('[sendCustomerPasswordViaWhatsApp] send failed', e?.response?.data || e?.message || e)
    return { status: 'failed', error: e?.message || 'send-error' }
  }
}
