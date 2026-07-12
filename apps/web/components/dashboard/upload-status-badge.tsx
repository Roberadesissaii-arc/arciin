import { cn } from "@/lib/utils"
import type { UploadStatus } from "@/lib/types/models"

const STATUS_STYLES: Record<
  UploadStatus,
  { label: string; className: string }
> = {
  QUEUED: {
    label: "Queued",
    className: "bg-zinc-100 text-zinc-600",
  },
  UPLOADING: {
    label: "Uploading",
    className: "bg-[var(--arciin-accent-badge-bg)] text-[var(--arciin-accent)]",
  },
  UPLOADED: {
    label: "Uploaded",
    className: "bg-sky-50 text-sky-700",
  },
  ANALYZING: {
    label: "Analyzing",
    className: "bg-violet-50 text-violet-700",
  },
  CLASSIFIED: {
    label: "Classified",
    className: "bg-indigo-50 text-indigo-700",
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
}

export function UploadStatusBadge({
  status,
  className,
}: {
  status: UploadStatus
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
