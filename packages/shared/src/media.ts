export const documentExtensions = new Set([
  "pdf",
  "doc",
  "docx",
  "txt",
  "rtf",
  "md",
  "odt",
  "csv",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "pages",
  "numbers",
  "key",
  "epub",
])

const documentMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/epub+zip",
  "text/plain",
  "text/csv",
  "text/rtf",
  "application/rtf",
])

export const archiveExtensions = new Set(["zip", "rar", "7z", "tar", "gz"])

const imageExtensions = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
  "heic",
  "heif",
  "tiff",
  "tif",
  "ico",
])

const videoExtensions = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "mpeg",
  "mpg",
  "3gp",
])

const audioExtensions = new Set(["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma"])

/** Source code and plain-text scripts (.py, .js, .ts, etc.). */
export const codeExtensions = new Set([
  "py",
  "pyw",
  "pyi",
  "ipynb",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "json",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hpp",
  "cs",
  "php",
  "rb",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "sql",
  "yaml",
  "yml",
  "toml",
  "xml",
  "swift",
  "r",
  "lua",
  "pl",
  "scala",
  "zig",
  "dart",
  "ex",
  "exs",
  "erl",
  "hs",
  "clj",
  "cljs",
  "dockerfile",
  "makefile",
  "cmake",
  "gradle",
  "env",
  "ini",
  "cfg",
  "conf",
])

const codeMimePrefixes = ["text/x-", "text/plain", "application/javascript", "application/typescript", "application/json", "application/xml"]

export function isCodeFilename(filename?: string | null): boolean {
  if (!filename) return false
  const ext = getFileExtension(filename)
  if (codeExtensions.has(ext)) return true
  const base = filename.split(/[/\\]/).pop()?.toLowerCase() ?? ""
  if (base === "dockerfile" || base === "makefile" || base.startsWith(".env")) return true
  return false
}

/** Installers, executables, disk images, and setup scripts. */
export const applicationExtensions = new Set([
  "exe",
  "msi",
  "msix",
  "msp",
  "msu",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "appimage",
  "apk",
  "bat",
  "cmd",
  "com",
  "scr",
  "app",
  "iso",
  "img",
])

const applicationMimeTypes = new Set([
  "application/vnd.microsoft.portable-executable",
  "application/x-msdownload",
  "application/x-msi",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-dosexec",
  "application/vnd.appimage",
  "application/vnd.debian.binary-package",
  "application/vnd.apple.installer+xml",
  "application/x-apple-diskimage",
  "application/x-iso9660-image",
])

export function getFileExtension(filename: string) {
  const parts = filename.split(".")
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() ?? "" : ""
}

const inlineMimeByExt: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ogv: "video/ogg",
  "3gp": "video/3gpp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/opus",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  py: "text/x-python",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/typescript",
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  css: "text/css",
}

/** Prefer a browser-playable MIME when the stored type is generic. */
export function resolveInlineContentType(
  mimeType: string | null | undefined,
  originalFilename: string,
): string {
  const stored = (mimeType ?? "").trim()
  if (stored && stored !== "application/octet-stream") {
    return stored
  }
  const ext = getFileExtension(originalFilename)
  return inlineMimeByExt[ext] ?? (stored || "application/octet-stream")
}

export function isApplicationFile(
  filename?: string | null,
  extension?: string | null,
): boolean {
  const ext = (extension?.replace(/^\./, "").toLowerCase() ||
    (filename ? getFileExtension(filename) : "")) as string
  return applicationExtensions.has(ext)
}

export function inferMediaType(mimeType?: string | null, filename?: string | null) {
  const extension = filename ? getFileExtension(filename) : ""

  if (mimeType?.startsWith("video/")) {
    return "VIDEO"
  }

  if (mimeType?.startsWith("image/")) {
    return "IMAGE"
  }

  if (mimeType?.startsWith("audio/")) {
    return "AUDIO"
  }

  // Extension wins over generic text/plain (e.g. .bat installers).
  if (isApplicationFile(filename, extension)) {
    return "APPLICATION"
  }

  if (documentMimeTypes.has(mimeType ?? "") || documentExtensions.has(extension)) {
    return "DOCUMENT"
  }

  if (archiveExtensions.has(extension)) {
    return "ARCHIVE"
  }

  if (
    applicationMimeTypes.has(mimeType ?? "") ||
    (mimeType === "application/octet-stream" && applicationExtensions.has(extension))
  ) {
    return "APPLICATION"
  }

  // Phones often send empty or generic MIME; extension is reliable for media routing.
  if (imageExtensions.has(extension)) {
    return "IMAGE"
  }

  if (videoExtensions.has(extension)) {
    return "VIDEO"
  }

  if (audioExtensions.has(extension)) {
    return "AUDIO"
  }

  if (
    codeExtensions.has(extension) ||
    isCodeFilename(filename) ||
    codeMimePrefixes.some((p) => (mimeType ?? "").startsWith(p)) ||
    mimeType === "text/plain" ||
    mimeType === "application/x-python-code"
  ) {
    return "CODE"
  }

  return "OTHER"
}

