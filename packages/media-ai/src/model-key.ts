/**
 * Reading a provider key that is encrypted at rest.
 *
 * `ModelProfile.apiKey` is AES-256-GCM ciphertext. The API decrypts it
 * transparently through a Prisma client extension, but the **worker** uses the
 * plain client from `@arciin/database` — so a resolver that simply read the
 * column got the ciphertext and cheerfully sent it to Google, which answered
 * `API_KEY_INVALID`. The failure was honest and the transcript reported it, but
 * the cause was three layers away from the message.
 *
 * Decrypting here rather than relying on which client happens to be wired means
 * the resolver returns a usable key in either process. The format below must
 * stay identical to `services/security/encryption.ts` — same scrypt salt, same
 * IV and tag layout — because both read the same stored bytes.
 */

import { createDecipheriv, scryptSync } from "node:crypto"

const KEY_LEN = 32
/** Same domain salt as the API's encryption module. Do not change either alone. */
const SCRYPT_SALT = "arciin-webhooks"
/** AES-GCM output is base64 and always comfortably longer than this. */
const MIN_CIPHERTEXT_LEN = 40

let cachedKey: Buffer | null = null

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey
  const material = process.env.ARCIIN_ENCRYPTION_KEY || process.env.SESSION_SECRET
  if (!material) {
    throw new Error("ARCIIN_ENCRYPTION_KEY or SESSION_SECRET is required to read provider keys.")
  }
  cachedKey = scryptSync(material, SCRYPT_SALT, KEY_LEN)
  return cachedKey
}

/**
 * The usable key.
 *
 * Values short enough to be plaintext, and values that fail to decrypt, are
 * returned as-is: rows predating encryption are still valid keys, and a key
 * rotation should degrade to "that profile stops working" rather than taking
 * the whole feature down.
 */
export function readModelApiKey(stored: string | null | undefined): string | null {
  const value = stored?.trim()
  if (!value) return null
  if (value.length < MIN_CIPHERTEXT_LEN) return value

  try {
    const raw = Buffer.from(value, "base64")
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const ciphertext = raw.subarray(28)
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
  } catch {
    // Already plaintext (the API's client decrypted it for us), or undecryptable.
    return value
  }
}
