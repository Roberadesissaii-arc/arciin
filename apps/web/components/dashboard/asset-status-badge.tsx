import { cn } from "@/lib/utils"
import type { AssetStatus } from "@/lib/types/models"

const STATUS_STYLES: Record<
  AssetStatus,
  { label: string; className: string }
> = {
  UPLOADING: {
    label: "Uploading",
    className: "bg-[var(--arciin-accent-badge-bg)] text-[var(--arciin-accent)]",
  },
  PROCESSING: {
    label: "Processing",
    className: "bg-amber-50 text-amber-800",
  },
  READY: {
    label: "Ready",
    className: "bg-emerald-50 text-emerald-700",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-50 text-red-700",
  },
  DELETED: {
    label: "Deleted",
    className: "bg-zinc-100 text-zinc-500",
  },
}

export function AssetStatusBadge({
  status,
  className,
}: {
  status: AssetStatus
  className?: string
}) {
  const config = STATUS_STYLES[status] ?? {
    label: status,
    className: "bg-zinc-100 text-zinc-600",
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  )
}
