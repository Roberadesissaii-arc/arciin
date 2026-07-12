"use client"

import { formatMediaDuration } from "@/lib/utils/format-duration"
import { cn } from "@/lib/utils"

/** Bottom-right duration chip for video thumbnails. */
export function VideoDurationBadge({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <span
      data-preview-chrome
      className={cn(
        "pointer-events-none absolute bottom-1 right-1 z-20 rounded-xl bg-black/75 px-1.5 py-0.5",
        "text-[10px] font-semibold leading-none tabular-nums text-white shadow-sm",
        className,
      )}
    >
      {label}
    </span>
  )
}

export function videoDurationLabel(seconds: number | null | undefined): string | null {
  return formatMediaDuration(seconds)
}
