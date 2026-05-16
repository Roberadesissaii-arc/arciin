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

function vaultKey(): Buffer {
  return scryptSync(apiConfig.SESSION_SECRET, KEY_SALT, 32)
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
