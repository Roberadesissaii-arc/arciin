"use client"

import { useState } from "react"
import { Download, Files, Pencil, Trash2 } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { AssetBadgeCell } from "@/components/libraries/asset-badge-cell"
import { useAssetSelection } from "@/components/libraries/asset-selection"
import { notifyDeleted } from "@/lib/notifications/toast-actions"
import { MoveAssetDialog } from "@/components/libraries/move-asset-dialog"
import { RenameAssetDialog } from "@/components/libraries/rename-asset-dialog"
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
import {
  dashboardTableBodyRow,
  dashboardTableHeadCell,
  dashboardTableHeadRow,
  dashboardTablePanel,
  dashboardTablePanelHeader,
  dashboardTableActionDanger,
  dashboardTableActionOutline,
} from "@/lib/dashboard-table-styles"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatMediaTypeLabel } from "@/lib/utils/media-type"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"
import { RelativeTime } from "@/components/shared/relative-time"

const PAGE_SIZE = 10

const typeBadgeClass =
  "border-0 bg-primary text-[11px] font-bold uppercase tracking-wide text-primary-foreground shadow-none"

function AssetRowActions({ asset }: { asset: AssetSummary }) {
  const deleteAssetMutation = useDeleteAsset()
  const [renameOpen, setRenameOpen] = useState(false)

  return (
    <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5" data-no-marquee>
      <Button asChild variant="outline" size="sm" className={dashboardTableActionOutline}>
        <a href={`/api/assets/${asset.id}/download`}>
          <Download className="size-3.5" />
          Download
        </a>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Edit"
        title="Edit"
        className="size-7 rounded-md border-zinc-300 bg-card text-zinc-700 hover:bg-zinc-100"
        onClick={() => setRenameOpen(true)}
      >
        <Pencil className="size-3.5" />
      </Button>
      <RenameAssetDialog asset={asset} open={renameOpen} onOpenChange={setRenameOpen} />
      <MoveAssetDialog asset={asset} triggerClassName={dashboardTableActionOutline} />
      <Button
        type="button"
        variant="default"
        size="sm"
        className={dashboardTableActionDanger}
        disabled={deleteAssetMutation.isPending}
        onClick={async () => {
          try {
            await deleteAssetMutation.mutateAsync(asset.id)
            notifyDeleted()
          } catch (error) {
            toast.error("Could not delete asset", {
              description: error instanceof Error ? error.message : "Try again in a moment.",
            })
          }
        }}
      >
        <Trash2 className="size-3.5" />
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
    } else if (selected) {
      selection.toggle(asset.id, { additive: true })
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
        dashboardTableBodyRow,
        "[&>td]:align-middle [&>td]:py-3.5",
        selection && "cursor-pointer",
        selected && "bg-primary/[0.05] hover:bg-primary/[0.07]",
      )}
    >
      {selection ? (
        <TableCell className="w-10 py-3.5 pl-5" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selected}
            aria-label={`Select ${asset.originalFilename}`}
            onCheckedChange={() => {
              selection.toggle(asset.id, { additive: true })
            }}
          />
        </TableCell>
      ) : null}
      <TableCell className={cn("max-w-0 overflow-hidden py-3.5", !selection && "pl-5")}>
        <span
          className="block min-w-0 truncate text-[13px] font-medium leading-snug text-foreground"
          title={asset.originalFilename}
        >
          {asset.originalFilename}
        </span>
      </TableCell>
      <TableCell className="py-3.5">
        <AssetBadgeCell asset={asset} />
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5">
        <Badge
          className={cn(
            "inline-flex h-7 min-w-[5rem] shrink-0 justify-center rounded-md px-2.5",
            typeBadgeClass,
          )}
        >
          {formatMediaTypeLabel(asset.mediaType, {
            filename: asset.originalFilename,
            mimeType: asset.mimeType,
            extension: asset.extension,
          })}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5 text-[13px] tabular-nums text-zinc-600">
        {formatBytes(asset.sizeBytes)}
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5 text-[13px] tabular-nums text-zinc-500">
        <RelativeTime value={asset.createdAt} />
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5 pr-5 text-right">
        <AssetRowActions asset={asset} />
      </TableCell>
    </TableRow>
  )
}

export function AssetTable({
  assets,
  title = "Files",
  /** When provided with page/totalPages, parent owns pagination (list view page size 10). */
  totalCount,
  page: controlledPage,
  totalPages: controlledTotalPages,
  onPageChange,
  alwaysShowPagination = false,
}: {
  assets: AssetSummary[]
  title?: string
  totalCount?: number
  page?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  /** Keep Previous/Next footer visible even on a single page. */
  alwaysShowPagination?: boolean
}) {
  const [internalPage, setInternalPage] = useState(1)
  const selection = useAssetSelection()
  const controlled = typeof controlledPage === "number" && typeof onPageChange === "function"
  const totalPages = controlled
    ? Math.max(1, controlledTotalPages ?? 1)
    : Math.max(1, Math.ceil(assets.length / PAGE_SIZE))
  const page = controlled ? controlledPage : Math.min(internalPage, totalPages)
  const setPage = controlled ? onPageChange! : setInternalPage
  const pageAssets = controlled
    ? assets
    : assets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const fileCount = totalCount ?? assets.length

  const allOnPageSelected =
    pageAssets.length > 0 && pageAssets.every((a) => selection?.isSelected(a.id))

  return (
    <div className={cn(dashboardTablePanel, "min-w-0 max-w-full")}>
      <div className={dashboardTablePanelHeader}>
        <Files className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="ml-auto rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
          {fileCount} file{fileCount === 1 ? "" : "s"}
          {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
        </span>
      </div>

      <Table className="w-full min-w-0 table-fixed">
        <colgroup>
          {selection ? <col style={{ width: "3%" }} /> : null}
          <col style={{ width: selection ? "18%" : "20%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: selection ? "32%" : "33%" }} />
        </colgroup>
        <TableHeader>
          <TableRow className={dashboardTableHeadRow}>
            {selection ? (
              <TableHead className="pl-5">
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
            <TableHead className={cn(dashboardTableHeadCell, !selection && "pl-5")}>Name</TableHead>
            <TableHead className={dashboardTableHeadCell}>Badge</TableHead>
            <TableHead className={dashboardTableHeadCell}>Type</TableHead>
            <TableHead className={dashboardTableHeadCell}>Size</TableHead>
            <TableHead className={dashboardTableHeadCell}>Created</TableHead>
            <TableHead className={cn(dashboardTableHeadCell, "pr-5 text-right")}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageAssets.map((asset) => (
            <AssetTableRow key={asset.id} asset={asset} />
          ))}
        </TableBody>
      </Table>

      {(alwaysShowPagination || totalPages > 1) && (
        <div className="sticky bottom-0 z-10 border-t border-zinc-200 bg-white/95 px-5 py-3 backdrop-blur-sm">
          <AppPagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            alwaysShow={alwaysShowPagination}
          />
        </div>
      )}
    </div>
  )
}
