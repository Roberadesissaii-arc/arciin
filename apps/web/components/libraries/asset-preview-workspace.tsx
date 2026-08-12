"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { AssetAiSidePanel } from "@/components/libraries/asset-ai-side-panel"
import { DesktopPdfViewer } from "@/components/libraries/desktop-pdf-viewer"
import { ImageAssetViewer } from "@/components/libraries/image-asset-viewer"
import { PreviewAskAiSeam } from "@/components/libraries/preview-ask-ai-seam"
import { PreviewFloatingChrome } from "@/components/libraries/preview-floating-chrome"
import { TextAssetViewer } from "@/components/libraries/text-asset-viewer"
import { VideoAssetViewer } from "@/components/libraries/video-asset-viewer"
import { Button } from "@/components/ui/button"
import { pdfThumbnailSourceKey } from "@/hooks/use-pdf-thumbnail"
import {
  canPreviewZoomIn,
  canPreviewZoomOut,
  PREVIEW_ZOOM_DEFAULT_INDEX,
  previewZoomAt,
} from "@/lib/files/preview-zoom"
import { assetSupportsDocumentThumbnail } from "@arciin/shared"
import { cn } from "@/lib/utils"
import { useLicense } from "@/lib/license/use-license"
import { formatBytes } from "@/lib/utils/format-bytes"
import {
  isCodeOrTextAsset,
  isVideoLikeAsset,
} from "@/lib/utils/viewable-asset"
import {
  isPdfPageBookmarked,
  togglePdfPageBookmark,
} from "@/lib/files/pdf-preview-bookmarks"
import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"
import type { PdfPageAnnotation } from "@/lib/files/pdf-annotation-layout"
import { loadStudyLayer, saveStudyLayer } from "@/lib/files/pdf-study-layer-store"
import type { ImageHighlightRegion } from "@/lib/files/image-highlight-types"
import type { AssetSummary } from "@/lib/types/models"

const INLINE_DOWNLOAD = "?inline=1"
const WORKSPACE_HOST_ID = "arciin-dashboard-workspace-host"
const ASK_AI_PANEL_W = 420

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
  return isPdfAsset(asset) || asset.mediaType === "IMAGE" || isCodeOrTextAsset(asset)
}

function supportsZoom(asset: AssetSummary) {
  return isPdfAsset(asset) || asset.mediaType === "IMAGE"
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
  zoom,
  scrollToPdfPage,
  scrollToPdfPageAt,
  pdfHighlightTargets,
  pdfHighlightAt,
  focusPdfMark,
  pdfNotes,
  imageHighlightRegions,
  onPdfPageChange,
}: {
  asset: AssetSummary
  zoom: number
  scrollToPdfPage?: number
  scrollToPdfPageAt?: number
  pdfHighlightTargets?: PdfHighlightTarget[]
  pdfHighlightAt?: number
  focusPdfMark?: { page: number; ordinal: number; at: number }
  pdfNotes?: PdfPageAnnotation[]
  imageHighlightRegions?: ImageHighlightRegion[]
  onPdfPageChange: (page: number, total: number) => void
}) {
  const isPdf = isPdfAsset(asset)
  const isImage = asset.mediaType === "IMAGE"
  const isVideo = isVideoLikeAsset(asset)
  const isText = isCodeOrTextAsset(asset)
  const title = asset.originalFilename
  const pdfUrl = pdfThumbnailSourceKey(asset.id, asset.updatedAt)
  const mediaUrl = assetInlineUrl(asset)

  return (
    <div
      className={cn(
        "relative min-h-0 min-w-0 flex-1 overflow-hidden bg-zinc-50",
        isPdf || isImage || isText
          ? "flex min-h-0 flex-col"
          : "flex items-center justify-center p-4",
        isText && "p-4",
      )}
    >
      {isPdf ? (
        <DesktopPdfViewer
          key={pdfUrl}
          fileUrl={pdfUrl}
          zoom={zoom}
          scrollToPage={scrollToPdfPage}
          scrollToPageAt={scrollToPdfPageAt}
          highlightTargets={pdfHighlightTargets}
          highlightAt={pdfHighlightAt}
          focusHighlight={focusPdfMark}
          annotations={pdfNotes}
          onPageChange={onPdfPageChange}
        />
      ) : isVideo ? (
        <VideoAssetViewer src={mediaUrl} />
      ) : isText ? (
        <TextAssetViewer
          key={mediaUrl}
          fileUrl={mediaUrl}
          filename={title}
          className="mx-auto h-full w-full max-w-5xl"
        />
      ) : isImage ? (
        <ImageAssetViewer
          src={mediaUrl}
          alt={title}
          zoom={zoom}
          highlightRegions={imageHighlightRegions}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Preview unavailable for this file type.</p>
      )}
    </div>
  )
}

