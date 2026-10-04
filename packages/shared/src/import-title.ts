/**
 * The name an imported file is given.
 *
 * A link import used to keep whatever basename the downloader wrote —
 * yt-dlp's `%(id)s.%(ext)s` gave "dQw4w9WgXcQ.mp4", a CDN gave
 * "preview.mp4" — and that became the asset's name everywhere. The source
 * almost always says what the thing is called; this picks that name, from the
 * most to the least trustworthy place, and makes it safe to use as a
 * filename. Physical storage is untouched: objects stay `<sha256>.<ext>`.
 *
 * Pure: no I/O, shared by the API, the worker and the tests.
 */

/** Longest title kept on an asset. */
export const IMPORT_TITLE_MAX_CHARS = 300
/** Longest filename stem, in UTF-8 bytes (common filesystems allow 255 for the whole name). */
export const IMPORT_FILENAME_STEM_MAX_BYTES = 180
export const IMPORT_FALLBACK_STEM = "Imported media"

/** Every place a title can come from, best first. */
export type ImportTitleSources = {
  /** The title the server stored for an inspection candidate the user picked (never client text). */
  candidateTitle?: string | null
  /** yt-dlp's structured `title` for the downloaded media. */
  ytDlpTitle?: string | null
  ogTitle?: string | null
  jsonLdName?: string | null
  htmlTitle?: string | null
  /** Filename from Content-Disposition, extension included or not. */
  contentDispositionName?: string | null
  /** Last path segment of the final URL. */
  urlFilename?: string | null
}

export type ImportTitleSource = keyof ImportTitleSources

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g

/** Readable title text: no control or bidi-override characters, single spaces, bounded. */
export function cleanImportTitle(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  let text = raw.normalize("NFC").replace(CONTROL, " ").replace(/\s+/g, " ").trim()
  if (!text) return null
  if (text.length > IMPORT_TITLE_MAX_CHARS) {
    // Never split a surrogate pair (an emoji) in half.
    text = Array.from(text).slice(0, IMPORT_TITLE_MAX_CHARS - 1).join("").trimEnd() + "…"
  }
  return text
}

/** Names that say nothing about the media: a downloader's id, "preview", "video", a bare host. */
export function isGenericImportTitle(raw: string | null | undefined): boolean {
  const title = cleanImportTitle(raw)
  if (!title) return true
  const original = title.replace(/\.[A-Za-z0-9]{1,6}$/, "").trim()
  const stem = original.toLowerCase()
  if (!stem) return true
  if (
    /^(preview|video|audio|image|photo|picture|media|file|download|index|watch|embed|player|stream|untitled|unknown|default|master|playlist|clip|movie|track|item|output|source|original|thumbnail|null|undefined)(\s*[-_ ]?\s*\d{0,4})?$/.test(
      stem,
    )
  ) {
    return true
  }
  // "YouTube video 1", "Item 3": inspection placeholders.
  if (/^(item|[a-z0-9 .]+ (video|audio|image|item|file)) \d{1,3}$/.test(stem)) return true
  // Opaque ids: a YouTube id, a numeric id, a hash, a uuid.
  if (/^[A-Za-z0-9_-]{11}$/.test(original) && /\d/.test(original) && /[A-Z]/.test(original) && /[a-z]/.test(original)) return true
  if (/^\d{4,}$/.test(stem)) return true
  if (/^[a-f0-9]{16,}$/i.test(stem)) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem)) return true
  // A host name ("www.example.com").
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(stem) && !/\s/.test(stem)) return true
  return false
}

/** "My Video.mp4" → "My Video"; leaves a title with no extension alone. */
export function titleStem(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,6}$/, "")
}

const ORDER: ImportTitleSource[] = [
  "candidateTitle",
  "ytDlpTitle",
  "ogTitle",
  "jsonLdName",
  "htmlTitle",
  "contentDispositionName",
  "urlFilename",
]

const FILE_LIKE =
  /\.(mp4|webm|mkv|mov|m4v|avi|mp3|m4a|aac|wav|flac|ogg|opus|jpe?g|png|gif|webp|avif|heic|pdf|docx?|xlsx?|pptx?|odt|txt|csv|rtf|zip|epub|json)$/i

