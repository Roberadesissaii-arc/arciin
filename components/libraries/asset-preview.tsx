"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { AssetPreviewFrame } from "@/components/libraries/asset-preview-frame"
import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { thumbnailStatusLabel } from "@/components/libraries/thumbnail-status-badge"
import { mediaTypeIcons } from "@/lib/utils/file-icons"
import { cn } from "@/lib/utils"
import {
  toggleMusicAsset,
  useIsMusicAssetActive,
  useIsMusicAssetPlaying,
} from "@/lib/audio/music-player"
import { isAudioLikeAsset } from "@/lib/utils/viewable-asset"
import type { AssetSummary } from "@/lib/types/models"
import { assetSupportsDocumentThumbnail } from "@arciin/shared"
import { isCodeOrTextAsset, isVideoLikeAsset } from "@/lib/utils/viewable-asset"
import { getUserPreferences } from "@/lib/api/user-preferences"
import { queryKeys } from "@/lib/api/query-keys"
import {
  pdfThumbnailSourceKey,
  usePdfThumbnail,
} from "@/hooks/use-pdf-thumbnail"

const THUMB_MEDIA = new Set(["IMAGE", "VIDEO"])

function DocumentThumbnailPlaceholder({
  asset,
  loading = false,
  badgeLabel,
}: {
  asset: AssetSummary
  loading?: boolean
  badgeLabel: string
}) {
  return (
    <AssetPreviewFrame asset={asset} badgeLabel={badgeLabel}>
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 text-muted-foreground">
        <MediaTypeIcon
          mediaType={asset.mediaType}
          filename={asset.originalFilename}
          mimeType={asset.mimeType}
          extension={asset.extension}
          className={cn("size-7", loading && "arciin-doc-icon-pulse")}
        />
      </div>
    </AssetPreviewFrame>
  )
}

