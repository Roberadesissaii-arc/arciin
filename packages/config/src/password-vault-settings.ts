export const PASSWORD_MASK_STYLES = ["dots", "asterisk", "block"] as const
export type PasswordMaskStyle = (typeof PASSWORD_MASK_STYLES)[number]

export type PasswordVaultDisplaySettings = {
  showUsername: boolean
  showUrl: boolean
  showNotes: boolean
  showCategory: boolean
  showPasswordColumn: boolean
  maskStyle: PasswordMaskStyle
  revealByDefault: boolean
  /** When true, sidebar vault hides secrets until user re-enters account password. */
  lockSidebarVault: boolean
}

export const DEFAULT_PASSWORD_VAULT_DISPLAY: PasswordVaultDisplaySettings = {
  showUsername: true,
  showUrl: true,
  showNotes: false,
  showCategory: false,
  showPasswordColumn: true,
  maskStyle: "dots",
  revealByDefault: false,
  lockSidebarVault: true,
}

export function parsePasswordVaultDisplaySettings(raw: unknown): PasswordVaultDisplaySettings {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const mask = s.maskStyle
  return {
    showUsername: s.showUsername !== false,
    showUrl: s.showUrl !== false,
    showNotes: s.showNotes === true,
    showCategory: s.showCategory === true,
    showPasswordColumn: s.showPasswordColumn !== false,
    maskStyle:
      mask === "asterisk" || mask === "block" || mask === "dots" ? mask : DEFAULT_PASSWORD_VAULT_DISPLAY.maskStyle,
    revealByDefault: s.revealByDefault === true,
    lockSidebarVault: s.lockSidebarVault !== false,
  }
}

/** Mask using the secret value or a length hint when the API redacts the password. */
export function maskVaultPassword(
  secretOrLength: string | number,
  style: PasswordMaskStyle,
): string {
  const len =
    typeof secretOrLength === "number"
      ? secretOrLength
      : Math.max(secretOrLength.length, 1)
  if (style === "block") return "████████"
  if (style === "asterisk") return "*".repeat(Math.min(Math.max(len, 8), 16))
  return "••••••••"
}

export function vaultEntryHasPassword(entry: {
  password?: string | null
  passwordLength?: number | null
  hasPassword?: boolean
}): boolean {
  return Boolean(entry.password) || Boolean(entry.hasPassword) || (entry.passwordLength ?? 0) > 0
}
