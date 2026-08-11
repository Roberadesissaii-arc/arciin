/**
 * Discord delivery settings.
 *
 * A webhook URL is a bearer credential: anyone holding it can post into the
 * channel, forever, with no further authentication. So it is treated like the
 * SMTP password — AES-256-GCM at rest, never returned by the API, and never
 * echoed into an error message or a chat transcript.
 */

import { z } from "zod"

import { isValidDiscordWebhookUrl } from "@arciin/shared"

import { decryptSecret, encryptSecret } from "@/services/security/encryption"

export type StoredDiscordConfig = {
  webhookUrlEncrypted: string | null
  /** Post the new public address to Discord when the tunnel restarts. */
  notifyOnUrlChange: boolean
  enabled: boolean
}

export const discordConfigSchema = z.object({
  /** Omitted means "keep the stored webhook"; null clears it. */
  webhookUrl: z
    .string()
    .trim()
    .refine(isValidDiscordWebhookUrl, {
      message: "That is not a Discord webhook URL.",
    })
    .nullable()
    .optional(),
  notifyOnUrlChange: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

export type DiscordConfigInput = z.infer<typeof discordConfigSchema>

export function parseStoredDiscordConfig(raw: unknown): StoredDiscordConfig | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  const webhookUrlEncrypted =
    typeof value.webhookUrlEncrypted === "string" ? value.webhookUrlEncrypted : null
  if (!webhookUrlEncrypted) return null

  return {
    webhookUrlEncrypted,
    notifyOnUrlChange: value.notifyOnUrlChange !== false,
    enabled: value.enabled !== false,
  }
}

export function mergeDiscordConfig(
  existing: StoredDiscordConfig | null,
  input: DiscordConfigInput,
): StoredDiscordConfig {
  const webhookUrlEncrypted =
    input.webhookUrl === undefined
      ? (existing?.webhookUrlEncrypted ?? null)
      : input.webhookUrl === null
        ? null
        : encryptSecret(input.webhookUrl)

  return {
    webhookUrlEncrypted,
    notifyOnUrlChange: input.notifyOnUrlChange ?? existing?.notifyOnUrlChange ?? true,
    enabled: input.enabled ?? existing?.enabled ?? true,
  }
}

/** Never includes the webhook URL, encrypted or otherwise. */
export function serializeDiscordConfig(config: StoredDiscordConfig | null) {
  return {
    configured: Boolean(config?.webhookUrlEncrypted),
    enabled: config?.enabled ?? false,
    notifyOnUrlChange: config?.notifyOnUrlChange ?? true,
  }
}

export function decryptWebhookUrl(config: StoredDiscordConfig | null): string | null {
  if (!config?.webhookUrlEncrypted) return null
  try {
    const url = decryptSecret(config.webhookUrlEncrypted)
    // Re-validate after decryption: a rotated key produces garbage rather than
    // throwing in every case, and posting a file to a garbage URL is worse
    // than not posting it.
    return isValidDiscordWebhookUrl(url) ? url : null
  } catch {
    return null
  }
}
