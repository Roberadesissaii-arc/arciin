import { Clock3 } from "lucide-react"

import { mediaTypeIcons } from "@/lib/utils/file-icons"
import { formatRelativeDate } from "@/lib/utils/format-date"
import type { ActivitySummary } from "@/lib/types/models"

export function ActivityItem({ event }: { event: ActivitySummary }) {
  const mediaType =
    typeof event.metadata?.mediaType === "string"
      ? (event.metadata.mediaType as
          | "VIDEO"
          | "IMAGE"
          | "AUDIO"
          | "DOCUMENT"
          | "ARCHIVE"
          | "OTHER")
      : "OTHER"
  const EventIcon = mediaTypeIcons[mediaType] || mediaTypeIcons.DEFAULT

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-3">
      <div className="mt-0.5 flex size-9 items-center justify-center rounded-xl bg-white/[0.04] text-zinc-300">
        <EventIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white">{event.title}</div>
        {event.message ? (
          <div className="mt-1 text-sm leading-6 text-zinc-400">{event.message}</div>
        ) : null}
      </div>
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        <Clock3 className="size-3.5" />
        {formatRelativeDate(event.createdAt)}
      </div>
    </div>
  )
}
