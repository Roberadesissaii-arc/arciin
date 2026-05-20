import { access, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  IMAGE_THUMBNAIL_PLACEHOLDER_SVG,
  VIDEO_THUMBNAIL_PLACEHOLDER_SVG,
  candidateStorageObjectPaths,
  resolveArciinStorageRoot,
} from "@arciin/shared"
import { execa } from "execa"
import sharp from "sharp"

import { ensureDocumentThumbnailWritten } from "@/services/media/document-thumbnail"
import { getStoragePaths } from "@/services/storage/local-storage"

export function resolvedThumbnailPath(
  configuredStorageRoot: string | null | undefined,
  assetId: string,
  objectPhysicalPath: string,
): string {
  const storageRoot = resolveArciinStorageRoot(configuredStorageRoot, objectPhysicalPath)
  return path.join(getStoragePaths(storageRoot).thumbnailsDir, `${assetId}.webp`)
}

/**
 * Prefer path derived from canonical storage root + objectKey (matches how uploads are laid out),
 * then fall back to the stored physical path (may be wrong cwd / moved data dir).
 */
export async function resolveReadableObjectPath(opts: {
  configuredStorageRoot: string | null | undefined
  physicalPath: string
  objectKey: string
  extraRoots?: readonly (string | null | undefined)[]
}): Promise<string | null> {
  for (const p of candidateStorageObjectPaths(
    opts.configuredStorageRoot,
    opts.physicalPath,
    opts.objectKey,
    opts.extraRoots,
  )) {
    try {
      await access(p)
      return p
    } catch {
      continue
    }
  }
  return null
}

async function resizeToWebpBuffer(sourcePath: string): Promise<Buffer | null> {
  try {
    return await sharp(sourcePath, { failOn: "none" })
      .rotate()
      .resize(640, 360, { fit: "inside" })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    return null
  }
}

/** When ffmpeg is missing or fails, still return a valid WebP for `<img>` previews. */
export async function renderVideoPlaceholderWebpBuffer(): Promise<Buffer> {
  return sharp(Buffer.from(VIDEO_THUMBNAIL_PLACEHOLDER_SVG)).resize(640, 360).webp({ quality: 80 }).toBuffer()
}

/** When sharp cannot read the image file, return a placeholder so `<img>` never 404s. */
export async function renderImagePlaceholderWebpBuffer(): Promise<Buffer> {
  return sharp(Buffer.from(IMAGE_THUMBNAIL_PLACEHOLDER_SVG)).resize(640, 360).webp({ quality: 80 }).toBuffer()
}

/** One-off thumbnail bytes when cache file isn't available yet or can't be persisted. */
export async function renderImageWebpThumbnailBuffer(sourcePath: string): Promise<Buffer | null> {
  return resizeToWebpBuffer(sourcePath)
}

/**
 * Best-effort create `${assetId}.webp`. Uses Sharp for IMAGE (by media type, not only file extension).
 */
export async function ensureThumbnailWritten(opts: {
  assetId: string
  mediaType: string
  mimeType?: string | null
  extension?: string | null
  originalFilename?: string | null
  sourcePath: string
  thumbnailPath: string
}): Promise<boolean> {
  try {
    await access(opts.sourcePath)
  } catch {
    return false
  }

  await mkdir(path.dirname(opts.thumbnailPath), { recursive: true })

  const src = opts.sourcePath

  try {
    if (opts.mediaType === "IMAGE") {
      const buf = await resizeToWebpBuffer(src)
      if (buf) {
        await writeFile(opts.thumbnailPath, buf)
        return true
      }
      return false
    }

    if (/\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|heif)$/i.test(src)) {
      const buf = await resizeToWebpBuffer(src)
      if (buf) {
        await writeFile(opts.thumbnailPath, buf)
        return true
      }
      return false
    }

    if (opts.mediaType === "VIDEO" || /\.(mov|mp4|mpe?g|webm|mkv|avi|m4v)$/i.test(src)) {
      const r = await execa(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          src,
          "-frames:v",
          "1",
          "-vf",
          "scale=640:-1",
          opts.thumbnailPath,
        ],
        { timeout: 120_000, reject: false },
      )
      if (r.exitCode === 0) {
        try {
          await access(opts.thumbnailPath)
          return true
        } catch {
          /* fall through to placeholder */
        }
      }
      try {
        const buf = await renderVideoPlaceholderWebpBuffer()
        await writeFile(opts.thumbnailPath, buf)
        return true
      } catch {
        return false
      }
    }

    return ensureDocumentThumbnailWritten({
      mediaType: opts.mediaType,
      mimeType: opts.mimeType,
      extension: opts.extension,
      originalFilename: opts.originalFilename,
      sourcePath: src,
      thumbnailPath: opts.thumbnailPath,
    })
  } catch {
    return false
  }

  return false
}
