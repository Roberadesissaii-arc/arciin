import { access, mkdir, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { assetSupportsDocumentThumbnail } from "@arciin/shared"
import { execa } from "execa"
import sharp from "sharp"

/**
 * Render the first page of a PDF (or PDF-like document) to WebP via ffmpeg + sharp.
 */
export async function ensureDocumentThumbnailWritten(opts: {
  mediaType: string
  mimeType?: string | null
  extension?: string | null
  originalFilename?: string | null
  sourcePath: string
  thumbnailPath: string
}): Promise<boolean> {
  if (
    !assetSupportsDocumentThumbnail(
      opts.mediaType,
      opts.mimeType,
      opts.extension,
      opts.originalFilename,
    )
  ) {
    return false
  }

  try {
    await access(opts.sourcePath)
  } catch {
    return false
  }

  await mkdir(path.dirname(opts.thumbnailPath), { recursive: true })

  const tmpPng = path.join(
    tmpdir(),
    `arciin-doc-${process.pid}-${Date.now()}.png`,
  )

  try {
    const r = await execa(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        opts.sourcePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:-1",
        tmpPng,
      ],
      { timeout: 120_000, reject: false },
    )

    if (r.exitCode !== 0) {
      return false
    }

    try {
      await access(tmpPng)
    } catch {
      return false
    }

    const buf = await sharp(tmpPng, { failOn: "none" })
      .resize(640, 360, { fit: "inside" })
      .webp({ quality: 82 })
      .toBuffer()

    await writeFile(opts.thumbnailPath, buf)
    return true
  } catch {
    return false
  } finally {
    await unlink(tmpPng).catch(() => {})
  }
}
