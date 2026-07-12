"use client"

import { AssetSourceBadge } from "@/components/libraries/asset-source-badge"
import { resolveAssetBadge } from "@/lib/utils/asset-badge"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * Table cell for the Badge column — shows source chip or an em dash when none.
 */
export function AssetBadgeCell({
  asset,
  className,
}: {
  asset: Pick<AssetSummary, "importSourceUrl" | "uploadClient" | "badgeLabel" | "badgeColor" | "showBadge">
  className?: string
}) {
  const resolved = resolveAssetBadge(asset)

  if (!resolved) {
    return (
      <span className={cn("text-sm font-medium text-zinc-400", className)} aria-hidden>
        —
      </span>
    )
  }

  return <AssetSourceBadge asset={asset} className={cn("max-w-[7.5rem]", className)} />
}
