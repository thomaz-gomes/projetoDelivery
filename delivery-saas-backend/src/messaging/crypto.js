// Thin wrapper around utils/secretStore for the messaging module.
// Provides domain-scoped names (encrypt/decrypt) so messaging code does not
// reach into utils/ directly. If token storage ever needs different semantics
// (key rotation, per-tenant keys), change this file in one place.

import { encryptText, decryptText } from '../utils/secretStore.js'

export const encrypt = encryptText
export const decrypt = decryptText

export default { encrypt, decrypt }
