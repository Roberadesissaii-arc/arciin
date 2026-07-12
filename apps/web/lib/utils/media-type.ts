import { inferMediaType, isApplicationFile, isCodeFilename } from "@arciin/shared"

import type { LibraryKind, MediaType } from "@/lib/types/models"

export function resolveDisplayMediaType(
  mediaType: MediaType,
  options?: { filename?: string | null; mimeType?: string | null; extension?: string | null },
): MediaType {
  if (mediaType === "APPLICATION") return "APPLICATION"
  if (mediaType === "CODE") return "CODE"
  if (isApplicationFile(options?.filename, options?.extension)) return "APPLICATION"
  if (isCodeFilename(options?.filename)) return "CODE"
  if (options?.filename) {
    const inferred = inferMediaType(options.mimeType, options.filename)
    if (inferred === "APPLICATION") return "APPLICATION"
    if (inferred === "CODE") return "CODE"
  }
  return mediaType
}

export function formatMediaTypeLabel(
  mediaType: MediaType,
  options?: { filename?: string | null; mimeType?: string | null; extension?: string | null },
): string {
  const resolved = resolveDisplayMediaType(mediaType, options)
  if (resolved === "APPLICATION") return "APP"
  if (resolved === "CODE") return "CODE"
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
    case "CODE":
      return "Code"
    default:
      return "Inbox"
  }
}

/** Infer media type from queue destination label when mime/filename are not enough (link imports). */
export function mediaTypeFromDestinationLabel(destination?: string | null): MediaType | null {
  const normalized = destination?.trim().toLowerCase()
  if (!normalized) return null

  switch (normalized) {
    case "videos":
    case "video":
      return "VIDEO"
    case "images":
    case "image":
      return "IMAGE"
    case "music":
    case "audio":
      return "AUDIO"
    case "documents":
    case "document":
      return "DOCUMENT"
    case "applications":
    case "application":
      return "APPLICATION"
    case "code":
      return "CODE"
    default:
      return null
  }
}
