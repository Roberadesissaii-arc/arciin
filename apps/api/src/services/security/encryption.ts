import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto"

import { apiConfig } from "@/config"

const KEY_LEN = 32

/** Same reasoning as the vault key: scrypt is slow by design and the inputs never change. */
let cachedKey: Buffer | null = null

function getKey() {
  if (cachedKey) {
    return cachedKey
  }
  // Prefer a dedicated encryption key so session signing and data encryption
  // can rotate independently. Falls back to SESSION_SECRET when unset so
  // existing ciphertext keeps decrypting. The domain salt separates this
  // subkey from the vault's.
  const material = apiConfig.ARCIIN_ENCRYPTION_KEY ?? apiConfig.SESSION_SECRET
  cachedKey = scryptSync(material, "arciin-webhooks", KEY_LEN)
  return cachedKey
}

export function encryptSecret(plaintext: string) {
  const iv = randomBytes(12)
  const key = getKey()
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString("base64")
}

export function decryptSecret(enc: string) {
  const raw = Buffer.from(enc, "base64")
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ciphertext = raw.subarray(28)
  const key = getKey()
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

export function signBody(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex")
}

