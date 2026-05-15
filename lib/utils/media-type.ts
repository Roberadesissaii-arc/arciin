import type { LibraryKind, MediaType } from "@/lib/types/models"

const documentExtensions = new Set([
  "pdf",
  "doc",
  "docx",
  "txt",
  "rtf",
  "md",
  "odt",
  "xls",
  "xlsx",
  "csv",
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

const archiveExtensions = new Set(["zip", "rar", "7z", "tar", "gz"])

export function getFileExtension(filename: string) {
  const parts = filename.split(".")
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() ?? "" : ""
}

export function classifyMediaType(mimeType?: string | null, filename?: string | null): MediaType {
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

export function mediaTypeToLibraryKind(mediaType: MediaType): LibraryKind {
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
      return "INBOX"
  }
}

export function inferDestinationLabel(mimeType?: string | null, filename?: string | null) {
  const mediaType = classifyMediaType(mimeType, filename)

  switch (mediaType) {
    case "VIDEO":
      return "Videos"
    case "IMAGE":
      return "Images"
    case "AUDIO":
      return "Music"
    case "DOCUMENT":
      return "Documents"
    default:
      return "Inbox"
  }
}
