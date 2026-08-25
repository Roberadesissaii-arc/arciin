"use client"

import { AssetCard } from "@/components/libraries/asset-card"
import { SelectableAssetsContainer } from "@/components/libraries/selectable-assets-container"
import { Skeleton } from "@/components/ui/skeleton"
import { useAssets } from "@/hooks/use-assets"
import {
  dashboardOverviewUploadsBody,
  DASHBOARD_UPLOADS_LIMIT,
  dashboardUploadsGrid,
} from "@/lib/dashboard-card-styles"
import { cn } from "@/lib/utils"

/**
 * Overview “Recent uploads” — same compact media cards as library grids,
 * laid out in a 5×3 (15) grid on wide screens.
 */
export function RecentUploadsPanel({ className }: { className?: string }) {
  // Same list as All Files — API excludes folders marked "Hide from All Files".
  const assetsQuery = useAssets()
  const assets = (assetsQuery.data ?? []).slice(0, DASHBOARD_UPLOADS_LIMIT)

  if (assetsQuery.isLoading) {
    return (
      <div className={cn(dashboardOverviewUploadsBody, className)}>
        <div className={dashboardUploadsGrid}>
          {Array.from({ length: DASHBOARD_UPLOADS_LIMIT }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-[14.25rem] rounded-2xl border border-zinc-200/80"
            />
          ))}
        </div>
      </div>
    )
  }

  if (assetsQuery.isError) {
    return (
      <div className={cn(dashboardOverviewUploadsBody, className)}>
        <div className="rounded-xl border border-red-500/20 bg-red-50/80 p-4 text-sm text-red-800">
          {assetsQuery.error instanceof Error
            ? assetsQuery.error.message
            : "Could not load recent uploads."}
        </div>
      </div>
    )
  }

  if (!assets.length) {
    return (
      <div className={cn(dashboardOverviewUploadsBody, className)}>
        <div
          className={cn(
            "flex min-h-[12rem] flex-col items-center justify-center rounded-2xl",
            "border border-dashed border-zinc-300/90 px-4 py-10 text-center",
          )}
        >
          <p className="text-sm font-semibold text-zinc-900">No uploads yet</p>
          <p className="mt-1 max-w-[18rem] text-sm leading-relaxed text-zinc-500">
            Drop files anywhere in the app to start routing them into your libraries.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(dashboardOverviewUploadsBody, className)}>
      <SelectableAssetsContainer assets={assets}>
        <div className={dashboardUploadsGrid}>
          {assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      </SelectableAssetsContainer>
    </div>
  )
}
