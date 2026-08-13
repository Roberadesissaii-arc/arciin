"use client"

import { createElement, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  Archive,
  Code2,
  File,
  FileText,
  Image as ImageIcon,
  Loader2,
  MinusCircle,
  Music,
  Play,
  Video,
  type LucideIcon,
} from "lucide-react"
import { assetSupportsDocumentThumbnail, DEFAULT_USER_PREFERENCES } from "@arciin/shared"

import { useAssetSelection } from "@/components/libraries/asset-selection"
import { useAssetViewerOptional } from "@/components/libraries/asset-viewer-context"
import { getUserPreferences } from "@/lib/api/user-preferences"
import { queryKeys } from "@/lib/api/query-keys"
import { resolveAssetBadge } from "@/lib/utils/asset-badge"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatCardRelativeTime } from "@/lib/utils/format-card-relative-time"
import { inferDestinationLabel } from "@/lib/utils/media-type"
import { cn } from "@/lib/utils"
import { isViewableAsset } from "@/lib/utils/viewable-asset"
import type { AssetStatus, AssetSummary, MediaType } from "@/lib/types/models"

/** Soft accent for the empty preview wash — zinc/orange family only, no purple. */
function accentForMediaType(mediaType: MediaType): string {
  switch (mediaType) {
    case "IMAGE":
      return "#71717a"
    case "VIDEO":
      return "#FF4F12"
    case "AUDIO":
      return "#52525b"
    case "DOCUMENT":
      return "#a1a1aa"
    case "ARCHIVE":
      return "#a1a1aa"
    case "CODE":
      return "#71717a"
    default:
      return "#a1a1aa"
  }
}

function iconForMediaType(mediaType: MediaType): LucideIcon {
  switch (mediaType) {
    case "IMAGE":
      return ImageIcon
    case "VIDEO":
      return Video
    case "AUDIO":
      return Music
    case "DOCUMENT":
      return FileText
    case "ARCHIVE":
      return Archive
    case "CODE":
      return Code2
    default:
      return File
  }
}

/**
 * The glyph for a media type, as its own component.
 *
 * Looking the icon up into a local and rendering `<TypeIcon />` reads to the
 * React compiler as building a component inside render, which it is right to
 * refuse — a component identity that changes per render remounts its subtree.
 * Declared here, the identity is fixed and the lookup is just a lookup.
 */
function MediaTypeGlyph({
  mediaType,
  className,
  color,
}: {
  mediaType: MediaType
  className?: string
  color?: string
}) {
  // createElement rather than JSX: rendering a capitalised local reads to the
  // React compiler as constructing a component during render, and it is right to
  // refuse that in general. Here the value is one of a fixed set of icons, so the
  // call says exactly that and nothing is created.
  return createElement(iconForMediaType(mediaType), {
    className,
    style: color ? { color } : undefined,
    "aria-hidden": true,
  })
}

type AiStatusTone = "ready" | "working" | "queued" | "failed" | "skipped"

type AiStatusView = {
  label: string
  tone: AiStatusTone
  Icon?: LucideIcon
  spin?: boolean
}

function resolveAiStatus(asset: AssetSummary): AiStatusView {
  const status: AssetStatus = asset.status

  // Neutral “Ready” — not a green “Indexed” claim.
  if (status === "READY") {
    return { label: "Ready", tone: "ready" }
  }
  if (status === "FAILED") {
    return { label: "Failed", tone: "failed", Icon: AlertTriangle }
  }
  if (status === "DELETED") {
    return { label: "Skipped", tone: "skipped", Icon: MinusCircle }
  }
  if (status === "UPLOADING") {
    return { label: "Queued", tone: "queued" }
  }
  // PROCESSING
  if (asset.mediaType === "DOCUMENT") {
    return { label: "Summarizing", tone: "working", Icon: Loader2, spin: true }
  }
  if (asset.mediaType === "AUDIO" || asset.mediaType === "VIDEO") {
    return { label: "Transcribing", tone: "working", Icon: Loader2, spin: true }
  }
  if (asset.mediaType === "IMAGE") {
    return { label: "Thumbnail", tone: "working", Icon: Loader2, spin: true }
  }
  return { label: "Classifying", tone: "working", Icon: Loader2, spin: true }
}

