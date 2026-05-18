import { inferMediaType, isApplicationFile } from "@arciin/shared"

import type { LibraryKind, MediaType } from "@/lib/types/models"

export function resolveDisplayMediaType(
  mediaType: MediaType,
  options?: { filename?: string | null; mimeType?: string | null; extension?: string | null },
): MediaType {
  if (mediaType === "APPLICATION") return "APPLICATION"
  if (isApplicationFile(options?.filename, options?.extension)) return "APPLICATION"
  if (
    options?.filename &&
    inferMediaType(options.mimeType, options.filename) === "APPLICATION"
  ) {
    return "APPLICATION"
  }
  return mediaType
}

export function formatMediaTypeLabel(
  mediaType: MediaType,
  options?: { filename?: string | null; mimeType?: string | null; extension?: string | null },
): string {
  const resolved = resolveDisplayMediaType(mediaType, options)
  if (resolved === "APPLICATION") return "APP"
  return resolved
}

export function classifyMediaType(mimeType?: string | null, filename?: string | null): MediaType {
  return inferMediaType(mimeType, filename) as MediaType
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
