import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"

import { apiConfig } from "@/config"

export type VaultPayload = {
  name: string
  username?: string
  password?: string
  url?: string
  notes?: string
  category?: string
}

const ALGO = "aes-256-gcm"
const KEY_SALT = "arciin-password-vault-v1"

/**
 * Derived once per process. scrypt is deliberately slow (~70ms) and both inputs
 * are constant for the process lifetime, so deriving per call only burned CPU:
 * listing the vault re-derived it once per entry and blocked Node's single
 * thread for entries × 70ms — 187 entries stalled *every* request for ~13s.
 */
let cachedVaultKey: Buffer | null = null

function vaultKey(): Buffer {
  if (cachedVaultKey) {
    return cachedVaultKey
  }
  // Dedicated key when configured (ARCIIN_ENCRYPTION_KEY), else SESSION_SECRET
  // so existing vault entries keep decrypting. KEY_SALT domain-separates this
  // subkey from the webhook/integration one.
  const material = apiConfig.ARCIIN_ENCRYPTION_KEY ?? apiConfig.SESSION_SECRET
  cachedVaultKey = scryptSync(material, KEY_SALT, 32)
  return cachedVaultKey
}

export function encryptVaultPayload(payload: VaultPayload): {
  ciphertext: string
  iv: string
  authTag: string
} {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, vaultKey(), iv)
  const plain = Buffer.from(JSON.stringify(payload), "utf8")
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  }
}

export function decryptVaultPayload(ciphertext: string, iv: string, authTag: string): VaultPayload {
  const decipher = createDecipheriv(ALGO, vaultKey(), Buffer.from(iv, "base64"))
  decipher.setAuthTag(Buffer.from(authTag, "base64"))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ])
  const parsed = JSON.parse(decrypted.toString("utf8")) as VaultPayload
  if (!parsed?.name || typeof parsed.name !== "string") {
    throw new Error("Invalid vault payload.")
  }
  return parsed
}
