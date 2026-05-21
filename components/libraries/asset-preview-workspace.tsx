"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
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
const WORKSPACE_HOST_ID = "arciin-dashboard-workspace-host"

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

  const portalHost =
    embedded && mounted
      ? document.getElementById(WORKSPACE_HOST_ID)
      : null

  useEffect(() => {
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = prev
    }
  }, [])

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
        "pointer-events-auto flex flex-col overflow-hidden bg-zinc-950",
        embedded ? "absolute inset-0 z-[60]" : "fixed inset-0 z-[200]",
      )}
      role="region"
      aria-label="File preview"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2.5 text-white sm:px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-zinc-300 hover:bg-zinc-800 hover:text-white"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X className="size-5" />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          <p className="text-xs text-zinc-400">
            {formatBytes(asset.sizeBytes)}
            {isPdf && pdfTotal > 0 ? ` · Page ${pdfPage} / ${pdfTotal}` : null}
            {assets.length > 1 ? ` · File ${index + 1} / ${assets.length}` : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canAskAi ? (
            <Button
              type="button"
              size="sm"
              className={cn(
                "hidden gap-1.5 sm:inline-flex",
                aiOpen
                  ? "bg-[#ff4f12] text-white hover:bg-[#ff6a33]"
                  : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800",
              )}
              variant={aiOpen ? "default" : "outline"}
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
              className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
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
              className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
              onClick={onShrink}
              aria-label="Dock in dashboard"
            >
              <Minimize2 className="size-4" />
            </Button>
          )}
          <Button
            asChild
            variant="outline"
            size="icon"
            className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          >
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
            className="hidden h-full w-[min(100%,420px)] shrink-0 lg:flex"
          />
        ) : null}
      </div>

      {aiOpen && canAskAi ? (
        <div className="flex max-h-[42vh] min-h-[220px] border-t border-zinc-800 lg:hidden">
          <AssetAiSidePanel
            asset={asset}
            pdfPage={isPdf ? pdfPage : undefined}
            onClose={() => onAiOpenChange(false)}
            className="h-full max-w-none flex-1"
          />
        </div>
      ) : null}
    </div>
  )

  if (!mounted) return null
  if (embedded && portalHost) return createPortal(shell, portalHost)
  if (!embedded) return createPortal(shell, document.body)
  return null
}
