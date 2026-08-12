/**
 * Send one library file to the owner's email or Discord.
 *
 * Used by the chat tools and by the Settings "send me this" actions. The
 * destination is resolved here, from instance settings — callers pass a channel
 * ("email" | "discord") and an asset, never an address. See
 * `@arciin/shared/delivery-policy` for why that boundary is where it is.
 */

import { readFile } from "node:fs/promises"

import type { FastifyInstance } from "fastify"

import {
  DELIVERY_MAX_BYTES,
  checkDeliverable,
  formatBytesShort,
  maskEmail,
  renderAssetDeliveryEmail,
  renderDiscordAssetDeliveryMessage,
  type DeliveryChannel,
} from "@arciin/shared"

import { loadDiscordConfig, sendDiscordMessage } from "@/services/discord/send-discord"
import { loadEmailConfig, resolveNotifyRecipient, sendEmail } from "@/services/email/send-email"
import { resolveReadableObjectPath } from "@/services/media/thumbnail-cache"

export type DeliverAssetResult =
  | { ok: true; channel: DeliveryChannel; filename: string; destination: string }
  | { ok: false; code: string; message: string }

/**
 * Load the bytes for an asset.
 *
 * Reads the whole file into memory, which is fine only because both channels
 * cap well below any size that would matter — the cap is checked before this
 * runs, never after.
 */
async function readAssetBytes(
  fastify: FastifyInstance,
  assetId: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  const asset = await fastify.prisma.asset.findUnique({
    where: { id: assetId },
    include: { storageObject: true, library: { include: { storageLocation: true } } },
  })

  if (!asset || asset.deletedAt) return null

  const path = await resolveReadableObjectPath({
    configuredStorageRoot: asset.library.storageLocation.rootPath,
    physicalPath: asset.storageObject.physicalPath,
    objectKey: asset.storageObject.objectKey,
  })
  if (!path) return null

  const buffer = await readFile(path)
  return {
    buffer,
    filename: asset.originalFilename,
    mimeType: asset.mimeType || "application/octet-stream",
  }
}

export async function deliverAssetToOwner(
  fastify: FastifyInstance,
  input: { channel: DeliveryChannel; assetId: string; note?: string | null },
): Promise<DeliverAssetResult> {
  const asset = await fastify.prisma.asset.findUnique({
    where: { id: input.assetId },
    select: {
      id: true,
      originalFilename: true,
      title: true,
      sizeBytes: true,
      status: true,
      deletedAt: true,
      mimeType: true,
    },
  })

  const emailConfig = input.channel === "email" ? await loadEmailConfig(fastify.prisma) : null
  const discordConfig = input.channel === "discord" ? await loadDiscordConfig(fastify.prisma) : null

  const destination =
    input.channel === "email"
      ? await resolveNotifyRecipient(fastify.prisma, emailConfig)
      : discordConfig?.webhookUrlEncrypted
        ? "discord"
        : null

  const check = checkDeliverable({
    channel: input.channel,
    channelConfigured:
      input.channel === "email" ? Boolean(emailConfig) : Boolean(discordConfig?.enabled),
    hasDestination: Boolean(destination),
    asset,
  })

  if (!check.allowed) {
    return { ok: false, code: check.code, message: check.message }
  }

  const bytes = await readAssetBytes(fastify, input.assetId)
  if (!bytes) {
    return {
      ok: false,
      code: "FILE_MISSING",
      message: "That file's contents are missing from storage.",
    }
  }

  // The database size and the file on disk can disagree — a truncated write, a
  // restored backup. Re-check against what we actually read.
  if (bytes.buffer.byteLength > DELIVERY_MAX_BYTES[input.channel]) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `That file is ${formatBytesShort(
        bytes.buffer.byteLength,
      )}, over the ${formatBytesShort(DELIVERY_MAX_BYTES[input.channel])} limit.`,
    }
  }

  const label = asset!.title?.trim() || bytes.filename
  const note = input.note?.trim()

  const instance = await fastify.prisma.instanceConfig.findFirst({
    select: { instanceName: true },
  })
  const instanceName = instance?.instanceName ?? "Arciin"

  if (input.channel === "discord") {
    const result = await sendDiscordMessage(fastify, {
      config: discordConfig,
      payload: renderDiscordAssetDeliveryMessage({
        instanceName,
        filename: label,
        note: note ?? null,
      }),
      attachment: {
        filename: bytes.filename,
        content: bytes.buffer,
        contentType: bytes.mimeType,
      },
    })

    if (!result.ok) return { ok: false, code: result.code, message: result.message }
    return {
      ok: true,
      channel: "discord",
      filename: bytes.filename,
      destination: "your Discord channel",
    }
  }

  const message = renderAssetDeliveryEmail({
    instanceName,
    filename: bytes.filename,
    note: note ?? null,
    mimeType: bytes.mimeType || asset?.mimeType || null,
    sizeBytes: bytes.buffer.byteLength || (asset?.sizeBytes != null ? Number(asset.sizeBytes) : null),
  })

  const result = await sendEmail(fastify, {
    to: destination,
    config: emailConfig,
    attachments: [
      { filename: bytes.filename, content: bytes.buffer, contentType: bytes.mimeType },
    ],
    message,
  })

  if (!result.ok) return { ok: false, code: result.code, message: result.message }

  return {
    ok: true,
    channel: "email",
    filename: bytes.filename,
    destination: maskEmail(result.to),
  }
}
