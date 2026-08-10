import { decryptSecret, encryptSecret } from "@/services/security/encryption"

/**
 * Transparent encryption for ModelProfile.apiKey.
 *
 * Provider keys (OpenAI, DeepSeek, Gemini…) were stored in plaintext, while
 * webhook secrets in the very next table were encrypted. Anyone with a database
 * dump — including a backup file — could read every key and spend against them.
 *
 * The column is read in ~70 places across 17 files, so encrypting at each call
 * site would have been both invasive and easy to miss one of. This wraps the
 * Prisma client instead: writes are encrypted on the way in, reads are
 * decrypted on the way out, and every existing caller keeps working untouched.
 */

/** AES-GCM output from encryptSecret is base64 and always well over this. */
const MIN_CIPHERTEXT_LEN = 40

/**
 * Existing rows are plaintext, and a key rotation would leave undecryptable
 * values behind. Either way, returning the raw value beats throwing and taking
 * the whole chat feature down — the row simply stops working until re-saved.
 */
export function decryptModelApiKey(value: string | null): string | null {
  if (!value) return value
  if (value.length < MIN_CIPHERTEXT_LEN) return value
  try {
    return decryptSecret(value)
  } catch {
    return value
  }
}

export function encryptModelApiKey(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined || value === "") return value
  // Idempotent: never double-encrypt something already stored as ciphertext.
  try {
    decryptSecret(value)
    return value
  } catch {
    return encryptSecret(value)
  }
}

type MaybeProfile = { apiKey?: string | null } | null | undefined

/** Walk whatever a ModelProfile query returned and decrypt in place. */
export function decryptModelProfileResult<T>(result: T): T {
  if (Array.isArray(result)) {
    for (const row of result) decryptOne(row as MaybeProfile)
    return result
  }
  decryptOne(result as MaybeProfile)
  return result
}

function decryptOne(row: MaybeProfile) {
  if (!row || typeof row !== "object") return
  if (typeof row.apiKey === "string") {
    row.apiKey = decryptModelApiKey(row.apiKey)
  }
}
