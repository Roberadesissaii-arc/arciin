"use client"

import { Download, Trash2 } from "lucide-react"

import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { VideoAssetViewer } from "@/components/libraries/video-asset-viewer"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/utils/format-bytes"
import type { AssetSummary } from "@/lib/types/models"

/**
 * What a file is, and the two things you most often want to do with it.
 *
 * Deliberately adaptive rather than one table for everything: duration and
 * resolution are meaningless for a PDF, and showing empty rows for them reads
 * as missing data rather than an inapplicable field.
 */

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </>
  )
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
    <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
      <MediaTypeIcon
        mediaType={asset.mediaType}
        filename={asset.originalFilename}
        mimeType={asset.mimeType}
        extension={asset.extension}
        className="size-10"
      />
      <span className="text-[11px] uppercase tracking-wider">{asset.extension || "file"}</span>
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
  const summary = [duration, resolution, formatBytes(asset.sizeBytes)].filter(Boolean).join(" · ")

  return (
    <>
      <div className="scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
        {/* The library's own preview component, so a video plays and an image
            renders exactly as it does everywhere else. */}
        <div
          className="flex max-h-[240px] min-h-[120px] items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30"
          data-testid="asset-panel-preview"
        >
          <AssetPreview asset={asset} />
        </div>

        <p className="mt-3 text-[12px] text-muted-foreground tabular-nums">{summary}</p>

        <SectionHeading>Details</SectionHeading>
        <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[12.5px]">
          <Row label="Filename" value={asset.originalFilename} />
          <Row label="Format" value={asset.mimeType} />
          {duration ? <Row label="Duration" value={<span className="tabular-nums">{duration}</span>} /> : null}
          {resolution ? (
            <Row label="Resolution" value={<span className="tabular-nums">{resolution}</span>} />
          ) : null}
          <Row label="Size" value={<span className="tabular-nums">{formatBytes(asset.sizeBytes)}</span>} />
          <Row
            label="Added"
            value={new Date(asset.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          />
        </dl>
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