function PreviewWorkspaceBody({
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
  const [zoomIndex, setZoomIndex] = useState(PREVIEW_ZOOM_DEFAULT_INDEX)
  const [scrollToPdfPage, setScrollToPdfPage] = useState<
    { page: number; at: number } | undefined
  >()
  const [pdfHighlightTargets, setPdfHighlightTargets] = useState<PdfHighlightTarget[]>([])
  const [pdfHighlightAt, setPdfHighlightAt] = useState<number | undefined>()
  const [pdfNotes, setPdfNotes] = useState<PdfPageAnnotation[]>([])
  const [notesHidden, setNotesHidden] = useState(false)
  /** Blocks the first save, so restoring a layer is not mistaken for a change. */
  const studyLayerReadyRef = useRef(false)
  const [focusPdfMark, setFocusPdfMark] = useState<
    { page: number; ordinal: number; at: number } | undefined
  >()


  const [imageHighlightRegions, setImageHighlightRegions] = useState<ImageHighlightRegion[]>([])
  const [bookmarkRevision, setBookmarkRevision] = useState(0)

  const asset = assets[index] ?? assets[0]!

  /**
   * Restore the study layer for whichever asset is open.
   *
   * Runs on asset change rather than mount, because the preview is reused as the
   * user moves between files — without the reset, one document's notes would
   * follow them into the next.
   */
  useEffect(() => {
    studyLayerReadyRef.current = false
    let cancelled = false
    // Deferred by a microtask rather than set in the effect body: a synchronous
    // setState here cascades a second render before paint, and the layer is
    // being read off disk anyway.
    queueMicrotask(() => {
      if (cancelled) return
      const saved = loadStudyLayer(asset.id)
      setPdfNotes(saved?.notes ?? [])
      setPdfHighlightTargets(saved?.marks ?? [])
      setNotesHidden(false)
      // Marks and notes are stored as text plus page, so the viewer resolves
      // their positions against the live document — nothing to re-anchor here.
      if (saved) setPdfHighlightAt(Date.now())
      studyLayerReadyRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [asset.id])

  useEffect(() => {
    // Skip the write that would otherwise fire immediately after restoring.
    if (!studyLayerReadyRef.current) return
    saveStudyLayer(asset.id, { notes: pdfNotes, marks: pdfHighlightTargets })
  }, [asset.id, pdfNotes, pdfHighlightTargets])
  const isPdf = isPdfAsset(asset)
  const isImage = asset.mediaType === "IMAGE"
  const isVideo = isVideoLikeAsset(asset)
  const hasPrev = index > 0
  const hasNext = index < assets.length - 1
  const license = useLicense()
  const askAiSupported = supportsAskAi(asset)
  const canAskAi = askAiSupported && license.hasFeature("ai.chat")
  const askAiLocked = askAiSupported && !license.hasFeature("ai.chat")
  const askAiPlanLabel = license.planLabel(license.requiredPlanFor("ai.chat") ?? "pro")
  const canZoom = supportsZoom(asset)
  const zoom = previewZoomAt(zoomIndex)

  const metaParts: string[] = [formatBytes(asset.sizeBytes)]
  if (isPdf && pdfTotal > 0) metaParts.push(`Page ${pdfPage} / ${pdfTotal}`)
  if (assets.length > 1) metaParts.push(`File ${index + 1} / ${assets.length}`)
  const meta = metaParts.join(" · ")

  const pageBookmarked = useMemo(() => {
    void bookmarkRevision
    if (!isPdf || pdfPage < 1) return false
    return isPdfPageBookmarked(asset.id, pdfPage)
  }, [asset.id, isPdf, pdfPage, bookmarkRevision])

  const handleToggleBookmark = useCallback(() => {
    if (!isPdf || pdfPage < 1) return
    const added = togglePdfPageBookmark(asset.id, pdfPage)
    setBookmarkRevision((n) => n + 1)
    toast.success(added ? `Bookmarked page ${pdfPage}` : `Removed bookmark for page ${pdfPage}`, {
      description: added
        ? "Jump back to this page anytime from the bookmarks list."
        : "This page is no longer bookmarked.",
    })
  }, [asset.id, isPdf, pdfPage])

  const goTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= assets.length) return
      onNavigate(i)
      setPdfPage(1)
      setPdfTotal(0)
      setZoomIndex(PREVIEW_ZOOM_DEFAULT_INDEX)
      setPdfHighlightTargets([])
      setPdfHighlightAt(undefined)
      setImageHighlightRegions([])
    },
    [assets.length, onNavigate],
  )

  const handleFocusPdfMark = useCallback(
    (target: PdfHighlightTarget) => {
      // The viewer stores rects grouped by page in target order, so a mark's
      // position among the targets on its own page is its position in that list.
      const ordinal = pdfHighlightTargets
        .filter((t) => t.page === target.page)
        .findIndex(
          (t) =>
            t.quote.trim().toLowerCase() === target.quote.trim().toLowerCase() &&
            (t.style ?? "highlight") === (target.style ?? "highlight"),
        )
      setFocusPdfMark({ page: target.page, ordinal: Math.max(0, ordinal), at: Date.now() })
      if (target.page !== pdfPage) setPdfPage(target.page)
    },
    [pdfHighlightTargets, pdfPage],
  )

  const handlePdfHighlight = useCallback(
    (targets: PdfHighlightTarget[]) => {
      setPdfHighlightTargets((prev) => {
        if (targets.length === 0) return []
        const merged = [...prev]
        for (const target of targets) {
          const key = `${target.kind ?? "default"}:${target.page}:${target.quote.trim().toLowerCase()}`
          if (
            !merged.some(
              (t) =>
                `${t.kind ?? "default"}:${t.page}:${t.quote.trim().toLowerCase()}` === key,
            )
          ) {
            merged.push(target)
          }
        }
        return merged
      })
      setPdfHighlightAt(Date.now())
      // Scroll to the first mark automatically. Being told something was marked
      // and having to hunt for it is the same as not being told.
      const lead = targets[0]
      if (lead) {
        setFocusPdfMark({ page: lead.page, ordinal: 0, at: Date.now() })
      }
      const first = targets[0]
      if (first && first.page !== pdfPage) {
        setScrollToPdfPage({ page: first.page, at: Date.now() })
      }
    },
    [pdfPage],
  )

  const handleImageHighlight = useCallback(
    (regions: ImageHighlightRegion[], options?: { replace?: boolean }) => {
      setImageHighlightRegions((prev) => {
        if (regions.length === 0) return []
        const base = options?.replace ? [] : [...prev]
        for (const region of regions) {
          const key = `${(region.label ?? "").toLowerCase()}:${region.x1},${region.y1},${region.x2},${region.y2}`
          if (
            !base.some(
              (r) =>
                `${(r.label ?? "").toLowerCase()}:${r.x1},${r.y1},${r.x2},${r.y2}` === key,
            )
          ) {
            base.push(region)
          }
        }
        return base
      })
    },
    [],
  )

  const handleAiNewChat = useCallback(() => {
    setScrollToPdfPage(undefined)
    setPdfHighlightTargets([])
    setPdfHighlightAt(undefined)
    setImageHighlightRegions([])
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        if (aiOpen && canAskAi) {
          onAiOpenChange(false)
          return
        }
        onClose()
        return
      }
      if (e.key === "ArrowLeft" && hasPrev && !isPdf && !isVideo) goTo(index - 1)
      if (e.key === "ArrowRight" && hasNext && !isPdf && !isVideo) goTo(index + 1)
      if ((e.key === "+" || e.key === "=") && canZoom && canPreviewZoomIn(zoomIndex)) {
        e.preventDefault()
        setZoomIndex((z) => z + 1)
      }
      if (e.key === "-" && canZoom && canPreviewZoomOut(zoomIndex)) {
        e.preventDefault()
        setZoomIndex((z) => z - 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [aiOpen, canAskAi, canZoom, goTo, hasNext, hasPrev, index, isPdf, isVideo, onAiOpenChange, onClose, zoomIndex])

  return (
    <div
      className={cn(
        "pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden bg-white",
        embedded ? "absolute inset-0 z-[60]" : "fixed inset-0 z-[200]",
      )}
      role="region"
      aria-label="File preview"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col transition-[flex-basis] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]">
          <PreviewBody
            asset={asset}
            zoom={zoom}
            scrollToPdfPage={scrollToPdfPage?.page}
            scrollToPdfPageAt={scrollToPdfPage?.at}
            pdfHighlightTargets={pdfHighlightTargets}
            pdfHighlightAt={pdfHighlightAt}
            focusPdfMark={focusPdfMark}
            pdfNotes={notesHidden ? undefined : pdfNotes}
            imageHighlightRegions={imageHighlightRegions}
            onPdfPageChange={(page, total) => {
              setPdfPage(page)
              setPdfTotal(total)
            }}
          />

          <PreviewFloatingChrome
            onClose={onClose}
            showZoom={canZoom}
            zoomIndex={zoomIndex}
            onZoomIn={() => setZoomIndex((z) => (canPreviewZoomIn(z) ? z + 1 : z))}
            onZoomOut={() => setZoomIndex((z) => (canPreviewZoomOut(z) ? z - 1 : z))}
            showBookmark={isPdf && pdfTotal > 0}
            pageBookmarked={pageBookmarked}
            onToggleBookmark={handleToggleBookmark}
            embedded={embedded}
            onExpand={onExpand}
            onShrink={onShrink}
            downloadHref={`/api/assets/${asset.id}/download`}
            meta={meta}
          />

          {canAskAi ? (
            <PreviewAskAiSeam
              open={aiOpen}
              onOpen={() => onAiOpenChange(true)}
              onClose={() => onAiOpenChange(false)}
            />
          ) : askAiLocked ? (
            <PreviewAskAiSeam
              open={false}
              onOpen={() => {
                window.location.href = "/chat"
              }}
              onClose={() => {}}
              lockedLabel={askAiPlanLabel}
            />
          ) : null}

          {!isPdf && !isVideo && hasPrev ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute left-2 top-1/2 z-10 size-8 -translate-y-1/2 rounded-full shadow-md"
              onClick={() => goTo(index - 1)}
              aria-label="Previous file"
            >
              <ChevronLeft className="size-4" />
            </Button>
          ) : null}
          {!isPdf && !isVideo && hasNext ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-2 top-1/2 z-10 size-8 -translate-y-1/2 rounded-full shadow-md"
              onClick={() => goTo(index + 1)}
              aria-label="Next file"
            >
              <ChevronRight className="size-4" />
            </Button>
          ) : null}
        </div>

        {canAskAi ? (
          <div
            className={cn(
              "hidden h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:block",
              aiOpen ? `w-[min(100%,${ASK_AI_PANEL_W}px)]` : "w-0",
            )}
          >
            <AssetAiSidePanel
              asset={asset}
              pdfPage={isPdf ? pdfPage : undefined}
              pdfPageCount={isPdf ? pdfTotal : undefined}
              onNavigateToPage={
                isPdf ? (page) => setScrollToPdfPage({ page, at: Date.now() }) : undefined
              }
              onHighlightPdf={isPdf ? handlePdfHighlight : undefined}
              onFocusPdfMark={isPdf ? handleFocusPdfMark : undefined}
              onAnnotatePdf={isPdf ? setPdfNotes : undefined}
              notesHidden={notesHidden}
              onToggleNotes={isPdf && pdfNotes.length > 0 ? () => setNotesHidden((v) => !v) : undefined}
              noteCount={pdfNotes.length}
              onClearPdfHighlight={isPdf ? () => handlePdfHighlight([]) : undefined}
              onHighlightImage={isImage ? handleImageHighlight : undefined}
              onClearImageHighlight={isImage ? () => handleImageHighlight([]) : undefined}
              onNewChat={canAskAi ? handleAiNewChat : undefined}
              onClose={() => onAiOpenChange(false)}
              className="h-full w-[420px] shrink-0"
            />
          </div>
        ) : null}
      </div>

      {canAskAi ? (
        <div
          className={cn(
            "flex shrink-0 overflow-hidden border-t border-zinc-200 bg-white transition-[max-height] duration-200 ease-out lg:hidden",
            aiOpen ? "max-h-[42vh] min-h-[220px]" : "max-h-0 min-h-0",
          )}
        >
          <AssetAiSidePanel
            asset={asset}
            pdfPage={isPdf ? pdfPage : undefined}
            pdfPageCount={isPdf ? pdfTotal : undefined}
            onNavigateToPage={
              isPdf ? (page) => setScrollToPdfPage({ page, at: Date.now() }) : undefined
            }
            onHighlightPdf={isPdf ? handlePdfHighlight : undefined}
            onFocusPdfMark={isPdf ? handleFocusPdfMark : undefined}
            onAnnotatePdf={isPdf ? setPdfNotes : undefined}
            notesHidden={notesHidden}
            onToggleNotes={isPdf && pdfNotes.length > 0 ? () => setNotesHidden((v) => !v) : undefined}
            noteCount={pdfNotes.length}
            onClearPdfHighlight={isPdf ? () => handlePdfHighlight([]) : undefined}
            onHighlightImage={isImage ? handleImageHighlight : undefined}
            onClearImageHighlight={isImage ? () => handleImageHighlight([]) : undefined}
            onNewChat={canAskAi ? handleAiNewChat : undefined}
            onClose={() => onAiOpenChange(false)}
            className="h-full max-w-none flex-1"
          />
        </div>
      ) : null}
    </div>
  )
}

export function AssetPreviewWorkspace(props: AssetPreviewWorkspaceProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const asset = props.assets[props.index] ?? props.assets[0]!
  const portalHost =
    props.embedded && mounted
      ? document.getElementById(WORKSPACE_HOST_ID)
      : null

  useEffect(() => {
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = prev
    }
  }, [])

  if (!mounted) return null

  const body = <PreviewWorkspaceBody key={asset.id} {...props} />

  if (props.embedded && portalHost) return createPortal(body, portalHost)
  if (!props.embedded) return createPortal(body, document.body)
  return null
}
