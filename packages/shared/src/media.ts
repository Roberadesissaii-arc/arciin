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

  if (mimeType === "application/pdf" || documentExtensions.has(extension)) {
    return "DOCUMENT"
  }

  if (archiveExtensions.has(extension)) {
    return "ARCHIVE"
  }

  return "OTHER"
}
