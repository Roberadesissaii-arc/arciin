import {
  FileAudio2,
  FileImage,
  FileText,
  Film,
  Inbox,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { LibraryKind } from "@/lib/types/models"

export function LibrarySlugIcon({
  slug,
  kind,
  className,
}: {
  slug: string
  kind: LibraryKind
  className?: string
}) {
  const iconClass = cn(className)

  if (slug === "inbox") return <Inbox className={iconClass} aria-hidden />
  if (slug === "videos" || kind === "VIDEO") return <Film className={iconClass} aria-hidden />
  if (slug === "images" || kind === "IMAGE") return <FileImage className={iconClass} aria-hidden />
  if (slug === "music" || kind === "AUDIO") return <FileAudio2 className={iconClass} aria-hidden />
  if (slug === "documents" || kind === "DOCUMENT") return <FileText className={iconClass} aria-hidden />

  return <Inbox className={iconClass} aria-hidden />
}
