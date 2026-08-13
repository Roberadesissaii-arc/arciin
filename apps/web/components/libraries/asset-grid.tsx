import { AssetCard } from "@/components/libraries/asset-card"
import type { AssetSummary } from "@/lib/types/models"

/** Responsive library media grid — matches AssetCard footprint. */
export function AssetGrid({ assets }: { assets: AssetSummary[] }) {
  return (
    <div className="grid grid-cols-2 items-start gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {assets.map((asset) => (
        <AssetCard key={asset.id} asset={asset} />
      ))}
    </div>
  )
}