/** Sources that name the media itself (as opposed to a filename on a server). */
const DESCRIPTIVE = new Set<ImportTitleSource>(["candidateTitle", "ytDlpTitle", "ogTitle", "jsonLdName", "htmlTitle"])

/**
 * The best title available, and where it came from. Filename sources are
 * used without their extension. Null when every source is missing or generic.
 */
export function canonicalImportTitle(sources: ImportTitleSources): { title: string; source: ImportTitleSource; descriptive: boolean } | null {
  for (const key of ORDER) {
    const raw = sources[key]
    if (typeof raw !== "string") continue
    let decoded = raw
    if (key === "urlFilename") {
      try {
        decoded = decodeURIComponent(raw)
      } catch {
        decoded = raw
      }
    }
    // A "title" that is really a filename ("report.pdf") names a file, not the media.
    const descriptive = DESCRIPTIVE.has(key) && !FILE_LIKE.test(decoded.trim())
    const text = cleanImportTitle(descriptive ? decoded : titleStem(decoded))
    if (text && !isGenericImportTitle(text)) return { title: text, source: key, descriptive }
  }
  return null
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Cut to at most `maxBytes` of UTF-8 without splitting a character. */
function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8Length(text) <= maxBytes) return text
  let out = ""
  let bytes = 0
  for (const ch of Array.from(text)) {
    const n = utf8Length(ch)
    if (bytes + n > maxBytes) break
    out += ch
    bytes += n
  }
  return out
}

/** A safe extension: letters and digits only, lower case, bounded. Empty when there is none. */
export function safeImportExtension(raw: string | null | undefined): string {
  const ext = (raw ?? "").replace(/^\./, "").toLowerCase()
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : ""
}

/**
 * A title made into a filename that is safe on every common filesystem and
 * still reads like the title:
 *  - readable Unicode (accents, CJK, emoji) is kept;
 *  - control and bidi-override characters are removed;
 *  - path separators become " - ", so no title can name a directory;
 *  - `..` cannot survive, and no name starts with a dot;
 *  - Windows-reserved characters (<>:"|?*) are replaced, reserved device
 *    names (CON, NUL, COM1…) are suffixed;
 *  - trailing spaces and dots are trimmed;
 *  - the stem is bounded to IMPORT_FILENAME_STEM_MAX_BYTES of UTF-8;
 *  - the real extension is appended, and the result is never empty.
 */
export function sanitizeImportFilename(title: string | null | undefined, extension: string | null | undefined): string {
  const ext = safeImportExtension(extension)
  let stem = (cleanImportTitle(title) ?? "")
    .replace(/[\\/]+/g, " - ")
    .replace(/:/g, " -")
    .replace(/[<>"|?*]+/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/(\s-){2,}/g, " -")
    .trim()
  // A title ending in its own extension ("clip.mp4" for an mp4) is not doubled.
  if (ext && stem.toLowerCase().endsWith(`.${ext}`)) stem = stem.slice(0, -(ext.length + 1))
  stem = stem.replace(/^[.\s-]+/, "").replace(/[.\s]+$/, "")
  stem = truncateUtf8(stem, IMPORT_FILENAME_STEM_MAX_BYTES).replace(/[.\s-]+$/, "")
  if (!stem) stem = IMPORT_FALLBACK_STEM
  if (WINDOWS_RESERVED.test(stem)) stem = `${stem}_`
  return ext ? `${stem}.${ext}` : stem
}

/** Title text from an HTML <title>, decoded and without a trailing " - Site" / " | Site". */
export function htmlTitleText(html: string, decode: (value: string) => string = (v) => v): string | null {
  const match = /<title[^>]*>([\s\S]{1,1000}?)<\/title>/i.exec(html)
  if (!match?.[1]) return null
  const text = cleanImportTitle(decode(match[1]))
  if (!text) return null
  const parts = text.split(/\s+[|–—-]\s+/)
  return parts.length > 1 && parts[0]!.length >= 3 ? parts.slice(0, -1).join(" - ") : text
}
