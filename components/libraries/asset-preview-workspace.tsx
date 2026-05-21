"use client"

import { useCallback, useEffect, useSyncExternalStore, useState } from "react"
import { createPortal } from "react-dom"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
} from "lucide-react"

import { AssetAiSidePanel } from "@/components/libraries/asset-ai-side-panel"
import { DesktopPdfViewer } from "@/components/libraries/desktop-pdf-viewer"
import { Button } from "@/components/ui/button"
import { pdfThumbnailSourceKey } from "@/hooks/use-pdf-thumbnail"
import { assetSupportsDocumentThumbnail } from "@arciin/shared"
import { cn } from "@/lib/utils"
import { formatBytes } from "@/lib/utils/format-bytes"
import type { AssetSummary } from "@/lib/types/models"

const INLINE_DOWNLOAD = "?inline=1"

function isPdfAsset(asset: AssetSummary) {
  return assetSupportsDocumentThumbnail(
    asset.mediaType,
    asset.mimeType,
    asset.extension,
    asset.originalFilename,
  )
}

function assetInlineUrl(asset: AssetSummary) {
  return `/api/assets/${asset.id}/download${INLINE_DOWNLOAD}&v=${encodeURIComponent(asset.updatedAt)}`
}

function supportsAskAi(asset: AssetSummary) {
  return (
    isPdfAsset(asset) ||
    asset.mediaType === "IMAGE" ||
    /\.(py|js|ts|tsx|jsx|json|md|txt|sh|yaml|yml|toml|rs|go|java|cpp|c|h)$/i.test(
      asset.originalFilename,
    )
  )
}

type AssetPreviewWorkspaceProps = {
  assets: AssetSummary[]
  index: number
  embedded: boolean
  aiOpen: boolean
  onAiOpenChange: (open: boolean) => void
  onClose: () => void
  onExpand: () => void
  onShrink: () => void
  onNavigate: (index: number) => void
}

function PreviewBody({
  asset,
  pdfPage,
  pdfTotal,
  onPdfPageChange,
}: {
  asset: AssetSummary
  pdfPage: number
  pdfTotal: number
  onPdfPageChange: (page: number, total: number) => void
}) {
  const isPdf = isPdfAsset(asset)
  const isImage = asset.mediaType === "IMAGE"
  const isVideo = asset.mediaType === "VIDEO"
  const title = asset.originalFilename
  const pdfUrl = pdfThumbnailSourceKey(asset.id, asset.updatedAt)
  const mediaUrl = assetInlineUrl(asset)

  return (
    <div
      className={cn(
        "relative min-h-0 min-w-0 flex-1 overflow-hidden bg-zinc-950",
        isPdf ? "flex flex-col" : "flex items-center justify-center p-4",
      )}
    >
      {isPdf ? (
        <DesktopPdfViewer fileUrl={pdfUrl} onPageChange={onPdfPageChange} />
      ) : isVideo ? (
        <video
          key={asset.id}
          src={mediaUrl}
          controls
          playsInline
          className="max-h-full max-w-full object-contain"
        />
      ) : isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={asset.id}
          src={mediaUrl}
          alt={title}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Preview unavailable for this file type.</p>
      )}
      {pdfTotal > 0 ? (
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-zinc-300">
          Page {pdfPage} / {pdfTotal}
        </p>
      ) : null}
    </div>
  )
}

export function AssetPreviewWorkspace({
  assets,
  index,
  embedded,
  aiOpen,
  onAiOpenChange,
  onClose,
  onExpand,
  onShrink,
  onNavigate,
}: AssetPreviewWorkspaceProps) {
  const [pdfPage, setPdfPage] = useState(1)
  const [pdfTotal, setPdfTotal] = useState(0)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const asset = assets[index] ?? assets[0]!
  const isPdf = isPdfAsset(asset)
  const hasPrev = index > 0
  const hasNext = index < assets.length - 1
  const title = asset.originalFilename
  const canAskAi = supportsAskAi(asset)

  const goTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= assets.length) return
      onNavigate(i)
      setPdfPage(1)
      setPdfTotal(0)
    },
    [assets.length, onNavigate],
  )

  useEffect(() => {
    if (!embedded) {
      const prev = document.documentElement.style.overflow
      document.documentElement.style.overflow = "hidden"
      return () => {
        document.documentElement.style.overflow = prev
      }
    }
  }, [embedded])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === "ArrowLeft" && hasPrev && !isPdf) goTo(index - 1)
      if (e.key === "ArrowRight" && hasNext && !isPdf) goTo(index + 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [goTo, hasNext, hasPrev, index, isPdf, onClose])

  const shell = (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-background",
        embedded
          ? "mb-4 min-h-[min(58vh,560px)] w-full rounded-2xl border border-border shadow-lg ring-1 ring-zinc-200/50"
          : "fixed inset-0 z-[200]",
      )}
      role="region"
      aria-label="File preview"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X className="size-5" />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(asset.sizeBytes)}
            {assets.length > 1 ? ` · ${index + 1} / ${assets.length}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canAskAi ? (
            <Button
              type="button"
              variant={aiOpen ? "default" : "outline"}
              size="sm"
              className={cn(
                "hidden gap-1.5 sm:flex",
                aiOpen && "bg-[#ff4f12] text-white hover:bg-[#ff6a33]",
              )}
              onClick={() => onAiOpenChange(!aiOpen)}
            >
              <Sparkles className="size-3.5" />
              Ask AI
            </Button>
          ) : null}
          {embedded ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onExpand}
              aria-label="Expand to full screen"
            >
              <Maximize2 className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onShrink}
              aria-label="Dock in page"
            >
              <Minimize2 className="size-4" />
            </Button>
          )}
          <Button asChild variant="outline" size="icon">
            <a href={`/api/assets/${asset.id}/download`} download aria-label="Download file">
              <Download className="size-4" />
            </a>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <PreviewBody
            asset={asset}
            pdfPage={pdfPage}
            pdfTotal={pdfTotal}
            onPdfPageChange={(page, total) => {
              setPdfPage(page)
              setPdfTotal(total)
            }}
          />
          {!isPdf && hasPrev ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md"
              onClick={() => goTo(index - 1)}
              aria-label="Previous file"
            >
              <ChevronLeft className="size-5" />
            </Button>
          ) : null}
          {!isPdf && hasNext ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md"
              onClick={() => goTo(index + 1)}
              aria-label="Next file"
            >
              <ChevronRight className="size-5" />
            </Button>
          ) : null}
        </div>
        {aiOpen && canAskAi ? (
          <AssetAiSidePanel
            asset={asset}
            pdfPage={isPdf ? pdfPage : undefined}
            onClose={() => onAiOpenChange(false)}
            className="hidden w-[min(100%,380px)] md:flex"
          />
        ) : null}
      </div>

      {aiOpen && canAskAi ? (
        <div className="flex max-h-[45vh] min-h-[240px] border-t border-zinc-800 md:hidden">
          <AssetAiSidePanel
            asset={asset}
            pdfPage={isPdf ? pdfPage : undefined}
            onClose={() => onAiOpenChange(false)}
            className="max-w-none flex-1"
          />
        </div>
      ) : null}
    </div>
  )

  if (!mounted) return null
  if (embedded) return shell
  return createPortal(shell, document.body)
}
