import crypto from 'crypto'
import { prisma } from '../prisma.js'

const ALGORITHM = 'aes-256-gcm'
const DB_KEY_NAME = 'payment_encrypt_key'

/** In-memory cache — populated by initEncryptionKey() at startup */
let _cachedKey = null

/**
 * Initialize the encryption key. Called once at server startup.
 * Priority: env var → SystemSetting in DB → auto-generate and save to DB.
 */
export async function initEncryptionKey() {
  // 1. Check env var
  const envHex = process.env.PAYMENT_ENCRYPT_KEY || ''
  if (envHex && envHex.length >= 64) {
    _cachedKey = Buffer.from(envHex, 'hex')
    console.log('🔑 PAYMENT_ENCRYPT_KEY loaded from environment variable')
    return
  }

  // 2. Check SystemSetting in DB
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: DB_KEY_NAME } })
    if (row?.value && row.value.length >= 64) {
      _cachedKey = Buffer.from(row.value, 'hex')
      console.log('🔑 PAYMENT_ENCRYPT_KEY loaded from SystemSetting (database)')
      return
    }
  } catch (e) {
    // Table might not exist yet during migrations — fall through
    console.warn('⚠️  Could not read SystemSetting for encryption key:', e?.message)
  }

  // 3. Auto-generate and persist to DB
  const newHex = crypto.randomBytes(32).toString('hex')
  try {
    await prisma.systemSetting.upsert({
      where: { key: DB_KEY_NAME },
      update: { value: newHex },
      create: { key: DB_KEY_NAME, value: newHex },
    })
    console.log('🔑 PAYMENT_ENCRYPT_KEY auto-generated and saved to SystemSetting')
  } catch (e) {
    console.warn('⚠️  Could not persist encryption key to DB:', e?.message)
    console.log('   Using in-memory key (will be lost on restart)')
  }
  _cachedKey = Buffer.from(newHex, 'hex')
}

function getKey() {
  if (!_cachedKey) {
    throw new Error(
      'Encryption key not initialized. Call initEncryptionKey() at startup before using encrypt/decrypt.'
    )
  }
  return _cachedKey
}

export function encrypt(plaintext) {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${tag}:${encrypted}`
}

export function decrypt(stored) {
  const key = getKey()
  const [ivHex, tagHex, ciphertext] = stored.split(':')
  if (!ivHex || !tagHex || !ciphertext) {
    throw new Error('Invalid encrypted format')
  }
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
