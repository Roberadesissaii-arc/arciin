"use client"

import { Download, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { AssetPreview } from "@/components/libraries/asset-preview"
import { MoveAssetDialog } from "@/components/libraries/move-asset-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useDeleteAsset } from "@/hooks/use-assets"
import { formatBytes } from "@/lib/utils/format-bytes"
import type { AssetSummary } from "@/lib/types/models"

export function AssetCard({ asset }: { asset: AssetSummary }) {
  const deleteAssetMutation = useDeleteAsset()

  return (
    <Card className="min-w-0 border-border bg-card shadow-none">
      <CardHeader className="space-y-0 pb-2 pt-2.5">
        <AssetPreview asset={asset} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <CardTitle className="truncate text-foreground">{asset.originalFilename}</CardTitle>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatBytes(asset.sizeBytes)}</span>
            <span className="size-1 shrink-0 rounded-full bg-border" />
            <Badge className="rounded-md border-0 bg-primary px-2 py-0 text-[11px] font-semibold text-primary-foreground shadow-none hover:bg-primary/90">
              {asset.mediaType}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="rounded-md border-0 bg-muted px-2 py-0 text-[11px] font-medium text-muted-foreground shadow-none hover:bg-muted">
            {asset.status}
          </Badge>
          {asset.width && asset.height ? (
            <Badge className="rounded-md border-0 bg-muted px-2 py-0 text-[11px] font-medium text-muted-foreground shadow-none hover:bg-muted">
              {asset.width} × {asset.height}
            </Badge>
          ) : null}
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          asChild
          variant="outline"
          className="flex-1 border-border bg-card text-foreground hover:bg-muted/50"
        >
          <a href={`/api/assets/${asset.id}/download`}>
            <Download className="size-4" />
            Download
          </a>
        </Button>
        <MoveAssetDialog asset={asset} />
        <Button
          variant="outline"
          className="border-border bg-card text-foreground hover:bg-muted/50"
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
        </Button>
      </CardFooter>
    </Card>
  )
}
