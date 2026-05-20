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
