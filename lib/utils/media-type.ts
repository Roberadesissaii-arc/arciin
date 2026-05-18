import { applicationExtensions, archiveExtensions, getFileExtension } from "@arciin/shared"

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

export function formatMediaTypeLabel(mediaType: MediaType): string {
  if (mediaType === "APPLICATION") return "APP"
  return mediaType
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

  if (
    applicationMimeTypes.has(mimeType ?? "") ||
    applicationExtensions.has(extension) ||
    (mimeType === "application/octet-stream" && applicationExtensions.has(extension))
  ) {
    return "APPLICATION"
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
    case "APPLICATION":
      return "CUSTOM"
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
    case "APPLICATION":
      return "Applications"
    default:
      return "Inbox"
  }
}
