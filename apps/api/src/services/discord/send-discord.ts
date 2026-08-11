/**
 * Posting to a Discord webhook.
 *
 * Uses the plain webhook REST endpoint — no bot, no gateway connection, no
 * OAuth. The user pastes a webhook URL from their own server's channel settings
 * and that is the whole setup.
 *
 * Errors from Discord are never surfaced verbatim: the URL is a credential and
 * Discord echoes the request URL in some failures.
 */

import type { FastifyInstance } from "fastify"

import { DELIVERY_MAX_BYTES, formatBytesShort } from "@arciin/shared"

import {
  decryptWebhookUrl,
  parseStoredDiscordConfig,
  type StoredDiscordConfig,
} from "@/services/discord/discord-config"

const DISCORD_TIMEOUT_MS = 30_000

export type DiscordSendResult =
  | { ok: true }
  | { ok: false; code: "NOT_CONFIGURED" | "TOO_LARGE" | "SEND_FAILED"; message: string }

export async function loadDiscordConfig(
  prisma: FastifyInstance["prisma"],
): Promise<StoredDiscordConfig | null> {
  const instance = await prisma.instanceConfig.findFirst({ select: { discordConfig: true } })
  return parseStoredDiscordConfig(instance?.discordConfig)
}

export type DiscordAttachment = {
  filename: string
  /** Read into memory deliberately — capped at DELIVERY_MAX_BYTES.discord. */
  content: Buffer
  contentType?: string
}

/**
 * Post a message, optionally with one file attached.
 *
 * `allowed_mentions: { parse: [] }` is not decoration: message content can
 * include a filename the user did not choose (an uploaded file from a File
 * Request, say), and without it a filename containing `@everyone` would ping
 * the whole server.
 */
export async function sendDiscordMessage(
  fastify: FastifyInstance,
  input: {
    content: string
    attachment?: DiscordAttachment | null
    config?: StoredDiscordConfig | null
  },
): Promise<DiscordSendResult> {
  const config = input.config ?? (await loadDiscordConfig(fastify.prisma))
  const webhookUrl = decryptWebhookUrl(config)

  if (!config?.enabled || !webhookUrl) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Discord is not set up on this instance.",
    }
  }

  if (input.attachment && input.attachment.content.byteLength > DELIVERY_MAX_BYTES.discord) {
    return {
      ok: false,
      code: "TOO_LARGE",
      message: `Discord uploads are limited to ${formatBytesShort(DELIVERY_MAX_BYTES.discord)}.`,
    }
  }

  const payload = {
    content: input.content.slice(0, 1900),
    allowed_mentions: { parse: [] as string[] },
  }

  let body: BodyInit
  const headers: Record<string, string> = {}

  if (input.attachment) {
    const form = new FormData()
    form.append("payload_json", JSON.stringify(payload))
    form.append(
      "files[0]",
      new Blob([new Uint8Array(input.attachment.content)], {
        type: input.attachment.contentType || "application/octet-stream",
      }),
      input.attachment.filename,
    )
    body = form
    // Content-Type is set by FormData with its own boundary; setting it here
    // would produce a boundary mismatch and a 400 from Discord.
  } else {
    body = JSON.stringify(payload)
    headers["Content-Type"] = "application/json"
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    })

    if (!response.ok) {
      // Deliberately does not include the response body or URL — both can
      // contain the webhook token.
      fastify.log.warn({ status: response.status }, "Discord webhook rejected the message")
      return {
        ok: false,
        code: "SEND_FAILED",
        message:
          response.status === 404
            ? "That Discord webhook no longer exists. Create a new one and paste it in Settings."
            : `Discord rejected the message (HTTP ${response.status}).`,
      }
    }

    return { ok: true }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    fastify.log.warn({ timedOut }, "Discord webhook request failed")
    return {
      ok: false,
      code: "SEND_FAILED",
      message: timedOut ? "Discord did not respond in time." : "Could not reach Discord.",
    }
  }
}
