"use client"

import {
  ArrowRight,
  FileText,
  Globe,
  Image as ImageIcon,
  Link2,
  Music2,
  Package,
  Video,
  type LucideIcon,
} from "lucide-react"

import { SourceBrandMark } from "@/components/shared/source-brand-mark"
import { Badge } from "@/components/ui/badge"
import {
  analyzeImportLink,
  linkSupportsFormatOptions,
  type LinkContentCategory,
} from "@/lib/utils/link-import-preview"
import { cn } from "@/lib/utils"

/** Fixed inspect area — empty and detected states share this footprint. */
export const IMPORT_LINK_INSPECT_SLOT_HEIGHT = "h-[132px]"

const CATEGORY_ICONS: Record<LinkContentCategory, LucideIcon> = {
  video: Video,
  audio: Music2,
  image: ImageIcon,
  document: FileText,
  product: Package,
  gallery: ImageIcon,
  social: Globe,
  "direct-file": FileText,
  web: Globe,
}

type ImportLinkInspectSlotProps = {
  url: string
  className?: string
}

/** Always the same size — shows placeholder or compact detected link info inside. */
export function ImportLinkInspectSlot({ url, className }: ImportLinkInspectSlotProps) {
  const preview = url.trim() ? analyzeImportLink(url) : null
  const CategoryIcon = preview ? CATEGORY_ICONS[preview.category] : Link2

  return (
    <div
      className={cn(
        IMPORT_LINK_INSPECT_SLOT_HEIGHT,
        "relative overflow-hidden rounded-xl border p-3",
        preview
          ? "border-border bg-white"
          : "border-dashed border-border bg-muted/15",
        className,
      )}
      style={
        preview
          ? {
              backgroundImage: `linear-gradient(135deg, ${preview.source.color}14 0%, rgb(255 255 255) 68%)`,
            }
          : undefined
      }
      aria-live="polite"
    >
      {!preview ? (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Link2 className="size-4" />
          </span>
          <p className="mt-2 text-[13px] font-medium text-foreground">Paste a link to inspect it</p>
          <p className="mt-0.5 max-w-[15rem] truncate text-[11px] text-muted-foreground">
            YouTube, SoundCloud, Vimeo, TikTok, PDFs, images…
          </p>
        </div>
      ) : (
        <div className="flex h-full w-full flex-col justify-center gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <SourceBrandMark
              sourceKey={preview.source.key}
              brandColor={preview.source.color}
              label={preview.source.label}
            />

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[14px] font-semibold text-foreground">
                  {preview.source.label}
                </span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "h-5 shrink-0 px-1.5 text-[10px] font-semibold uppercase",
                    preview.importBlocked && "bg-amber-100 text-amber-800",
                  )}
                >
                  {preview.importBlocked ? "DRM" : preview.categoryLabel}
                </Badge>
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{preview.hostname}</p>
            </div>
          </div>

          <div className="grid grid-cols-[1rem_1fr] items-center gap-x-2 gap-y-1 text-[11px]">
            <CategoryIcon className="size-3.5 text-primary" />
            <p className="truncate text-muted-foreground">
              {preview.importBlocked ? (
                <span className="font-semibold text-amber-800">Cannot import</span>
              ) : (
                <>
                  Files into{" "}
                  <span className="font-semibold text-foreground">{preview.destinationLibrary}</span>
                </>
              )}
            </p>
            <ArrowRight className="size-3.5 text-muted-foreground" />
            <p className="truncate text-muted-foreground">{preview.importMethod}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export { linkSupportsFormatOptions }
