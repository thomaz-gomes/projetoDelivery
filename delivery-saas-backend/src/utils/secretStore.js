import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
// Expect a base64 or hex key in env CERT_STORE_KEY; prefer 32 bytes (256 bits)
function getKey() {
  const raw = process.env.CERT_STORE_KEY
  if (!raw) throw new Error('CERT_STORE_KEY env var is required for certificate password encryption')
  // try base64 decode, fallback to hex/raw
  let key
  try { key = Buffer.from(raw, 'base64') } catch (e) { key = Buffer.from(raw, 'utf8') }
  if (key.length < 32) throw new Error('CERT_STORE_KEY must decode to at least 32 bytes')
  return key.slice(0, 32)
}

export function encryptText(plain) {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // store as base64: iv:tag:cipher
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptText(encText) {
  const key = getKey()
  if (!encText) return null
  const parts = String(encText).split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted text format')
  const iv = Buffer.from(parts[0], 'base64')
  const tag = Buffer.from(parts[1], 'base64')
  const ct = Buffer.from(parts[2], 'base64')
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(ct), decipher.final()])
  return dec.toString('utf8')
}

export default { encryptText, decryptText }
