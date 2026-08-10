"use client"

import { useState } from "react"
import { Download, Pencil } from "lucide-react"

import { useAssetSelection } from "@/components/libraries/asset-selection"
import { AssetPreview } from "@/components/libraries/asset-preview"
import { AssetSourceBadge } from "@/components/libraries/asset-source-badge"
import { RenameAssetDialog } from "@/components/libraries/rename-asset-dialog"
import { Button } from "@/components/ui/button"
import { resolveAssetBadge } from "@/lib/utils/asset-badge"
import { dashboardTableActionOutline } from "@/lib/dashboard-table-styles"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatMediaTypeLabel } from "@/lib/utils/media-type"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"
import { RelativeTime } from "@/components/shared/relative-time"

const metaPillClass =
  "inline-flex shrink-0 items-center rounded-md border border-border bg-muted/70 px-2 py-0.5 text-[10px] font-semibold text-foreground"

const tagPillClass =
  "inline-flex shrink-0 items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"

/** Minimum metadata block height — must fit title, status, tags, and action row without clipping. */
const CARD_META_MIN_HEIGHT = "min-h-[8.75rem]"

export function AssetCard({ asset }: { asset: AssetSummary }) {
  const selection = useAssetSelection()
  const selected = selection?.isSelected(asset.id) ?? false
  const [renameOpen, setRenameOpen] = useState(false)

  const dimensionLabel =
    asset.width && asset.height ? `${asset.width} × ${asset.height}` : null

  const typeLabel = formatMediaTypeLabel(asset.mediaType, {
    filename: asset.originalFilename,
    mimeType: asset.mimeType,
    extension: asset.extension,
  })

  const sourceBadge = resolveAssetBadge(asset)

  const onCardClick = (event: React.MouseEvent) => {
    if (!selection) return
    if (event.defaultPrevented) return
    const target = event.target as HTMLElement
    if (target.closest("button, a, input, [data-no-marquee]")) return

    event.preventDefault()
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

  return (
    <article
      data-asset-id={asset.id}
      data-asset-selectable
      onClick={selection ? onCardClick : undefined}
      className={cn(
        "isolate flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
        "transition-[border-color,box-shadow,transform] duration-200 ease-out",
        "hover:-translate-y-px hover:border-primary/30 hover:shadow-md",
        selection && "cursor-pointer",
        selected && "border-primary/50 ring-2 ring-primary/30 ring-offset-0",
      )}
    >
      <div className="relative aspect-[4/3] shrink-0 overflow-hidden rounded-t-2xl bg-muted/30">
        <div className="absolute inset-0 [&_*:not([data-preview-chrome])]:!rounded-none">
          <AssetPreview asset={asset} />
        </div>

        {sourceBadge ? (
          <AssetSourceBadge
            asset={asset}
            className="absolute left-2 top-2 z-10 max-w-[calc(100%-2.75rem)]"
          />
        ) : null}
      </div>

      <div
        className={cn(
          "flex shrink-0 flex-col gap-2 rounded-b-2xl px-3 py-2.5",
          CARD_META_MIN_HEIGHT,
        )}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3
              className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5 text-foreground"
              title={asset.originalFilename}
            >
              {asset.originalFilename}
            </h3>
            <span className={metaPillClass}>{formatBytes(asset.sizeBytes)}</span>
          </div>

          <p className="truncate text-[11px] leading-4 text-muted-foreground">
            <span className="capitalize">{asset.status.toLowerCase()}</span>
            {" · "}
            <RelativeTime value={asset.createdAt} />
          </p>

          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className={tagPillClass}>{typeLabel}</span>
            {asset.extension ? (
              <span className={cn(tagPillClass, "uppercase")}>{asset.extension}</span>
            ) : null}
            {dimensionLabel ? (
              <span className={cn(tagPillClass, "max-w-[5.5rem] truncate")}>{dimensionLabel}</span>
            ) : null}
          </div>
        </div>

        <div className="mt-auto flex shrink-0 items-center gap-1.5 pt-0.5" data-no-marquee>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className={cn(dashboardTableActionOutline, "size-8 w-9 shrink-0 rounded-lg")}
            aria-label="Rename"
            title="Rename"
            onClick={(e) => {
              e.stopPropagation()
              setRenameOpen(true)
            }}
          >
            <Pencil className="size-3.5" />
          </Button>

          <Button
            asChild
            size="sm"
            className="h-9 min-w-0 flex-1 rounded-lg bg-primary text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <a href={`/api/assets/${asset.id}/download`}>
              <Download className="size-3.5" />
              Download
            </a>
          </Button>
        </div>
      </div>

      <RenameAssetDialog asset={asset} open={renameOpen} onOpenChange={setRenameOpen} />
    </article>
  )
}