/**
 * ISO base media file format containers (MP4/MOV/M4A/3GP). One container can
 * hold audio-only, video-only, or both, and magic-byte sniffing reports the
 * *container*, not the payload — an audio-only .m4a with an `ftyp` brand of
 * `dash`/`isom`/`mp42` sniffs as `video/mp4`. Classification for these must be
 * settled by inspecting the stream list, never by the container MIME alone.
 */
const isoMediaContainerMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/3gpp",
  "video/3gpp2",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
])

export function isIsoMediaContainerMime(mimeType?: string | null): boolean {
  return isoMediaContainerMimeTypes.has((mimeType ?? "").toLowerCase())
}

/** What ffprobe found in the container. Null means inspection failed. */
export type MediaStreamSummary = {
  hasVideoStream: boolean
  hasAudioStream: boolean
}

/**
 * Reduce an ffprobe stream list to the audio/video question classification
 * asks. Shared so the API and the worker apply identical rules.
 *
 * Embedded cover art is carried as a still video stream with
 * `disposition.attached_pic = 1`; counting it as video is what makes an
 * album-art MP3/M4A look like a movie, so it is deliberately ignored.
 */
export function summarizeMediaStreams(
  streams: Array<Record<string, unknown>> | undefined | null,
): MediaStreamSummary | null {
  if (!streams) return null

  return {
    hasVideoStream: streams.some((stream) => {
      if (stream.codec_type !== "video") return false
      const disposition = stream.disposition as Record<string, unknown> | undefined
      return disposition?.attached_pic !== 1
    }),
    hasAudioStream: streams.some((stream) => stream.codec_type === "audio"),
  }
}

/** Audio extensions that stay meaningful when we relabel a container as audio. */
const preservableAudioExtensions = new Set(["m4a", "m4b", "aac", "mp4a"])

const audioMimeByExtension: Record<string, string> = {
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  aac: "audio/aac",
  mp4a: "audio/mp4",
}

export type IsoMediaClassification = {
  mediaType: ReturnType<typeof inferMediaType>
  mimeType: string
  extension: string
}

/**
 * Settle VIDEO-vs-AUDIO for an ISO media container using its stream list.
 *
 * Pure and synchronous: the caller runs ffprobe (API and worker each have their
 * own copy) and passes the summary in, so both sides reach the same verdict
 * from the same rules. Returns the input unchanged whenever the container is
 * not ISO media, inspection failed, or the streams are inconclusive — a probe
 * failure must never reclassify a file.
 */
export function refineIsoMediaClassification(input: {
  mediaType: string
  mimeType: string
  extension: string
  originalFilename?: string | null
  streams: MediaStreamSummary | null
}): IsoMediaClassification {
  const unchanged = {
    mediaType: input.mediaType as IsoMediaClassification["mediaType"],
    mimeType: input.mimeType,
    extension: input.extension,
  }

  if (!isIsoMediaContainerMime(input.mimeType)) return unchanged
  if (!input.streams) return unchanged

  const { hasVideoStream, hasAudioStream } = input.streams

  // A video stream is decisive — even a container labelled audio/* is video.
  if (hasVideoStream) {
    return { ...unchanged, mediaType: "VIDEO" }
  }

  // Audio-only: relabel so it routes to Music and keeps a playable audio MIME.
  if (hasAudioStream) {
    const nameExtension = input.originalFilename
      ? getFileExtension(input.originalFilename)
      : ""
    const extension = preservableAudioExtensions.has(nameExtension)
      ? nameExtension
      : preservableAudioExtensions.has(input.extension)
        ? input.extension
        : "m4a"

    return {
      mediaType: "AUDIO",
      mimeType: audioMimeByExtension[extension] ?? "audio/mp4",
      extension,
    }
  }

  // Neither stream type (corrupt or unreadable) — keep the original verdict.
  return unchanged
}

