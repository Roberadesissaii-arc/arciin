import { hashPassword, verifyPassword } from "@/services/security/auth"

export type PasswordVaultPinState = {
  pinConfigured: boolean
}

export function readPasswordVaultPin(aiConfig: unknown): PasswordVaultPinState {
  const cfg = (aiConfig && typeof aiConfig === "object" ? aiConfig : {}) as Record<string, unknown>
  const vault = cfg.passwordVault
  const pinHash =
    vault && typeof vault === "object"
      ? (vault as Record<string, unknown>).pinHash
      : undefined
  return { pinConfigured: typeof pinHash === "string" && pinHash.length > 0 }
}

export function readPasswordVaultPinHash(aiConfig: unknown): string | null {
  const cfg = (aiConfig && typeof aiConfig === "object" ? aiConfig : {}) as Record<string, unknown>
  const vault = cfg.passwordVault
  const pinHash =
    vault && typeof vault === "object"
      ? (vault as Record<string, unknown>).pinHash
      : undefined
  return typeof pinHash === "string" && pinHash.length > 0 ? pinHash : null
}

export async function hashVaultPin(pin: string) {
  return hashPassword(pin)
}

export async function verifyVaultPin(pin: string, pinHash: string) {
  return verifyPassword(pin, pinHash)
}

export function mergePasswordVaultPin(
  aiConfig: unknown,
  pinHash: string | null,
): Record<string, unknown> {
  const cfg = (aiConfig && typeof aiConfig === "object" ? aiConfig : {}) as Record<string, unknown>
  const prevVault =
    cfg.passwordVault && typeof cfg.passwordVault === "object"
      ? (cfg.passwordVault as Record<string, unknown>)
      : {}

  const nextVault = { ...prevVault }
  if (pinHash) {
    nextVault.pinHash = pinHash
  } else {
    delete nextVault.pinHash
  }

  return { ...cfg, passwordVault: nextVault }
}
