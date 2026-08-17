"use client"

import { Calendar, Clock, Download, FileType2, HardDrive, Maximize2, Trash2 } from "lucide-react"

import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { VideoAssetViewer } from "@/components/libraries/video-asset-viewer"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/utils/format-bytes"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * What a file is, and the two things you most often want to do with it.
 *
 * The facts appear twice on purpose, at two levels of attention: the two or
 * three numbers a person actually scans for as tiles, then everything else as a
 * table beneath. One flat list of six label/value pairs carried the same
 * information and made the useful parts hard to pick out of it.
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

/**
 * Whatever this file is best shown as.
 *
 * A video gets the library's real player, an image its own bytes, and anything
 * else the icon the grid already uses — rather than a broken <img> for a PDF.
 */
function AssetPreview({ asset }: { asset: AssetSummary }) {
  const src = `/api/assets/${asset.id}/download?inline=1&v=${encodeURIComponent(asset.updatedAt)}`

  if (asset.mediaType === "VIDEO") {
    return <VideoAssetViewer src={src} />
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

/** One scannable number, with the icon that says which number it is. */
function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock
  label: string
  value: string
}) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-border bg-muted/25 px-2 py-2 text-center">
      <Icon className="mx-auto size-3.5 text-muted-foreground" aria-hidden />
      <p className="mt-1 truncate text-[12.5px] font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  )
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

  // Only the numbers this kind of file actually has, so the row never carries a
  // tile with a dash in it.
  const tiles = [
    duration ? { icon: Clock, label: "Length", value: duration } : null,
    resolution ? { icon: Maximize2, label: "Pixels", value: resolution } : null,
    { icon: HardDrive, label: "On disk", value: formatBytes(asset.sizeBytes) },
  ].filter(Boolean) as { icon: typeof Clock; label: string; value: string }[]

  /**
   * Tiles earn their space only in pairs.
   *
   * A lone "on disk" tile stretched across the panel for a PDF looked like a
   * placeholder for two missing ones, so a file with a single number skips the
   * summary and lets the table carry it.
   */
  const showTiles = tiles.length >= 2

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
    // Not repeated when a tile above already says it.
    duration && !showTiles
      ? { label: "Duration", value: <span className="tabular-nums">{duration}</span> }
      : null,
    resolution && !showTiles
      ? { label: "Resolution", value: <span className="tabular-nums">{resolution}</span> }
      : null,
    showTiles
      ? null
      : { label: "Size", value: <span className="tabular-nums">{formatBytes(asset.sizeBytes)}</span> },
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
          className="flex max-h-[240px] min-h-[120px] items-center justify-center overflow-hidden rounded-xl border border-border bg-gradient-to-b from-muted/10 to-muted/40 ring-1 ring-black/[0.03]"
          data-testid="asset-panel-preview"
        >
          <AssetPreview asset={asset} />
        </div>

        {/* The numbers worth scanning. */}
        {showTiles ? (
          <div className="flex items-stretch gap-2">
            {tiles.map((tile) => (
              <StatTile key={tile.label} icon={tile.icon} label={tile.label} value={tile.value} />
            ))}
          </div>
        ) : null}

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
