/**
 * Posting to a Discord webhook with Arciin-branded embeds.
 *
 * Brand banner + mark are always attached as multipart files and referenced
 * via attachment:// so the channel shows unique art (not the email images).
 */

import type { FastifyInstance } from "fastify"

import {
  DELIVERY_MAX_BYTES,
  formatBytesShort,
  type DiscordEmbed,
  type DiscordWebhookPayload,
} from "@arciin/shared"

import { loadDiscordBrandFiles } from "@/services/discord/brand-assets"
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
  content: Buffer
  contentType?: string
}

export async function sendDiscordMessage(
  fastify: FastifyInstance,
  input: {
    content?: string
    embeds?: DiscordEmbed[]
    username?: string
    payload?: DiscordWebhookPayload
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

  const payload: Record<string, unknown> = input.payload
    ? {
        username: input.payload.username || "Arciin",
        embeds: input.payload.embeds,
        allowed_mentions: input.payload.allowed_mentions ?? { parse: [] },
        ...(input.payload.content?.trim()
          ? { content: input.payload.content.slice(0, 1900) }
          : {}),
      }
    : {
        username: input.username?.trim() || "Arciin",
        allowed_mentions: { parse: [] as string[] },
        ...(input.content?.trim() ? { content: input.content.slice(0, 1900) } : {}),
        ...(input.embeds?.length ? { embeds: input.embeds.slice(0, 10) } : {}),
      }

  const wantsBrand =
    input.payload?.includeBrandArt === true ||
    (Array.isArray(payload.embeds) &&
      JSON.stringify(payload.embeds).includes("attachment://"))

  let brandFiles: Awaited<ReturnType<typeof loadDiscordBrandFiles>> = []
  if (wantsBrand) {
    try {
      brandFiles = await loadDiscordBrandFiles()
    } catch (err) {
      fastify.log.warn({ err }, "Discord brand art missing — sending embed without images")
    }
  }

  const hasBody =
    Boolean(payload.content) ||
    (Array.isArray(payload.embeds) && (payload.embeds as unknown[]).length > 0) ||
    Boolean(input.attachment) ||
    brandFiles.length > 0

  if (!hasBody) {
    return {
      ok: false,
      code: "SEND_FAILED",
      message: "Nothing to send to Discord.",
    }
  }

  const extraFiles = [
    ...brandFiles,
    ...(input.attachment
      ? [
          {
            filename: input.attachment.filename,
            content: input.attachment.content,
            contentType: input.attachment.contentType || "application/octet-stream",
          },
        ]
      : []),
  ]

  let body: BodyInit
  const headers: Record<string, string> = {}

  if (extraFiles.length > 0) {
    const form = new FormData()
    form.append("payload_json", JSON.stringify(payload))
    extraFiles.forEach((file, index) => {
      form.append(
        `files[${index}]`,
        new Blob([new Uint8Array(file.content)], {
          type: file.contentType,
        }),
        file.filename,
      )
    })
    body = form
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