function PdfDocumentPreview({ asset }: { asset: AssetSummary }) {
  const pdfUrl = pdfThumbnailSourceKey(asset.id, asset.updatedAt)
  const thumb = usePdfThumbnail(pdfUrl, true)
  const ext = (
    asset.extension ??
    asset.originalFilename.split(".").pop() ??
    "pdf"
  ).toUpperCase()
  const thumbLoading = !thumb
  const badgeLabel = thumbnailStatusLabel(asset, thumbLoading, ext)

  if (thumb) {
    return (
      <AssetPreviewFrame asset={asset} badgeLabel={badgeLabel}>
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${asset.id}-${asset.updatedAt}`}
            src={thumb}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        </div>
      </AssetPreviewFrame>
    )
  }

  return (
    <DocumentThumbnailPlaceholder asset={asset} loading badgeLabel={badgeLabel} />
  )
}

function ServerAssetThumbnail({ asset }: { asset: AssetSummary }) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const [thumbLoaded, setThumbLoaded] = useState(false)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const thumbLoading =
    !thumbFailed && !thumbLoaded && (asset.status === "PROCESSING" || THUMB_MEDIA.has(asset.mediaType))
  const badgeLabel = thumbnailStatusLabel(asset, thumbLoading)

  if (thumbFailed) {
    return <DocumentThumbnailPlaceholder asset={asset} badgeLabel={badgeLabel} />
  }

  return (
    <AssetPreviewFrame asset={asset} badgeLabel={badgeLabel}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbSrc}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          onLoad={() => setThumbLoaded(true)}
          onError={() => setThumbFailed(true)}
        />
      </div>
    </AssetPreviewFrame>
  )
}

function ImageOrIconPreview({ asset }: { asset: AssetSummary }) {
  const { data: prefs } = useQuery({
    queryKey: queryKeys.userPreferences,
    queryFn: ({ signal }) => getUserPreferences(signal),
    staleTime: 60_000,
  })
  const docThumbs = prefs?.media.documentThumbnails ?? false
  const thumbKey = `${asset.id}-${asset.updatedAt}`

  const isPdfDoc =
    docThumbs &&
    assetSupportsDocumentThumbnail(
      asset.mediaType,
      asset.mimeType,
      asset.extension,
      asset.originalFilename,
    )

  if (isPdfDoc) {
    return <PdfDocumentPreview key={thumbKey} asset={asset} />
  }

  if (THUMB_MEDIA.has(asset.mediaType)) {
    return <ServerAssetThumbnail key={thumbKey} asset={asset} />
  }

  const badgeLabel = thumbnailStatusLabel(asset, false)
  return <DocumentThumbnailPlaceholder asset={asset} badgeLabel={badgeLabel} />
}

function VideoAssetPreview({ asset }: { asset: AssetSummary }) {
  const Icon = mediaTypeIcons.VIDEO
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hover, setHover] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const videoSrc = `/api/assets/${asset.id}/download?inline=1&v=${encodeURIComponent(asset.updatedAt)}`

  useEffect(() => {
    const el = videoRef.current
    if (!el) {
      return
    }
    if (hover) {
      void el.play().catch(() => {})
    } else {
      el.pause()
      el.currentTime = 0
    }
  }, [hover])

  const badgeLabel = thumbnailStatusLabel(asset, false)

  return (
    <AssetPreviewFrame asset={asset} badgeLabel={badgeLabel}>
    <div
      className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted/40"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        src={videoSrc}
        muted
        playsInline
        loop
        preload="none"
        aria-hidden
      />
      {!thumbFailed ? (
        <div
          className={cn(
            "absolute inset-0 z-10 bg-muted/40 transition-opacity duration-200",
            hover ? "pointer-events-none opacity-0" : "opacity-100"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbSrc}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        </div>
      ) : (
        <div
          className={cn(
            "absolute inset-0 z-10 flex items-center justify-center bg-muted/80 text-muted-foreground transition-opacity duration-200",
            hover ? "pointer-events-none opacity-0" : "opacity-100"
          )}
        >
          <Icon className="size-8" />
        </div>
      )}
      <span className="sr-only">Video — hover for muted preview</span>
    </div>
    </AssetPreviewFrame>
  )
}

/** Click plays in the bottom music bar — no full-page preview. */
function AudioAssetPreview({ asset }: { asset: AssetSummary }) {
  const Icon = mediaTypeIcons.AUDIO
  const isPlaying = useIsMusicAssetPlaying(asset.id)
  const isActive = useIsMusicAssetActive(asset.id)
  const [thumbFailed, setThumbFailed] = useState(false)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`

  const badgeLabel = thumbnailStatusLabel(asset, false)

  return (
    <AssetPreviewFrame asset={asset} badgeLabel={badgeLabel}>
      <div
        role="button"
        tabIndex={0}
        aria-label={isPlaying ? `Pause ${asset.originalFilename}` : `Play ${asset.originalFilename}`}
        className={cn(
          "relative aspect-[4/3] cursor-pointer overflow-hidden rounded-xl border bg-gradient-to-b from-[var(--arciin-accent-soft,#fff7ed)] via-zinc-50 to-zinc-100/90 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isActive ? "border-primary/50 ring-2 ring-primary/30" : "border-border",
        )}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          toggleMusicAsset(asset)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.stopPropagation()
            toggleMusicAsset(asset)
          }
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,79,18,0.12)_0%,transparent_55%)]"
          aria-hidden
        />

        {!thumbFailed ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-10 transition-opacity duration-200",
              isActive && "opacity-[0.15]",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbSrc}
              alt=""
              className="size-full object-cover"
              loading="lazy"
              onError={() => setThumbFailed(true)}
            />
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <Icon
            className={cn(
              "size-16 shrink-0 text-primary/90 transition-transform duration-300 sm:size-20",
              isActive && "scale-[1.04]",
            )}
            aria-hidden
          />
          <p className="text-[11px] font-medium leading-snug text-zinc-600 sm:text-xs">
            {isPlaying ? "Playing · click to pause" : "Click to play"}
          </p>
        </div>
      </div>
    </AssetPreviewFrame>
  )
}

export function AssetPreview({ asset }: { asset: AssetSummary }) {
  if (isCodeOrTextAsset(asset)) {
    const badgeLabel = thumbnailStatusLabel(asset, false)
    return <DocumentThumbnailPlaceholder asset={asset} badgeLabel={badgeLabel} />
  }
  if (isVideoLikeAsset(asset) || asset.mediaType === "VIDEO") {
    return <VideoAssetPreview asset={asset} />
  }
  if (isAudioLikeAsset(asset)) {
    return <AudioAssetPreview asset={asset} />
  }

  return <ImageOrIconPreview asset={asset} />
}
