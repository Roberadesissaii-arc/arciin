import {
  AppWindow,
  Archive,
  FileAudio2,
  FileCode2,
  FileImage,
  FileText,
  Film,
  Inbox,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { MediaType } from "@/lib/types/models"
import { resolveDisplayMediaType } from "@/lib/utils/media-type"

type MediaTypeIconProps = {
  mediaType: MediaType
  filename?: string | null
  mimeType?: string | null
  extension?: string | null
  className?: string
}

export function MediaTypeIcon({
  mediaType,
  filename,
  mimeType,
  extension,
  className,
}: MediaTypeIconProps) {
  const resolved = resolveDisplayMediaType(mediaType, { filename, mimeType, extension })
  const iconClass = cn(className)

  switch (resolved) {
    case "VIDEO":
      return <Film className={iconClass} aria-hidden />
    case "IMAGE":
      return <FileImage className={iconClass} aria-hidden />
    case "AUDIO":
      return <FileAudio2 className={iconClass} aria-hidden />
    case "DOCUMENT":
      return <FileText className={iconClass} aria-hidden />
    case "ARCHIVE":
      return <Archive className={iconClass} aria-hidden />
    case "APPLICATION":
      return <AppWindow className={iconClass} aria-hidden />
    case "CODE":
      return <FileCode2 className={iconClass} aria-hidden />
    default:
      return <Inbox className={iconClass} aria-hidden />
  }
}
