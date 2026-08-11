/**
 * SMTP settings for the instance.
 *
 * Arciin is self-hosted and has no cloud account, so there is no Arciin-operated
 * mail relay to fall back on — the user brings their own SMTP account. That
 * account's password is a live credential for a third-party service, so it is
 * stored as AES-256-GCM ciphertext and never leaves the server: the API returns
 * a `hasPassword` boolean and nothing more.
 */

import { z } from "zod"

import { decryptSecret, encryptSecret } from "@/services/security/encryption"

export type StoredEmailConfig = {
  host: string
  port: number
  secure: boolean
  username: string | null
  passwordEncrypted: string | null
  fromAddress: string
  fromName: string | null
  /** Where notifications go. Defaults to the owner's account email. */
  notifyAddress: string | null
  notifyOnUrlChange: boolean
}

export const emailConfigSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().optional(),
  username: z.string().trim().max(255).nullable().optional(),
  /** Omitted on update means "keep the stored password". */
  password: z.string().min(1).max(512).nullable().optional(),
  fromAddress: z.string().trim().email(),
  fromName: z.string().trim().max(120).nullable().optional(),
  notifyAddress: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
  notifyOnUrlChange: z.boolean().optional(),
})

export type EmailConfigInput = z.infer<typeof emailConfigSchema>

export function parseStoredEmailConfig(raw: unknown): StoredEmailConfig | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  if (typeof value.host !== "string" || !value.host) return null
  if (typeof value.fromAddress !== "string" || !value.fromAddress) return null

  const port = Number(value.port)
  return {
    host: value.host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    // Port 465 is implicit TLS; everything else starts plaintext and upgrades
    // with STARTTLS. Getting this backwards fails to connect rather than
    // failing open, but the default should still be the correct one.
    secure: typeof value.secure === "boolean" ? value.secure : port === 465,
    username: typeof value.username === "string" ? value.username : null,
    passwordEncrypted:
      typeof value.passwordEncrypted === "string" ? value.passwordEncrypted : null,
    fromAddress: value.fromAddress,
    fromName: typeof value.fromName === "string" ? value.fromName : null,
    notifyAddress: typeof value.notifyAddress === "string" ? value.notifyAddress : null,
    notifyOnUrlChange: value.notifyOnUrlChange !== false,
  }
}

/**
 * Merge an update onto what is stored.
 *
 * A missing `password` means "unchanged", so the UI can render the form without
 * ever holding the secret. An explicit null clears it.
 */
export function mergeEmailConfig(
  existing: StoredEmailConfig | null,
  input: EmailConfigInput,
): StoredEmailConfig {
  const passwordEncrypted =
    input.password === undefined
      ? (existing?.passwordEncrypted ?? null)
      : input.password === null
        ? null
        : encryptSecret(input.password)

  return {
    host: input.host,
    port: input.port,
    secure: input.secure ?? input.port === 465,
    username: input.username?.trim() || null,
    passwordEncrypted,
    fromAddress: input.fromAddress,
    fromName: input.fromName?.trim() || null,
    notifyAddress:
      input.notifyAddress === undefined
        ? (existing?.notifyAddress ?? null)
        : input.notifyAddress === "" || input.notifyAddress === null
          ? null
          : input.notifyAddress,
    notifyOnUrlChange: input.notifyOnUrlChange ?? existing?.notifyOnUrlChange ?? true,
  }
}

/** Never includes the password, encrypted or otherwise. */
export function serializeEmailConfig(config: StoredEmailConfig | null) {
  if (!config) {
    return {
      configured: false,
      host: null,
      port: null,
      secure: null,
      username: null,
      hasPassword: false,
      fromAddress: null,
      fromName: null,
      notifyAddress: null,
      notifyOnUrlChange: true,
    }
  }

  return {
    configured: true,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: config.username,
    hasPassword: Boolean(config.passwordEncrypted),
    fromAddress: config.fromAddress,
    fromName: config.fromName,
    notifyAddress: config.notifyAddress,
    notifyOnUrlChange: config.notifyOnUrlChange,
  }
}

export function decryptEmailPassword(config: StoredEmailConfig): string | null {
  if (!config.passwordEncrypted) return null
  try {
    return decryptSecret(config.passwordEncrypted)
  } catch {
    // Ciphertext that no longer decrypts means the encryption key changed.
    // Returning null makes the send fail with a clear SMTP auth error rather
    // than crashing the caller.
    return null
  }
}
