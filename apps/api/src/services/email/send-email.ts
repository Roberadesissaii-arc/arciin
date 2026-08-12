/**
 * Outbound mail.
 *
 * Deliberately thin: one transport built per send rather than a long-lived
 * pooled connection. Arciin sends a handful of messages a month — an address
 * change, a test — and a pooled SMTP socket sitting idle for weeks against a
 * consumer provider is more likely to be a stale-connection bug than a saving.
 */

import nodemailer from "nodemailer"
import type { FastifyInstance } from "fastify"

import type { RenderedEmail } from "@arciin/shared"

import { arciinEmailInlineImages } from "@/services/email/brand-assets"
import {
  decryptEmailPassword,
  parseStoredEmailConfig,
  type StoredEmailConfig,
} from "@/services/email/email-config"

export type SendEmailResult =
  | { ok: true; messageId: string; to: string }
  | { ok: false; code: "NOT_CONFIGURED" | "NO_RECIPIENT" | "SEND_FAILED"; message: string }

/** Connection and handshake budget. A dead SMTP host must not hang the caller. */
const SMTP_TIMEOUT_MS = 20_000

export async function loadEmailConfig(
  prisma: FastifyInstance["prisma"],
): Promise<StoredEmailConfig | null> {
  const instance = await prisma.instanceConfig.findFirst({ select: { emailConfig: true } })
  return parseStoredEmailConfig(instance?.emailConfig)
}

/**
 * Where notifications go.
 *
 * An explicit notify address wins; otherwise the instance owner's account
 * email. Falling back to the owner is what makes the feature work without any
 * extra configuration beyond the SMTP account itself.
 */
export async function resolveNotifyRecipient(
  prisma: FastifyInstance["prisma"],
  config: StoredEmailConfig | null,
): Promise<string | null> {
  if (config?.notifyAddress) return config.notifyAddress

  const owner = await prisma.user.findFirst({
    where: { role: "OWNER", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  })

  return owner?.email ?? null
}

export type EmailAttachment = {
  filename: string
  content: Buffer
  contentType?: string
}

export async function sendEmail(
  fastify: FastifyInstance,
  input: {
    to: string | null
    message: RenderedEmail
    config?: StoredEmailConfig | null
    attachments?: EmailAttachment[]
  },
): Promise<SendEmailResult> {
  const config = input.config ?? (await loadEmailConfig(fastify.prisma))

  if (!config) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "No SMTP server is configured for this instance.",
    }
  }

  const to = input.to?.trim()
  if (!to) {
    return {
      ok: false,
      code: "NO_RECIPIENT",
      message: "No notification address is set and no owner account was found.",
    }
  }

  const password = decryptEmailPassword(config)

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: password ?? "" } : undefined,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  })

  try {
    // Same generated header + mark on every message (cid:arciin-header / arciin-brand).
    const brandImages = await arciinEmailInlineImages()
    const info = await transport.sendMail({
      from: config.fromName
        ? { name: config.fromName, address: config.fromAddress }
        : config.fromAddress,
      to,
      subject: input.message.subject,
      text: input.message.text,
      html: input.message.html,
      attachments: [
        ...brandImages,
        ...(input.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })) ?? []),
      ],
    })

    fastify.log.info({ to, subject: input.message.subject }, "Notification email sent")
    return { ok: true, messageId: info.messageId, to }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    // SMTP servers echo the username in auth failures and nodemailer includes
    // the full command in some errors. Strip anything that looks like a
    // credential before this reaches a log file or an HTTP response.
    const message = redactSmtpError(raw, config, password)
    fastify.log.warn({ host: config.host, err: message }, "Notification email failed")
    return { ok: false, code: "SEND_FAILED", message }
  } finally {
    transport.close()
  }
}

/** Remove credentials a provider may have echoed back in an error string. */
export function redactSmtpError(
  raw: string,
  config: StoredEmailConfig,
  password: string | null,
): string {
  let message = raw
  if (password) {
    message = message.split(password).join("[redacted]")
    // Providers frequently echo AUTH PLAIN/LOGIN payloads base64-encoded.
    const encoded = Buffer.from(password, "utf8").toString("base64")
    if (encoded) message = message.split(encoded).join("[redacted]")
  }
  if (config.username) {
    const encodedUser = Buffer.from(config.username, "utf8").toString("base64")
    if (encodedUser) message = message.split(encodedUser).join("[redacted]")
  }
  return message.slice(0, 400)
}
