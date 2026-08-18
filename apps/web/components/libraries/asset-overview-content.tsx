"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Calendar, Clock, Download, FileType2, HardDrive, Maximize2, Pause, Play, Trash2 } from "lucide-react"
import { assetSupportsDocumentThumbnail, DEFAULT_USER_PREFERENCES } from "@arciin/shared"

import { AudioCardArtwork } from "@/components/libraries/audio-card-artwork"
import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { VideoAssetViewer } from "@/components/libraries/video-asset-viewer"
import { Button } from "@/components/ui/button"
import { getUserPreferences } from "@/lib/api/user-preferences"
import { queryKeys } from "@/lib/api/query-keys"
import {
  toggleMusicAsset,
  useIsMusicAssetActive,
  useIsMusicAssetPlaying,
} from "@/lib/audio/music-player"
import { formatBytes } from "@/lib/utils/format-bytes"
import { isAudioLikeAsset } from "@/lib/utils/viewable-asset"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * What a file is, and the two things you most often want to do with it.
 *
 * Every fact is stated once, in one table. An earlier version promoted length,
 * pixels and size into tiles above it on the theory that they are what people
 * scan for — but the panel then said the same numbers twice, in two shapes, and
 * the eye had to check whether the tile and the row agreed. One list, read
 * straight down, turned out to be easier to use than a summary plus a list.
 *
 * Deliberately adaptive rather than one table for everything: duration and
 * resolution are meaningless for a PDF, and an empty row for them reads as
 * missing data rather than an inapplicable field.
 */

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  // Hours only when there are hours — "0:03:07" reads worse than "3:07".
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}

/** Fallback when there is no previewable bitmap — icon + extension chip. */
function FileTypeFallback({ asset }: { asset: AssetSummary }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
      <MediaTypeIcon
        mediaType={asset.mediaType}
        filename={asset.originalFilename}
        mimeType={asset.mimeType}
        extension={asset.extension}
        className="size-10"
      />
      <span className="text-[11px] font-medium uppercase tracking-wider">
        {asset.extension || "file"}
      </span>
    </div>
  )
}

/**
 * Document / PDF preview for the side panel.
 *
 * Cards already show a generated thumbnail when one exists. The panel used to
 * always fall through to a plain "PDF" icon — so a file that looked like a
 * document on the grid looked empty once opened. Try the thumbnail first; only
 * fall back to the icon when there is nothing to show.
 */
