import { access, mkdir, readdir, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { assetSupportsDocumentThumbnail } from "@arciin/shared"
import { execa } from "execa"
import sharp from "sharp"

/**
 * Render the first page of a PDF to WebP. Primary renderer is pdftoppm
 * (poppler-utils) — ffmpeg cannot decode PDFs — with ffmpeg kept as a
 * fallback for any other document container that slips through.
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

  const tmpBase = path.join(tmpdir(), `arciin-doc-${process.pid}-${Date.now()}`)

  try {
    const pngPath =
      (await renderPdfFirstPage(opts.sourcePath, tmpBase)) ??
      (await renderWithFfmpeg(opts.sourcePath, `${tmpBase}.png`))

    if (!pngPath) {
      return false
    }

    const buf = await sharp(pngPath, { failOn: "none" })
      .resize(640, 360, { fit: "inside" })
      .webp({ quality: 82 })
      .toBuffer()

    await writeFile(opts.thumbnailPath, buf)
    return true
  } catch {
    return false
  } finally {
    await cleanupTmp(tmpBase)
  }
}

/** pdftoppm writes `<prefix>-1.png` / `<prefix>-001.png` depending on version. */
async function renderPdfFirstPage(sourcePath: string, tmpBase: string) {
  const r = await execa(
    "pdftoppm",
    ["-png", "-f", "1", "-l", "1", "-scale-to", "640", sourcePath, tmpBase],
    { timeout: 120_000, reject: false },
  )
  if (r.exitCode !== 0) return null

  const dir = path.dirname(tmpBase)
  const prefix = path.basename(tmpBase)
  const entries = await readdir(dir).catch(() => [] as string[])
  const produced = entries.find((f) => f.startsWith(`${prefix}-`) && f.endsWith(".png"))
  return produced ? path.join(dir, produced) : null
}

async function renderWithFfmpeg(sourcePath: string, tmpPng: string) {
  const r = await execa(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-1",
      tmpPng,
    ],
    { timeout: 120_000, reject: false },
  )
  if (r.exitCode !== 0) return null
  try {
    await access(tmpPng)
    return tmpPng
  } catch {
    return null
  }
}

async function cleanupTmp(tmpBase: string) {
  const dir = path.dirname(tmpBase)
  const prefix = path.basename(tmpBase)
  const entries = await readdir(dir).catch(() => [] as string[])
  await Promise.all(
    entries
      .filter((f) => f.startsWith(prefix))
      .map((f) => unlink(path.join(dir, f)).catch(() => {})),
  )
}
