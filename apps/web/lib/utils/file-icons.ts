import type { LucideIcon } from "lucide-react"
import {
  AppWindow,
  Archive,
  FileAudio2,
  FileCode2,
  FileImage,
  FileText,
  Film,
  Inbox,
  Monitor,
} from "lucide-react"

import type { LibraryKind, MediaType } from "@/lib/types/models"
import { resolveDisplayMediaType } from "@/lib/utils/media-type"

export const mediaTypeIcons: Record<MediaType | "DEFAULT", LucideIcon> = {
  VIDEO: Film,
  IMAGE: FileImage,
  AUDIO: FileAudio2,
  DOCUMENT: FileText,
  ARCHIVE: Archive,
  APPLICATION: AppWindow,
  CODE: FileCode2,
  OTHER: Inbox,
  DEFAULT: Inbox,
}

export const libraryKindIcons: Record<LibraryKind | "DEFAULT", LucideIcon> = {
  VIDEO: Film,
  IMAGE: FileImage,
  AUDIO: FileAudio2,
  DOCUMENT: FileText,
  INBOX: Inbox,
  CUSTOM: AppWindow,
  COMPUTER: Monitor,
  DEFAULT: Inbox,
}

type MediaTypeIconOptions = {
  filename?: string | null
  mimeType?: string | null
  extension?: string | null
}

/** Resolves installers (.exe, .msi, .bat, …) to APP icon; true OTHER uses inbox tray. */
export function getMediaTypeIcon(
  mediaType: MediaType,
  options?: MediaTypeIconOptions,
): LucideIcon {
  const resolved = resolveDisplayMediaType(mediaType, options)
  return mediaTypeIcons[resolved] ?? mediaTypeIcons.DEFAULT
}

export function getAssetMediaTypeIcon(asset: {
  mediaType: MediaType
  originalFilename: string
  mimeType?: string | null
  extension?: string | null
}): LucideIcon {
  return getMediaTypeIcon(asset.mediaType, {
    filename: asset.originalFilename,
    mimeType: asset.mimeType,
    extension: asset.extension,
  })
}

export function getLibraryIcon(library: { kind: LibraryKind; slug: string }): LucideIcon {
  if (library.slug === "inbox") return Inbox
  return libraryKindIcons[library.kind] ?? libraryKindIcons.DEFAULT
}
