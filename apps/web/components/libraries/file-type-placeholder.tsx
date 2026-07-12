"use client"

import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { cn } from "@/lib/utils"
import type { MediaType } from "@/lib/types/models"

/**
 * Dark, cinematic placeholder for files that can't render a real thumbnail
 * (installers, archives, code, unclassified) — matches the audio artwork
 * treatment instead of a flat white box with a tiny icon.
 */
export function FileTypePlaceholder({
  mediaType,
  filename,
  mimeType,
  extension,
  loading = false,
  className,
  iconClassName,
}: {
  mediaType: MediaType
  filename?: string | null
  mimeType?: string | null
  extension?: string | null
  loading?: boolean
  className?: string
  iconClassName?: string
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden border border-border bg-zinc-950 shadow-inner",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_50%_30%,rgba(255,79,18,0.16),transparent_65%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
        aria-hidden
      />
      <MediaTypeIcon
        mediaType={mediaType}
        filename={filename}
        mimeType={mimeType}
        extension={extension}
        className={cn(
          "relative z-10 size-8 text-white/70",
          loading && "arciin-doc-icon-pulse",
          iconClassName,
        )}
      />
    </div>
  )
}
