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

export function getFileExtension(filename: string) {
  const parts = filename.split(".")
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() ?? "" : ""
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

  if (documentMimeTypes.has(mimeType ?? "") || documentExtensions.has(extension)) {
    return "DOCUMENT"
  }

  if (archiveExtensions.has(extension)) {
    return "ARCHIVE"
  }

  return "OTHER"
}
