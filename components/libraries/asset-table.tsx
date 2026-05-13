"use client"

import { Download, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { MoveAssetDialog } from "@/components/libraries/move-asset-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

/** Same fill as primary actions (e.g. Sign in) — solid, not neon hex. */
const typeBadgeClass =
  "border-0 bg-primary text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90"

function AssetRowActions({ asset }: { asset: AssetSummary }) {
  const deleteAssetMutation = useDeleteAsset()

  return (
    <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
      <Button
        asChild
        variant="outline"
        size="sm"
        className="border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]"
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

export function AssetTable({ assets }: { assets: AssetSummary[] }) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-white/8 bg-white/[0.02] p-3">
      <Table className="w-full min-w-0 table-fixed">
        <colgroup>
          <col style={{ width: "34%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <TableHeader>
          <TableRow className="border-white/8 hover:bg-transparent">
            <TableHead className="min-w-0 text-left text-zinc-400">Name</TableHead>
            <TableHead className="text-left text-zinc-400">Type</TableHead>
            <TableHead className="text-left text-zinc-400">Size</TableHead>
            <TableHead className="text-left text-zinc-400">Created</TableHead>
            <TableHead className="text-right text-zinc-400">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((asset) => (
            <TableRow
              key={asset.id}
              className="border-white/8 hover:bg-white/[0.02] [&>td]:align-middle [&>td]:py-2.5"
            >
              <TableCell className="max-w-0 py-2.5">
                <span
                  className="block w-full truncate font-medium text-white"
                  title={asset.originalFilename}
                >
                  {asset.originalFilename}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge
                  className={cn(
                    "inline-flex h-7 min-w-[5.75rem] shrink-0 justify-center rounded-md px-2.5 tabular-nums",
                    typeBadgeClass
                  )}
                >
                  {asset.mediaType}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums text-zinc-400">
                {formatBytes(asset.sizeBytes)}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums text-zinc-400">
                {formatRelativeDate(asset.createdAt)}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <AssetRowActions asset={asset} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
