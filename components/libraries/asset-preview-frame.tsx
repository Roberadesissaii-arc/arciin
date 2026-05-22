"use client"

import { ExternalLink, Pause, Play } from "lucide-react"

import { useAssetViewerOptional } from "@/components/libraries/asset-viewer-context"
import { ThumbnailStatusBadge } from "@/components/libraries/thumbnail-status-badge"
import { Button } from "@/components/ui/button"
import { toggleMusicAsset, useIsMusicAssetPlaying } from "@/lib/audio/music-player"
import { cn } from "@/lib/utils"
import { isAudioLikeAsset, isViewableAsset } from "@/lib/utils/viewable-asset"
import type { AssetSummary } from "@/lib/types/models"

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
          size="icon"
          data-no-marquee
          className="absolute right-1.5 top-1.5 z-20 size-8 rounded-lg border border-white/10 bg-black/50 text-white shadow-sm opacity-80 backdrop-blur-sm transition-opacity hover:bg-black/65 hover:opacity-100 focus-visible:opacity-100"
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
          size="icon"
          data-no-marquee
          className="absolute right-1.5 top-1.5 z-20 size-8 rounded-lg border border-white/10 bg-black/50 text-white shadow-sm opacity-80 backdrop-blur-sm transition-opacity hover:bg-black/65 hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Open ${asset.originalFilename}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            viewer?.openViewer(asset.id)
          }}
        >
          <ExternalLink className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
