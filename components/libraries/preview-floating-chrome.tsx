"use client"

import {
  Bookmark,
  BookmarkCheck,
  Download,
  Maximize2,
  Minimize2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  canPreviewZoomIn,
  canPreviewZoomOut,
  previewZoomPercent,
  type PreviewZoomIndex,
} from "@/lib/files/preview-zoom"
import { cn } from "@/lib/utils"

const GLASS =
  "border border-white/10 bg-zinc-950/70 text-zinc-100 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl"

const ICON_BTN =
  "size-9 shrink-0 rounded-lg border border-transparent bg-transparent text-zinc-200 shadow-none transition-colors hover:!border-[#ff4f12]/40 hover:!bg-zinc-950/90 hover:!text-zinc-100"

export function PreviewFloatingChrome({
  onClose,
  showZoom,
  zoomIndex,
  onZoomIn,
  onZoomOut,
  showBookmark,
  pageBookmarked,
  onToggleBookmark,
  embedded,
  onExpand,
  onShrink,
  downloadHref,
  meta,
}: {
  onClose: () => void
  showZoom?: boolean
  zoomIndex?: PreviewZoomIndex
  onZoomIn?: () => void
  onZoomOut?: () => void
  showBookmark?: boolean
  pageBookmarked?: boolean
  onToggleBookmark?: () => void
  embedded?: boolean
  onExpand?: () => void
  onShrink?: () => void
  downloadHref: string
  meta?: string
}) {
  const zoomPct =
    showZoom && zoomIndex !== undefined ? previewZoomPercent(zoomIndex) : null

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(GLASS, ICON_BTN, "absolute left-4 top-4 z-30 rounded-xl")}
        onClick={onClose}
        aria-label="Close preview"
      >
        <X className="size-4" />
      </Button>

      <div
        className={cn(
          GLASS,
          "absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl px-1 py-0.5",
        )}
      >
        {showZoom && zoomIndex !== undefined && onZoomIn && onZoomOut ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ICON_BTN}
              onClick={onZoomOut}
              disabled={!canPreviewZoomOut(zoomIndex)}
              aria-label="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span
              className="min-w-[3rem] px-1 text-center text-[11px] font-semibold tabular-nums text-zinc-300"
              aria-live="polite"
            >
              {zoomPct}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ICON_BTN}
              onClick={onZoomIn}
              disabled={!canPreviewZoomIn(zoomIndex)}
              aria-label="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>
            <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />
          </>
        ) : null}

        {showBookmark && onToggleBookmark ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              ICON_BTN,
              pageBookmarked &&
                "border-[#ff4f12]/35 bg-[#ff4f12]/20 text-[#ff6a33] hover:border-[#ff4f12]/45 hover:bg-[#ff4f12]/30 hover:text-white",
            )}
            onClick={onToggleBookmark}
            aria-label={pageBookmarked ? "Remove bookmark for this page" : "Bookmark this page"}
            aria-pressed={pageBookmarked}
            title={pageBookmarked ? "Bookmarked — click to remove" : "Bookmark this page"}
          >
            {pageBookmarked ? (
              <BookmarkCheck className="size-4 text-[#ff4f12]" />
            ) : (
              <Bookmark className="size-4" />
            )}
          </Button>
        ) : null}

        {embedded && onExpand ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={ICON_BTN}
            onClick={onExpand}
            aria-label="Expand to full screen"
          >
            <Maximize2 className="size-4" />
          </Button>
        ) : null}
        {!embedded && onShrink ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={ICON_BTN}
            onClick={onShrink}
            aria-label="Dock in dashboard"
          >
            <Minimize2 className="size-4" />
          </Button>
        ) : null}

        <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

        <Button asChild variant="ghost" size="icon" className={ICON_BTN}>
          <a href={downloadHref} download aria-label="Download file">
            <Download className="size-4" />
          </a>
        </Button>
      </div>

      {meta ? (
        <p
          className={cn(
            GLASS,
            "pointer-events-none absolute bottom-5 left-1/2 z-20 max-w-[min(92vw,36rem)] -translate-x-1/2 truncate rounded-full px-4 py-1.5 text-center text-[11px] tabular-nums text-zinc-400",
          )}
        >
          {meta}
        </p>
      ) : null}
    </>
  )
}