/** PDFs eligible for first-page thumbnail generation (ffmpeg). */
export function assetSupportsDocumentThumbnail(
  mediaType: string,
  mimeType?: string | null,
  extension?: string | null,
  originalFilename?: string | null,
): boolean {
  const mime = (mimeType ?? "").toLowerCase()
  if (mime === "application/pdf") return true

  const ext = (extension ?? "").toLowerCase()
  if (ext === "pdf") return true

  const name = (originalFilename ?? "").toLowerCase()
  if (name.endsWith(".pdf")) return true

  if (mediaType === "DOCUMENT" && mime.includes("pdf")) return true

  return false
}

// ---------------------------------------------------------------------------
// Upload routing
// ---------------------------------------------------------------------------

/**
 * Whether a library is a sensible home for a given media type.
 *
 * CUSTOM accepts anything: it has no declared type, and filing into one is a
 * deliberate choice worth honouring.
 *
 * INBOX does not. Inbox is where a file lands when Arciin *cannot* tell what
 * it is — the documented routing is image → Images, video → Videos, unknown →
 * Inbox. Treating it as a catch-all meant that standing on the Inbox page
 * silently turned auto-organise off: drop a photo there and it stayed there,
 * while the same photo dropped on Videos was rerouted to Images. A recognised
 * file gets filed by what it is, wherever you happened to be standing.
 */
export function libraryAcceptsMediaType(
  libraryKind: string | null | undefined,
  mediaType: string,
): boolean {
  switch (libraryKind) {
    case "VIDEO":
      return mediaType === "VIDEO"
    case "IMAGE":
      return mediaType === "IMAGE"
    case "AUDIO":
      return mediaType === "AUDIO"
    case "DOCUMENT":
      return mediaType === "DOCUMENT"
    case "INBOX":
      // Only what nothing else claims.
      return libraryKindForMediaType(mediaType) === "INBOX"
    case "CUSTOM":
    case "COMPUTER":
      return true
    default:
      // Unknown kind: don't reroute on a guess.
      return true
  }
}

/** The library kind a media type belongs in when nothing else is specified. */
export function libraryKindForMediaType(mediaType: string): string {
  switch (mediaType) {
    case "VIDEO":
      return "VIDEO"
    case "IMAGE":
      return "IMAGE"
    case "AUDIO":
      return "AUDIO"
    case "DOCUMENT":
      return "DOCUMENT"
    default:
      // ARCHIVE, APPLICATION, CODE and OTHER have no dedicated library.
      return "INBOX"
  }
}

export type UploadRouteDecision = {
  /** Library kind the upload should actually land in. */
  libraryKind: string
  /** True when the requested library was overridden. */
  rerouted: boolean
  /**
   * True when a requested folder must be dropped.
   *
   * A folder belongs to exactly one library, so rerouting the library makes
   * the folder invalid — keeping it would either fail a foreign-key check or
   * file the asset somewhere unreachable from both library views.
   */
  dropFolder: boolean
}

/**
 * Decide where an upload lands when the requested library disagrees with what
 * the file actually is.
 *
 * An `.apk` dropped while browsing Videos was filed under Videos: the explicit
 * target won outright and nothing checked that a VIDEO library has no business
 * holding an Android package. The type is detected from content, so it is
 * better evidence than which page happened to be open.
 *
 * Rerouting only happens on a genuine mismatch. Anything dropped into Inbox or
 * a custom library stays put, so deliberate filing is never second-guessed.
 */
export function resolveUploadRoute(input: {
  mediaType: string
  requestedLibraryKind?: string | null
  hasRequestedFolder?: boolean
}): UploadRouteDecision {
  const requested = input.requestedLibraryKind

  if (!requested) {
    return { libraryKind: libraryKindForMediaType(input.mediaType), rerouted: false, dropFolder: false }
  }

  if (libraryAcceptsMediaType(requested, input.mediaType)) {
    return { libraryKind: requested, rerouted: false, dropFolder: false }
  }

  return {
    libraryKind: libraryKindForMediaType(input.mediaType),
    rerouted: true,
    dropFolder: Boolean(input.hasRequestedFolder),
  }
}
