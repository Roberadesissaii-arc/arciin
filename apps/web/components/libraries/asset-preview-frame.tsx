"use client"

import { Maximize2, Pause, Play } from "lucide-react"

import { useAssetViewerOptional } from "@/components/libraries/asset-viewer-context"
import { ThumbnailStatusBadge } from "@/components/libraries/thumbnail-status-badge"
import { Button } from "@/components/ui/button"
import { toggleMusicAsset, useIsMusicAssetPlaying } from "@/lib/audio/music-player"
import { cn } from "@/lib/utils"
import { isAudioLikeAsset, isViewableAsset } from "@/lib/utils/viewable-asset"
import type { AssetSummary } from "@/lib/types/models"

/** Inset top-right; medium radius on all four corners (must keep data-preview-chrome). */
const previewCornerActionClass =
  "absolute right-2 top-2 z-20 !size-8 !rounded-xl border border-white/15 bg-black/55 text-white shadow-sm backdrop-blur-sm hover:bg-black/70 focus-visible:opacity-100"

export function AssetPreviewFrame({
  asset,
  badgeLabel,
  className,
  children,
}: {
  asset: AssetSummary
  badgeLabel: string
  className?: string
  children: React.ReactNode
}) {
  const viewer = useAssetViewerOptional()
  const isAudio = isAudioLikeAsset(asset)
  const canOpen = isViewableAsset(asset) && viewer?.canOpen(asset)
  const isPlaying = useIsMusicAssetPlaying(asset.id)

  return (
    <div className={cn("group/preview relative", className)}>
      {children}
      <ThumbnailStatusBadge label={badgeLabel} />
      {isAudio ? (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          data-no-marquee
          data-preview-chrome
          className={cn(previewCornerActionClass, "transition-opacity [&_svg]:size-3.5")}
          aria-label={isPlaying ? `Pause ${asset.originalFilename}` : `Play ${asset.originalFilename}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            toggleMusicAsset(asset)
          }}
        >
          {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
      ) : canOpen ? (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          data-no-marquee
          data-preview-chrome
          className={cn(previewCornerActionClass, "transition-opacity [&_svg]:size-3.5")}
          aria-label={`Open ${asset.originalFilename}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            viewer?.openViewer(asset.id)
          }}
        >
          <Maximize2 className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
