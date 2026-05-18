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

  return "OTHER"
}