function DocumentPanelPreview({ asset }: { asset: AssetSummary }) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`

  if (thumbFailed) {
    return <FileTypeFallback asset={asset} />
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbSrc}
      alt={asset.originalFilename}
      className="max-h-[240px] w-full bg-white object-contain"
      onError={() => setThumbFailed(true)}
      data-testid="asset-panel-document-thumb"
    />
  )
}

/**
 * Music in the side panel drives the same bottom player the cards do.
 *
 * A naked <audio> here would play without the scrubber people already know,
 * and would fight the global bar for the same track. One play control → one
 * MusicPlayerBar in the page center.
 */
function AudioPanelPreview({ asset }: { asset: AssetSummary }) {
  const isPlaying = useIsMusicAssetPlaying(asset.id)
  const isActive = useIsMusicAssetActive(asset.id)

  return (
    <div className="relative w-full">
      <button
        type="button"
        data-testid="asset-panel-audio-play"
        aria-label={isPlaying ? `Pause ${asset.originalFilename}` : `Play ${asset.originalFilename}`}
        className="relative w-full cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        onClick={() => toggleMusicAsset(asset)}
      >
        <AudioCardArtwork isPlaying={isPlaying} isActive={isActive} className="aspect-[16/10]" />
        <span
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center",
          )}
          aria-hidden
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm ring-1 ring-white/20">
            {isPlaying ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="size-5 translate-x-px fill-current" />
            )}
          </span>
        </span>
      </button>
    </div>
  )
}

/**
 * Whatever this file is best shown as.
 *
 * A video gets the library's real player, an image its own bytes, audio the
 * shared music bar, and documents their generated thumbnail when one exists —
 * rather than a broken <img> for a PDF that never got one.
 */
function AssetPreview({ asset }: { asset: AssetSummary }) {
  const src = `/api/assets/${asset.id}/download?inline=1&v=${encodeURIComponent(asset.updatedAt)}`
  const { data: prefs } = useQuery({
    queryKey: queryKeys.userPreferences,
    queryFn: ({ signal }) => getUserPreferences(signal),
    staleTime: 60_000,
  })
  const docThumbs =
    prefs?.media.documentThumbnails ?? DEFAULT_USER_PREFERENCES.media.documentThumbnails

  if (asset.mediaType === "VIDEO") {
    return <VideoAssetViewer src={src} compact controlsBelow />
  }
  if (asset.mediaType === "IMAGE") {
    return (
      /* Asset bytes come from the API, not a build-time optimisable source. */
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={asset.originalFilename}
        className="max-h-[240px] w-full object-contain"
      />
    )
  }
  if (isAudioLikeAsset(asset) || asset.mediaType === "AUDIO") {
    return <AudioPanelPreview asset={asset} />
  }
  if (
    docThumbs &&
    assetSupportsDocumentThumbnail(
      asset.mediaType,
      asset.mimeType,
      asset.extension,
      asset.originalFilename,
    )
  ) {
    return <DocumentPanelPreview asset={asset} />
  }
  return <FileTypeFallback asset={asset} />
}

/** A table row. Striped, so the eye can follow a long value across. */
function Row({
  label,
  children,
  index,
}: {
  label: string
  children: React.ReactNode
  index: number
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[84px_1fr] items-start gap-3 px-3 py-2",
        index % 2 === 1 && "bg-muted/20",
      )}
    >
      <dt className="text-[11.5px] font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-[12.5px] text-foreground">{children}</dd>
    </div>
  )
}

export function AssetOverviewContent({
  asset,
  onDownload,
  onDelete,
}: {
  asset: AssetSummary
  onDownload: () => void
  onDelete: () => void
}) {
  const duration = formatDuration(asset.durationSeconds)
  const resolution = asset.width && asset.height ? `${asset.width}×${asset.height}` : null

  /**
   * The whole table, in the order someone reads it.
   *
   * Name first because it identifies the thing; then what it is; then the
   * measurements that used to be tiles; then when it arrived. Rows are omitted
   * rather than dashed — a PDF has no length, and a row saying so is noise.
   */
  const rows = [
    { label: "Filename", value: <span className="break-words">{asset.originalFilename}</span> },
    {
      label: "Format",
      value: (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
          <FileType2 className="size-3 text-muted-foreground" aria-hidden />
          {asset.mimeType}
        </span>
      ),
    },
    duration
      ? {
          label: "Length",
          value: (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Clock className="size-3 text-muted-foreground" aria-hidden />
              {duration}
            </span>
          ),
        }
      : null,
    resolution
      ? {
          label: "Pixels",
          value: (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Maximize2 className="size-3 text-muted-foreground" aria-hidden />
              {resolution}
            </span>
          ),
        }
      : null,
    {
      label: "On disk",
      value: (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <HardDrive className="size-3 text-muted-foreground" aria-hidden />
          {formatBytes(asset.sizeBytes)}
        </span>
      ),
    },
    {
      label: "Added",
      value: (
        <span className="inline-flex items-center gap-1.5">
          <Calendar className="size-3 text-muted-foreground" aria-hidden />
          {new Date(asset.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
      ),
    },
  ].filter(Boolean) as { label: string; value: React.ReactNode }[]

  return (
    <>
      <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
        {/* The file itself, framed rather than floating on the panel. */}
        <div
          className={cn(
            "flex items-center justify-center overflow-hidden rounded-xl border border-border",
            "bg-gradient-to-b from-muted/10 to-muted/40 ring-1 ring-black/[0.03]",
            // The video player now carries its own frame and its controls
            // beneath it, so this wrapper only has to hold stills and icons.
            // Audio artwork fills the frame edge-to-edge.
            asset.mediaType === "VIDEO" || isAudioLikeAsset(asset) || asset.mediaType === "AUDIO"
              ? "w-full"
              : "max-h-[240px] min-h-[120px]",
          )}
          data-testid="asset-panel-preview"
        >
          <AssetPreview asset={asset} />
        </div>

        <div>
          <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Details
          </h3>
          <dl className="mt-1.5 overflow-hidden rounded-xl border border-border">
            {rows.map((row, index) => (
              <Row key={row.label} label={row.label} index={index}>
                {row.value}
              </Row>
            ))}
          </dl>
        </div>
      </div>

      {/* Download acts immediately; Delete asks first. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border p-2">
        <Button
          type="button"
          className="h-10 flex-1 bg-primary text-white hover:bg-primary/90"
          onClick={onDownload}
          data-testid="asset-panel-download"
        >
          <Download className="size-4" />
          Download
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          data-testid="asset-panel-delete"
          aria-label="Delete file"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </>
  )
}
