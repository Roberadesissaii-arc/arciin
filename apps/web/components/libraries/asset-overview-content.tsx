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

/**
 * Whatever this file is best shown as.
 *
 * A video gets the library's real player, an image its own bytes, and anything
 * else the icon the grid already uses — rather than a broken <img> for a PDF.
 */
function AssetPreview({ asset }: { asset: AssetSummary }) {
  const src = `/api/assets/${asset.id}/download?inline=1&v=${encodeURIComponent(asset.updatedAt)}`

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
            asset.mediaType === "VIDEO" ? "w-full" : "max-h-[240px] min-h-[120px]",
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
