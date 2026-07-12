"use client"

import type { ReactNode } from "react"
import {
  Download,
  Maximize2,
  Minimize2,
  Sparkles,
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

const TOOL_BTN =
  "size-8 shrink-0 rounded-lg border border-zinc-700/90 bg-zinc-900/95 text-zinc-200 shadow-sm hover:bg-zinc-800 hover:text-white"

export function PreviewToolbar({
  title,
  meta,
  onClose,
  showZoom,
  zoomIndex,
  onZoomIn,
  onZoomOut,
  canAskAi,
  aiOpen,
  onAiToggle,
  embedded,
  onExpand,
  onShrink,
  downloadHref,
  trailing,
}: {
  title: string
  meta?: string
  onClose: () => void
  showZoom?: boolean
  zoomIndex?: PreviewZoomIndex
  onZoomIn?: () => void
  onZoomOut?: () => void
  canAskAi?: boolean
  aiOpen?: boolean
  onAiToggle?: () => void
  embedded?: boolean
  onExpand?: () => void
  onShrink?: () => void
  downloadHref: string
  trailing?: ReactNode
}) {
  const zoomPct =
    showZoom && zoomIndex !== undefined ? previewZoomPercent(zoomIndex) : null

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-800/90 bg-zinc-950/98 px-2 sm:px-3">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(TOOL_BTN, "border-transparent bg-transparent hover:bg-zinc-800")}
        onClick={onClose}
        aria-label="Close preview"
      >
        <X className="size-4" />
      </Button>

      <div className="min-w-0 flex-1 px-1">
        <p className="truncate text-[13px] font-medium leading-tight text-white" title={title}>
          {title}
        </p>
        {meta ? (
          <p className="truncate text-[11px] leading-tight text-zinc-500" title={meta}>
            {meta}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {showZoom && zoomIndex !== undefined && onZoomIn && onZoomOut ? (
          <div
            className="mr-0.5 flex items-center rounded-lg border border-zinc-700/90 bg-zinc-900/95 p-0.5"
            role="group"
            aria-label="Zoom"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(TOOL_BTN, "size-7 border-0 bg-transparent shadow-none")}
              onClick={onZoomOut}
              disabled={!canPreviewZoomOut(zoomIndex)}
              aria-label="Zoom out"
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <span className="min-w-[2.75rem] select-none text-center text-[10px] font-semibold tabular-nums text-zinc-400">
              {zoomPct}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(TOOL_BTN, "size-7 border-0 bg-transparent shadow-none")}
              onClick={onZoomIn}
              disabled={!canPreviewZoomIn(zoomIndex)}
              aria-label="Zoom in"
            >
              <ZoomIn className="size-3.5" />
            </Button>
          </div>
        ) : null}

        {canAskAi && onAiToggle ? (
          <Button
            type="button"
            size="icon"
            className={cn(
              TOOL_BTN,
              aiOpen && "border-[#ff4f12]/50 bg-[#ff4f12] text-white hover:bg-[#ff6a33]",
            )}
            variant={aiOpen ? "default" : "outline"}
            onClick={onAiToggle}
            aria-label={aiOpen ? "Hide Ask AI" : "Ask AI"}
            aria-pressed={aiOpen}
            title="Ask AI"
          >
            <Sparkles className="size-3.5" />
          </Button>
        ) : null}

        {embedded && onExpand ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={TOOL_BTN}
            onClick={onExpand}
            aria-label="Expand to full screen"
          >
            <Maximize2 className="size-3.5" />
          </Button>
        ) : null}
        {!embedded && onShrink ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={TOOL_BTN}
            onClick={onShrink}
            aria-label="Dock in dashboard"
          >
            <Minimize2 className="size-3.5" />
          </Button>
        ) : null}

        <Button asChild variant="outline" size="icon" className={TOOL_BTN}>
          <a href={downloadHref} download aria-label="Download file">
            <Download className="size-3.5" />
          </a>
        </Button>

        {trailing}
      </div>
    </header>
  )
}
