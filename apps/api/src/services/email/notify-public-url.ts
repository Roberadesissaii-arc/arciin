/**
 * "Your server has a new address" notification.
 *
 * Sent when a Cloudflare quick tunnel comes back with a different hostname —
 * which is every restart. The failure mode this exists for: the server reboots
 * while you are out, the link saved on your phone starts returning 530, and the
 * only copy of the new address is on a screen in your house.
 */

import type { FastifyInstance } from "fastify"

import { renderRemoteAccessEmail } from "@arciin/shared"

import { loadDiscordConfig, sendDiscordMessage } from "@/services/discord/send-discord"
import { loadEmailConfig, resolveNotifyRecipient, sendEmail } from "@/services/email/send-email"
import { resolveLocalAccessUrls } from "@/services/remote-access/local-access-urls"

export async function notifyPublicUrlChanged(
  fastify: FastifyInstance,
  input: { publicUrl: string; previousPublicUrl?: string | null },
): Promise<{ sent: boolean; reason?: string }> {
  const config = await loadEmailConfig(fastify.prisma)

  if (!config) return { sent: false, reason: "NOT_CONFIGURED" }
  if (!config.notifyOnUrlChange) return { sent: false, reason: "DISABLED" }

  const to = await resolveNotifyRecipient(fastify.prisma, config)
  if (!to) return { sent: false, reason: "NO_RECIPIENT" }

  const instance = await fastify.prisma.instanceConfig.findFirst({
    select: { instanceName: true },
  })

  const message = renderRemoteAccessEmail({
    instanceName: instance?.instanceName ?? "Arciin",
    publicUrl: input.publicUrl,
    previousPublicUrl: input.previousPublicUrl ?? null,
    changedAt: new Date().toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    // Useful when the reader is actually at home: the LAN address does not
    // change when the tunnel does.
    localUrl: resolveLocalAccessUrls().primaryLanUrl,
  })

  const result = await sendEmail(fastify, { to, message, config })
  return result.ok ? { sent: true } : { sent: false, reason: result.code }
}

/**
 * Post the new address to Discord.
 *
 * Independent of email on purpose: someone with no SMTP account at all can
 * still get the link, and a broken mail server must not silence Discord.
 */
export async function announcePublicUrlToDiscord(
  fastify: FastifyInstance,
  input: { publicUrl: string; previousPublicUrl?: string | null },
): Promise<{ sent: boolean; reason?: string }> {
  const config = await loadDiscordConfig(fastify.prisma)
  if (!config?.enabled) return { sent: false, reason: "NOT_CONFIGURED" }
  if (!config.notifyOnUrlChange) return { sent: false, reason: "DISABLED" }

  const instance = await fastify.prisma.instanceConfig.findFirst({
    select: { instanceName: true },
  })
  const name = instance?.instanceName ?? "Arciin"

  const lines = [
    `**${name} has a new address**`,
    input.publicUrl,
    "",
    "Works on phone and computer — the same link opens the mobile app or the desktop app depending on the device.",
  ]
  if (input.previousPublicUrl) {
    lines.push("", "The previous address has stopped working.")
  }

  const result = await sendDiscordMessage(fastify, {
    config,
    content: lines.join("\n"),
  })

  return result.ok ? { sent: true } : { sent: false, reason: result.code }
}

/** Both channels, each failing independently. */
export async function announcePublicUrlChange(
  fastify: FastifyInstance,
  input: { publicUrl: string; previousPublicUrl?: string | null },
): Promise<{ email: boolean; discord: boolean }> {
  const [email, discord] = await Promise.allSettled([
    notifyPublicUrlChanged(fastify, input),
    announcePublicUrlToDiscord(fastify, input),
  ])

  return {
    email: email.status === "fulfilled" && email.value.sent,
    discord: discord.status === "fulfilled" && discord.value.sent,
  }
}