function sourceChipLabel(asset: AssetSummary): string {
  const badge = resolveAssetBadge(asset)
  if (badge?.label) return badge.label
  return inferDestinationLabel(asset.mimeType, asset.originalFilename)
}

function MediaPreview({
  asset,
  hover = false,
}: {
  asset: AssetSummary
  /** Whole-card hover — muted video loop while true. */
  hover?: boolean
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { data: prefs } = useQuery({
    queryKey: queryKeys.userPreferences,
    queryFn: ({ signal }) => getUserPreferences(signal),
    staleTime: 60_000,
  })
  const docThumbs =
    prefs?.media.documentThumbnails ?? DEFAULT_USER_PREFERENCES.media.documentThumbnails

  const accent = accentForMediaType(asset.mediaType)
  const ext = (
    asset.extension ||
    asset.originalFilename.split(".").pop() ||
    ""
  ).toUpperCase()

  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const videoSrc = `/api/assets/${asset.id}/download?inline=1&v=${encodeURIComponent(asset.updatedAt)}`

  const isImage = asset.mediaType === "IMAGE" && !thumbFailed
  const isVideo = asset.mediaType === "VIDEO"
  const isDocThumb =
    docThumbs &&
    !thumbFailed &&
    assetSupportsDocumentThumbnail(
      asset.mediaType,
      asset.mimeType,
      asset.extension,
      asset.originalFilename,
    )
  const showBitmap = isImage || isDocThumb

  useEffect(() => {
    const el = videoRef.current
    if (!el || !isVideo) return
    if (hover) {
      el.muted = true
      void el.play().catch(() => {})
    } else {
      el.pause()
      try {
        el.currentTime = 0
      } catch {
        /* ignore seek race */
      }
    }
  }, [hover, isVideo, asset.id])

  return (
    <div
      className="relative h-[6.5rem] w-full overflow-hidden rounded-xl border border-zinc-200/80"
      style={{
        background: `linear-gradient(140deg, ${accent}14 0%, #ffffff 55%, ${accent}0d 100%)`,
      }}
    >
      {/* Decorative blur orb */}
      <span
        className="pointer-events-none absolute -right-5 -top-6 size-20 rounded-full blur-xl"
        style={{ backgroundColor: `${accent}1f` }}
        aria-hidden
      />

      {/* Center type chip (always under media so slow loads never flash empty) */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="flex size-11 items-center justify-center rounded-xl bg-white/85 shadow-sm"
          style={{ boxShadow: `inset 0 0 0 1px ${accent}26` }}
        >
          <MediaTypeGlyph mediaType={asset.mediaType} className="size-5" color={accent} />
        </span>
      </div>

      {!showBitmap && !isVideo && ext ? (
        <span className="absolute bottom-1.5 right-2 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
          {ext}
        </span>
      ) : null}

      {showBitmap ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbSrc}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 size-full bg-white object-cover"
          onError={() => setThumbFailed(true)}
        />
      ) : null}

      {isVideo ? (
        <>
          {/* Muted loop — plays while the card is hovered */}
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            playsInline
            loop
            preload={hover ? "auto" : "metadata"}
            draggable={false}
            className="absolute inset-0 size-full bg-black object-cover"
            aria-hidden
          />
          {/* Thumbnail covers the video until hover */}
          {!thumbFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbSrc}
              alt=""
              loading="lazy"
              draggable={false}
              className={cn(
                "absolute inset-0 z-[1] size-full bg-black object-cover transition-opacity duration-200",
                hover ? "opacity-0" : "opacity-100",
              )}
              onError={() => setThumbFailed(true)}
            />
          ) : null}
          <span
            className={cn(
              "pointer-events-none absolute inset-0 z-[2] flex items-center justify-center transition-opacity duration-200",
              hover ? "opacity-0" : "opacity-100",
            )}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
              <Play className="size-3.5 translate-x-px fill-current" aria-hidden />
            </span>
          </span>
          <span className="sr-only">Video — hover for muted preview</span>
        </>
      ) : null}
    </div>
  )
}

