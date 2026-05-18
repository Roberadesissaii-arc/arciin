import type { LucideIcon } from "lucide-react"
import {
  AppWindow,
  Archive,
  FileAudio2,
  FileImage,
  FileText,
  Film,
  Inbox,
} from "lucide-react"

import type { LibraryKind, MediaType } from "@/lib/types/models"

export const mediaTypeIcons: Record<MediaType | "DEFAULT", LucideIcon> = {
  VIDEO: Film,
  IMAGE: FileImage,
  AUDIO: FileAudio2,
  DOCUMENT: FileText,
  ARCHIVE: Archive,
  APPLICATION: AppWindow,
  OTHER: Inbox,
  DEFAULT: Inbox,
}

export const libraryKindIcons: Record<LibraryKind | "DEFAULT", LucideIcon> = {
  VIDEO: Film,
  IMAGE: FileImage,
  AUDIO: FileAudio2,
  DOCUMENT: FileText,
  INBOX: Inbox,
  CUSTOM: Inbox,
  DEFAULT: Inbox,
}
