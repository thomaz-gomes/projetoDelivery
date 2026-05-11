import { test } from 'node:test'
import assert from 'node:assert/strict'

// secretStore reads CERT_STORE_KEY lazily on each call. Set before import.
process.env.CERT_STORE_KEY = 'a'.repeat(64)

const { encrypt, decrypt } = await import('../src/messaging/crypto.js')

test('encrypts and decrypts roundtrip', () => {
  const plain = 'EAAB...secrettoken...XYZ'
  const enc = encrypt(plain)
  assert.notEqual(enc, plain)
  assert.equal(decrypt(enc), plain)
})

test('produces different ciphertext each call (random IV)', () => {
  const a = encrypt('same')
  const b = encrypt('same')
  assert.notEqual(a, b)
  assert.equal(decrypt(a), 'same')
  assert.equal(decrypt(b), 'same')
})

test('decrypt throws on tampered ciphertext', () => {
  const enc = encrypt('hello')
  // Tamper the last few chars of the ciphertext part
  const tampered = enc.slice(0, -4) + 'XXXX'
  assert.throws(() => decrypt(tampered))
})