function AiStatusPill({ asset }: { asset: AssetSummary }) {
  const view = resolveAiStatus(asset)
  const Icon = view.Icon

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        view.tone === "ready" && "bg-zinc-100 text-zinc-600",
        view.tone === "working" && "text-[#FF4F12]",
        view.tone === "queued" && "bg-zinc-100 text-zinc-600",
        view.tone === "failed" && "bg-red-50 text-red-700",
        view.tone === "skipped" && "bg-zinc-100 text-zinc-600",
      )}
      style={
        view.tone === "working"
          ? { backgroundColor: "color-mix(in srgb, #FF4F12 10%, transparent)" }
          : undefined
      }
    >
      {Icon ? (
        <Icon
          className={cn("size-3", view.spin && "animate-spin")}
          aria-hidden
        />
      ) : null}
      {view.label}
    </span>
  )
}

export function AssetCard({ asset }: { asset: AssetSummary }) {
  const selection = useAssetSelection()
  const viewer = useAssetViewerOptional()
  const selected = selection?.isSelected(asset.id) ?? false
  const canOpen = isViewableAsset(asset) && Boolean(viewer?.canOpen(asset))
  const source = sourceChipLabel(asset)
  const metaLine = `${formatBytes(asset.sizeBytes)} · ${formatCardRelativeTime(asset.createdAt)}`
  const [hover, setHover] = useState(false)

  /** Single click = select (bulk bar). Double-click = open preview. */
  const onCardClick = (event: React.MouseEvent) => {
    if (event.defaultPrevented) return
    if (!selection) {
      if (canOpen && viewer) viewer.openViewer(asset.id)
      return
    }

    const additive = event.metaKey || event.ctrlKey
    const range = event.shiftKey

    if (range || additive) {
      selection.toggle(asset.id, { additive: additive || range, range })
      return
    }

    if (selected) {
      selection.toggle(asset.id, { additive: true })
    } else {
      selection.selectOnly(asset.id)
    }
  }

  const onCardDoubleClick = (event: React.MouseEvent) => {
    if (event.defaultPrevented) return
    if (canOpen && viewer) {
      event.preventDefault()
      event.stopPropagation()
      viewer.openViewer(asset.id)
    }
  }

  return (
    <article
      data-asset-id={asset.id}
      data-asset-selectable
      onClick={selection ? onCardClick : undefined}
      onDoubleClick={onCardDoubleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${asset.originalFilename} — double-click to open`}
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-2.5 text-left shadow-sm",
        "transition-all duration-200 ease-out",
        "hover:-translate-y-0.5 hover:border-[rgba(255,79,18,0.3)] hover:shadow-md",
        selection && "cursor-pointer",
        selected && "border-[rgba(255,79,18,0.45)] ring-2 ring-[rgba(255,79,18,0.18)]",
      )}
    >
      <MediaPreview asset={asset} hover={hover} />

      <div className="mt-2.5 min-w-0">
        <p
          className="truncate text-[12.5px] font-medium leading-snug text-zinc-900"
          title={asset.originalFilename}
        >
          {asset.originalFilename}
        </p>
        <p
          className="mt-1 truncate text-[11px] tabular-nums text-zinc-400"
          suppressHydrationWarning
        >
          {metaLine}
        </p>
      </div>

      <div className="mt-2 flex items-center justify-between gap-1.5">
        <span
          className="max-w-[7rem] truncate rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600"
          title={source}
        >
          {source}
        </span>
        <AiStatusPill asset={asset} />
      </div>
    </article>
  )
}
