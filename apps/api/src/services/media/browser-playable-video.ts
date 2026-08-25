import { access, mkdir } from "node:fs/promises"
import path from "node:path"

import { execa } from "execa"

/**
 * Some uploads (Instagram, phone screen records) arrive as VP9/AV1/HEVC inside
 * an MP4. Chrome will often play the AAC audio and show a black frame — or
 * refuse the video track entirely — because that container/codec pairing is
 * not what the browser expects. Remux (or lightly transcode) once, cache the
 * result next to thumbnails, and serve that for inline preview / downloads
 * that need to play in a browser.
 */

export type BrowserPlayablePlan = {
  /** Extension of the cached derivative. */
  ext: "webm" | "mp4"
  contentType: string
  /** ffmpeg args after `-i <source>` and before the output path. */
  ffmpegArgs: string[]
}

export function planBrowserPlayableVideo(input: {
  codec: string | null | undefined
  mimeType: string | null | undefined
}): BrowserPlayablePlan | null {
  const codec = (input.codec ?? "").trim().toLowerCase()
  const mime = (input.mimeType ?? "").trim().toLowerCase()
  const inMp4 =
    mime.includes("mp4") || mime.includes("quicktime") || mime.endsWith("/mp4")

  // VP9/AV1 in MP4 → WebM (copy video, Opus audio). Fast; Chrome plays this.
  if (inMp4 && (codec === "vp9" || codec === "vp8" || codec === "av1")) {
    return {
      ext: "webm",
      contentType: "video/webm",
      ffmpegArgs: ["-c:v", "copy", "-c:a", "libopus", "-b:a", "128k", "-f", "webm"],
    }
  }

  // HEVC/H.265 in MP4 → H.264 MP4. Slower first time; then cached.
  if (codec === "hevc" || codec === "h265" || codec === "hev1" || codec === "hvc1") {
    return {
      ext: "mp4",
      contentType: "video/mp4",
      ffmpegArgs: [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
      ],
    }
  }

  return null
}

export function browserPlayableCachePath(
  storageRoot: string,
  assetId: string,
  ext: string,
): string {
  // Mirror thumbnail layout: deterministic, outside the original object key.
  return path.join(storageRoot, "thumbnails", "playable", `${assetId}.${ext}`)
}

export async function ensureBrowserPlayableVideo(input: {
  sourcePath: string
  storageRoot: string
  assetId: string
  codec: string | null | undefined
  mimeType: string | null | undefined
}): Promise<{ path: string; contentType: string; remuxed: boolean } | null> {
  const plan = planBrowserPlayableVideo({
    codec: input.codec,
    mimeType: input.mimeType,
  })
  if (!plan) return null

  const outPath = browserPlayableCachePath(input.storageRoot, input.assetId, plan.ext)
  try {
    await access(outPath)
    return { path: outPath, contentType: plan.contentType, remuxed: true }
  } catch {
    // not cached yet
  }

  await mkdir(path.dirname(outPath), { recursive: true })
  const tmp = `${outPath}.${process.pid}.tmp`

  try {
    await execa(
      "ffmpeg",
      ["-y", "-i", input.sourcePath, ...plan.ffmpegArgs, tmp],
      { timeout: 10 * 60_000 },
    )
    const { rename } = await import("node:fs/promises")
    await rename(tmp, outPath)
  } catch (error) {
    await import("node:fs/promises").then((fs) => fs.unlink(tmp).catch(() => {}))
    throw error
  }

  return { path: outPath, contentType: plan.contentType, remuxed: true }
}
