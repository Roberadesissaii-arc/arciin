import { fetchApi } from "@/lib/api/client"
import type { PasswordVaultDisplaySettings, PasswordVaultEntry } from "@/lib/types/models"

export type PasswordVaultList = {
  entries: PasswordVaultEntry[]
  total: number
  display: PasswordVaultDisplaySettings
  lockRequired: boolean
  secretsVisible: boolean
  pinConfigured: boolean
}

export type PasswordVaultImportResult = {
  imported: number
}

export type VaultUnlockInput = { password?: string; pin?: string }

export function getPasswordVault(signal?: AbortSignal) {
  return fetchApi<PasswordVaultList>("/settings/password-vault", { method: "GET", signal })
}

export function importPasswordVault(input: {
  text: string
  fileName?: string
  replace?: boolean
}) {
  return fetchApi<PasswordVaultImportResult>("/settings/password-vault/import", {
    method: "POST",
    body: input,
  })
}

export function clearPasswordVault() {
  return fetchApi<{ deleted: number }>("/settings/password-vault", { method: "DELETE" })
}

export function deletePasswordVaultEntry(id: string) {
  return fetchApi<{ success: boolean }>(`/settings/password-vault/${id}`, { method: "DELETE" })
}

export function updatePasswordVaultEntry(
  id: string,
  input: {
    name?: string
    username?: string
    password?: string
    url?: string
    notes?: string
    category?: string
  },
) {
  return fetchApi<PasswordVaultEntry>(`/settings/password-vault/${id}`, {
    method: "PATCH",
    body: input,
  })
}

export function updatePasswordVaultDisplay(
  input: Partial<PasswordVaultDisplaySettings> & { accountPassword?: string },
) {
  return fetchApi<PasswordVaultDisplaySettings>("/settings/password-vault/display", {
    method: "PATCH",
    body: input,
  })
}

export function unlockPasswordVault(input: VaultUnlockInput) {
  return fetchApi<{ unlocked: boolean; expiresInMinutes: number }>(
    "/settings/password-vault/unlock",
    { method: "POST", body: input },
  )
}

export function verifyPasswordVault(input: VaultUnlockInput) {
  return fetchApi<{ verified: boolean }>("/settings/password-vault/verify", {
    method: "POST",
    body: input,
  })
}

export function setPasswordVaultPin(input: {
  pin: string
  confirmPin: string
  accountPassword: string
}) {
  return fetchApi<{ pinConfigured: boolean }>("/settings/password-vault/pin", {
    method: "POST",
    body: input,
  })
}

export function removePasswordVaultPin(accountPassword: string) {
  return fetchApi<{ pinConfigured: boolean }>("/settings/password-vault/pin", {
    method: "DELETE",
    body: { accountPassword },
  })
}

export function lockPasswordVault() {
  return fetchApi<{ locked: boolean }>("/settings/password-vault/lock", {
    method: "POST",
    body: {},
  })
}
