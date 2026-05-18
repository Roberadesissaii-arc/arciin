"use client"

import { useState } from "react"
import { Download, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useAssetSelection } from "@/components/libraries/asset-selection"
import { MoveAssetDialog } from "@/components/libraries/move-asset-dialog"
import { AppPagination } from "@/components/ui/app-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useDeleteAsset } from "@/hooks/use-assets"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatMediaTypeLabel } from "@/lib/utils/media-type"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

const PAGE_SIZE = 10

const typeBadgeClass =
  "border-0 bg-primary text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90"

function AssetRowActions({ asset }: { asset: AssetSummary }) {
  const deleteAssetMutation = useDeleteAsset()

  return (
    <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2" data-no-marquee>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="border-border bg-card text-foreground hover:bg-muted/50"
      >
        <a href={`/api/assets/${asset.id}/download`}>
          <Download className="size-4" />
          Download
        </a>
      </Button>
      <MoveAssetDialog asset={asset} />
      <Button
        type="button"
        variant="default"
        size="sm"
        className="border-0 bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626] focus-visible:ring-2 focus-visible:ring-[#EF4444]/50"
        disabled={deleteAssetMutation.isPending}
        onClick={async () => {
          try {
            await deleteAssetMutation.mutateAsync(asset.id)
            toast.success("Asset deleted.")
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not delete asset.")
          }
        }}
      >
        <Trash2 className="size-4" />
        Delete
      </Button>
    </div>
  )
}

function AssetTableRow({ asset }: { asset: AssetSummary }) {
  const selection = useAssetSelection()
  const selected = selection?.isSelected(asset.id) ?? false

  const onRowClick = (event: React.MouseEvent) => {
    if (!selection) return
    const target = event.target as HTMLElement
    if (target.closest("button, a, input, [data-no-marquee]")) return

    const additive = event.metaKey || event.ctrlKey
    const range = event.shiftKey
    if (range || additive) {
      selection.toggle(asset.id, { additive: additive || range, range })
    } else {
      selection.selectOnly(asset.id)
    }
  }

  return (
    <TableRow
      data-asset-id={asset.id}
      data-asset-selectable
      onClick={selection ? onRowClick : undefined}
      className={cn(
        "border-border hover:bg-muted/30 [&>td]:align-middle [&>td]:py-2.5",
        selection && "cursor-pointer",
        selected && "bg-primary/[0.06] hover:bg-primary/[0.08]",
      )}
    >
      {selection ? (
        <TableCell className="w-10 py-2.5 pl-4" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selected}
            aria-label={`Select ${asset.originalFilename}`}
            onCheckedChange={() => {
              selection.toggle(asset.id, { additive: true })
            }}
          />
        </TableCell>
      ) : null}
      <TableCell className={cn("max-w-0 py-2.5", !selection && "pl-4")}>
        <span
          className="block w-full truncate font-medium text-foreground"
          title={asset.originalFilename}
        >
          {asset.originalFilename}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge
          className={cn(
            "inline-flex h-7 min-w-[5.75rem] shrink-0 justify-center rounded-md px-2.5 tabular-nums",
            typeBadgeClass,
          )}
        >
          {formatMediaTypeLabel(asset.mediaType)}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums font-medium text-zinc-700">
        {formatBytes(asset.sizeBytes)}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums font-medium text-zinc-700">
        {formatRelativeDate(asset.createdAt)}
      </TableCell>
      <TableCell className="whitespace-nowrap pr-4 text-right">
        <AssetRowActions asset={asset} />
      </TableCell>
    </TableRow>
  )
}

export function AssetTable({ assets }: { assets: AssetSummary[] }) {
  const [page, setPage] = useState(1)
  const selection = useAssetSelection()
  const totalPages = Math.max(1, Math.ceil(assets.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageAssets = assets.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const allOnPageSelected =
    pageAssets.length > 0 && pageAssets.every((a) => selection?.isSelected(a.id))

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-border bg-card">
      <Table className="w-full min-w-0 table-fixed">
        <colgroup>
          {selection ? <col style={{ width: "3%" }} /> : null}
          <col style={{ width: selection ? "31%" : "34%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            {selection ? (
              <TableHead className="pl-4">
                <Checkbox
                  checked={allOnPageSelected}
                  aria-label="Select all on this page"
                  onCheckedChange={(checked) => {
                    if (!selection) return
                    if (checked) {
                      const next = new Set(selection.selectedIds)
                      for (const a of pageAssets) next.add(a.id)
                      selection.setSelectedIds(next)
                    } else {
                      const next = new Set(selection.selectedIds)
                      for (const a of pageAssets) next.delete(a.id)
                      selection.setSelectedIds(next)
                    }
                  }}
                />
              </TableHead>
            ) : null}
            <TableHead className={cn("min-w-0 text-left font-semibold text-zinc-700", !selection && "pl-4")}>
              Name
            </TableHead>
            <TableHead className="text-left font-semibold text-zinc-700">Type</TableHead>
            <TableHead className="text-left font-semibold text-zinc-700">Size</TableHead>
            <TableHead className="text-left font-semibold text-zinc-700">Created</TableHead>
            <TableHead className="pr-4 text-right font-semibold text-zinc-700">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageAssets.map((asset) => (
            <AssetTableRow key={asset.id} asset={asset} />
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="border-t border-border px-4 py-3">
          <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}
