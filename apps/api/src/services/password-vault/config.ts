import type { Prisma } from "@prisma/client"

import {
  DEFAULT_PASSWORD_VAULT_DISPLAY,
  parsePasswordVaultDisplaySettings,
  type PasswordVaultDisplaySettings,
} from "@arciin/shared"

export function readPasswordVaultDisplay(aiConfig: unknown): PasswordVaultDisplaySettings {
  const cfg = (aiConfig && typeof aiConfig === "object" ? aiConfig : {}) as Record<string, unknown>
  const vault = cfg.passwordVault
  const display =
    vault && typeof vault === "object" ? (vault as Record<string, unknown>).display : undefined
  return parsePasswordVaultDisplaySettings(display)
}

export function mergePasswordVaultDisplay(
  aiConfig: unknown,
  patch: Partial<PasswordVaultDisplaySettings>,
): Record<string, unknown> {
  const cfg = (aiConfig && typeof aiConfig === "object" ? aiConfig : {}) as Record<string, unknown>
  const prevVault =
    cfg.passwordVault && typeof cfg.passwordVault === "object"
      ? (cfg.passwordVault as Record<string, unknown>)
      : {}
  const prevDisplay = parsePasswordVaultDisplaySettings(prevVault.display)
  const nextDisplay = { ...prevDisplay, ...patch }

  return {
    ...cfg,
    passwordVault: {
      ...prevVault,
      display: nextDisplay,
    },
  }
}

export { DEFAULT_PASSWORD_VAULT_DISPLAY }

export function toPrismaAiConfig(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}
