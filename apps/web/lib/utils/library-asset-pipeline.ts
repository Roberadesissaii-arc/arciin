import {
  mediaTypeMatchesKind,
  type LibraryKindFilter,
  type SourceFilterValue,
} from "@/hooks/use-library-browser-filters"
import { resolveAssetBadge } from "@/lib/utils/asset-badge"
import { inferDestinationLabel } from "@/lib/utils/media-type"
import type { AssetSummary } from "@/lib/types/models"
import type { FilterDropdownOption } from "@/components/ui/filter-dropdown"

export function assetSourceLabel(asset: AssetSummary): string {
  const badge = resolveAssetBadge(asset)
  if (badge?.label) return badge.label
  return inferDestinationLabel(asset.mimeType, asset.originalFilename)
}

export function collectSourceFilterOptions(assets: AssetSummary[]): FilterDropdownOption[] {
  const seen = new Map<string, FilterDropdownOption>()
  for (const asset of assets) {
    const label = assetSourceLabel(asset)
    if (!label || seen.has(label)) continue
    seen.set(label, { value: label, label })
  }
  return [
    { value: "all", label: "All sources" },
    ...[...seen.values()].sort((a, b) => a.label.localeCompare(b.label)),
  ]
}

export function filterAssetsByKind(
  assets: AssetSummary[],
  kind: LibraryKindFilter,
): AssetSummary[] {
  if (kind === "all") {
    // All Files default: hide user-archived (Archives chip shows those).
    return assets.filter((a) => !a.archivedAt)
  }
  return assets.filter((a) => mediaTypeMatchesKind(a.mediaType, kind, a.archivedAt))
}

export function filterAssetsBySource(
  assets: AssetSummary[],
  source: SourceFilterValue,
): AssetSummary[] {
  if (source === "all") return assets
  return assets.filter((a) => assetSourceLabel(a) === source)
}

export function pipelineLibraryAssets(
  assets: AssetSummary[],
  options: {
    kindFilter: LibraryKindFilter
    sourceFilter: SourceFilterValue
    /** When false, skip kind filter (scoped library pages). */
    applyKind?: boolean
  },
): AssetSummary[] {
  let next = assets
  if (options.applyKind !== false) {
    next = filterAssetsByKind(next, options.kindFilter)
  }
  return filterAssetsBySource(next, options.sourceFilter)
}

export const GRID_PAGE_SIZE = 30
export const LIST_PAGE_SIZE = 10
