"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { AssetPreviewFrame } from "@/components/libraries/asset-preview-frame"
import { AudioCardArtwork } from "@/components/libraries/audio-card-artwork"
import { VideoHoverThumb } from "@/components/libraries/video-hover-thumb"
import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { thumbnailStatusLabel } from "@/components/libraries/thumbnail-status-badge"
import { cn } from "@/lib/utils"
import {
  toggleMusicAsset,
  useIsMusicAssetActive,
  useIsMusicAssetPlaying,
} from "@/lib/audio/music-player"
import { isAudioLikeAsset } from "@/lib/utils/viewable-asset"
import type { AssetSummary } from "@/lib/types/models"
import { assetSupportsDocumentThumbnail, DEFAULT_USER_PREFERENCES } from "@arciin/shared"
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
            draggable={false}
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
          draggable={false}
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
  const docThumbs =
    prefs?.media.documentThumbnails ?? DEFAULT_USER_PREFERENCES.media.documentThumbnails
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
  const badgeLabel = thumbnailStatusLabel(asset, false)

  return (
    <AssetPreviewFrame asset={asset} badgeLabel={badgeLabel}>
      <VideoHoverThumb
        asset={asset}
        className="aspect-[4/3] rounded-xl border border-border bg-muted/40"
      />
    </AssetPreviewFrame>
  )
}

/** Click plays in the bottom music bar — no full-page preview. */
function AudioAssetPreview({ asset }: { asset: AssetSummary }) {
  const isPlaying = useIsMusicAssetPlaying(asset.id)
  const isActive = useIsMusicAssetActive(asset.id)
  const ext = (asset.extension ?? asset.originalFilename.split(".").pop() ?? "").trim().toUpperCase()
  const badgeLabel = thumbnailStatusLabel(asset, false, ext || undefined)

  return (
    <AssetPreviewFrame asset={asset} badgeLabel={badgeLabel}>
      <div
        role="button"
        tabIndex={0}
        aria-label={isPlaying ? `Pause ${asset.originalFilename}` : `Play ${asset.originalFilename}`}
        className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl"
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
        <AudioCardArtwork isPlaying={isPlaying} isActive={isActive} />
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
