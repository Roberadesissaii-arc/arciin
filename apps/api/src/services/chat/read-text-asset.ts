import type { PrismaClient } from "@prisma/client"
import { promises as fs } from "node:fs"

import { isCodeFilename } from "@arciin/shared"

const MAX_FILE_BYTES = 512 * 1024
const DEFAULT_MAX_CHARS = 12_000

function isReadableTextAsset(filename: string, mimeType?: string | null): boolean {
  if (isCodeFilename(filename)) return true
  const m = (mimeType ?? "").toLowerCase()
  return (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/javascript" ||
    m === "application/typescript" ||
    m === "application/xml"
  )
}

export async function readTextAssetContent(
  prisma: PrismaClient,
  input: { assetId?: string; filename?: string; maxChars?: number },
): Promise<Record<string, unknown>> {
  const maxChars = Math.min(32_000, Math.max(500, Number(input.maxChars) || DEFAULT_MAX_CHARS))
  const assetId = input.assetId?.trim()
  const filename = input.filename?.trim()

  if (!assetId && !filename) {
    return { error: "validation", message: "Provide asset_id or filename." }
  }

  let asset = assetId
    ? await prisma.asset.findFirst({
        where: { id: assetId, deletedAt: null },
        include: { storageObject: true, library: { select: { slug: true, name: true } } },
      })
    : null

  if (!asset && filename) {
    const matches = await prisma.asset.findMany({
      where: {
        deletedAt: null,
        originalFilename: { equals: filename, mode: "insensitive" },
      },
      include: { storageObject: true, library: { select: { slug: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    })
    if (matches.length === 0) {
      return { error: "not_found", message: `No file named "${filename}".` }
    }
    if (matches.length > 1) {
      return {
        error: "ambiguous",
        message: "Multiple files match that name; use asset_id.",
        candidates: matches.map((m) => ({
          asset_id: m.id,
          filename: m.originalFilename,
          library: m.library.slug,
        })),
      }
    }
    asset = matches[0]!
  }

  if (!asset) {
    return { error: "not_found", message: "Asset not found." }
  }

  if (!isReadableTextAsset(asset.originalFilename, asset.mimeType)) {
    return {
      error: "not_text",
      message: "This file is not a text or source-code asset.",
      filename: asset.originalFilename,
      mediaType: asset.mediaType,
    }
  }

  const path = asset.storageObject?.physicalPath
  if (!path) {
    return { error: "no_storage", message: "File content is not on disk." }
  }

  try {
    const stat = await fs.stat(path)
    if (stat.size > MAX_FILE_BYTES) {
      return {
        error: "too_large",
        message: `File exceeds ${MAX_FILE_BYTES} bytes; open it in Files instead.`,
        sizeBytes: Number(stat.size),
      }
    }
    const buf = await fs.readFile(path)
    const text = buf.toString("utf8")
    const truncated = text.length > maxChars
    const content = truncated ? text.slice(0, maxChars) : text

    return {
      asset_id: asset.id,
      filename: asset.originalFilename,
      library: asset.library.slug,
      mediaType: asset.mediaType,
      mimeType: asset.mimeType,
      sizeBytes: Number(stat.size),
      truncated,
      content,
    }
  } catch {
    return { error: "read_failed", message: "Could not read file from storage." }
  }
}
