import { getFileExtension } from "./media"

const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
}

/** Plex and other scanners need a recognizable extension on disk. */
export function mirrorFilenameForDisk(
  originalFilename: string,
  options?: { extension?: string | null; mimeType?: string | null },
): string {
  const base = originalFilename
    .replace(/^.*[/\\]/, "")
    .normalize("NFKD")
    .replace(/[<>:"|?*\x00-\x1f]/g, "-")
    .replace(/\.{2,}/g, ".")
    .trim()

  const name = base.length > 0 ? base : "file"
  const extFromName = getFileExtension(name)
  if (extFromName) return name

  const ext =
    options?.extension?.replace(/^\./, "").toLowerCase() ||
    (options?.mimeType ? MIME_TO_EXT[options.mimeType] : null) ||
    (options?.mimeType?.startsWith("video/") ? "mp4" : null) ||
    (options?.mimeType?.startsWith("image/") ? "jpg" : null) ||
    (options?.mimeType?.startsWith("audio/") ? "mp3" : null) ||
    "bin"

  return `${name}.${ext}`
}
