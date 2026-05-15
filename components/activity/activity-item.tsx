import { Clock3, FileText, Folder, Key, Library, Upload, Zap } from "lucide-react"

import { formatRelativeDate } from "@/lib/utils/format-date"
import type { ActivitySummary } from "@/lib/types/models"

// ── Icon + colour per entity type ─────────────────────────────────────────────

const ENTITY_CONFIG: Record<
  string,
  { icon: React.ElementType }
> = {
  asset:     { icon: FileText },
  upload:    { icon: Upload   },
  folder:    { icon: Folder   },
  library:   { icon: Library  },
  "api-key": { icon: Key      },
}

function getIcon(event: ActivitySummary) {
  const key = event.entityType ?? event.type.split(".")[0] ?? ""
  return (ENTITY_CONFIG[key] ?? { icon: Zap }).icon
}

// ── Type label ────────────────────────────────────────────────────────────────

function typeLabel(type: string) {
  const parts = type.split(".")
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" · ")
}

// ── Item ──────────────────────────────────────────────────────────────────────

export function ActivityItem({ event }: { event: ActivitySummary }) {
  const Icon = getIcon(event)

  return (
    <div className="flex items-start gap-3.5 px-5 py-3.5">
      {/* icon */}
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-[rgba(255,79,18,0.18)] bg-[rgba(255,79,18,0.08)] text-primary">
        <Icon className="size-3.5" />
      </div>

      {/* content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-foreground">{event.title}</span>
          <span className="text-[11px] font-medium text-zinc-400">{typeLabel(event.type)}</span>
        </div>
        {event.message && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{event.message}</p>
        )}
      </div>

      {/* timestamp */}
      <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-zinc-400">
        <Clock3 className="size-3 shrink-0" />
        {formatRelativeDate(event.createdAt)}
      </div>
    </div>
  )
}
