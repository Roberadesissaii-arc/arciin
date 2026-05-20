"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react"

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

export function AssetViewerOverlay({
  assets,
  initialIndex,
  onClose,
  onNavigate,
}: {
  assets: AssetSummary[]
  initialIndex: number
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [pdfPage, setPdfPage] = useState(1)
  const [pdfTotal, setPdfTotal] = useState(0)

  const asset = assets[currentIndex] ?? assets[0]!
  const isPdf = isPdfAsset(asset)
  const isImage = asset.mediaType === "IMAGE"
  const isVideo = asset.mediaType === "VIDEO"
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < assets.length - 1
  const title = asset.originalFilename

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= assets.length) return
      setCurrentIndex(index)
      onNavigate(index)
      setPdfPage(1)
      setPdfTotal(0)
    },
    [assets.length, onNavigate],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === "ArrowLeft" && hasPrev) {
        e.preventDefault()
        goTo(currentIndex - 1)
      }
      if (e.key === "ArrowRight" && hasNext) {
        e.preventDefault()
        goTo(currentIndex + 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [currentIndex, goTo, hasNext, hasPrev, onClose])

  useEffect(() => {
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = prev
    }
  }, [])

  if (!mounted) return null

  const pdfUrl = pdfThumbnailSourceKey(asset.id, asset.updatedAt)
  const mediaUrl = assetInlineUrl(asset)

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="File preview"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
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
            {isPdf && pdfTotal > 0 ? ` · Page ${pdfPage} / ${pdfTotal}` : null}
            {assets.length > 1
              ? ` · ${currentIndex + 1} / ${assets.length}${isPdf ? " · ← → other files" : " · ← →"}`
              : isPdf && pdfTotal > 0
                ? " · scroll for pages"
                : null}
          </p>
        </div>
        <Button asChild variant="outline" size="icon" className="shrink-0">
          <a href={`/api/assets/${asset.id}/download`} download aria-label="Download file">
            <Download className="size-4" />
          </a>
        </Button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-zinc-950">
        <div
          className={cn(
            "absolute inset-0 flex",
            isPdf ? "flex-col" : "items-center justify-center p-4",
          )}
        >
          {isPdf ? (
            <DesktopPdfViewer
              fileUrl={pdfUrl}
              onPageChange={(page, total) => {
                setPdfPage(page)
                setPdfTotal(total)
              }}
            />
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
        </div>

        {hasPrev ? (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md"
            onClick={() => goTo(currentIndex - 1)}
            aria-label="Previous file"
          >
            <ChevronLeft className="size-5" />
          </Button>
        ) : null}
        {hasNext ? (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md"
            onClick={() => goTo(currentIndex + 1)}
            aria-label="Next file"
          >
            <ChevronRight className="size-5" />
          </Button>
        ) : null}

        {assets.length > 1 ? (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5">
            {assets.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to file ${i + 1}`}
                aria-current={i === currentIndex ? "true" : undefined}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === currentIndex ? "w-5 bg-primary" : "w-1.5 bg-white/30",
                )}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
