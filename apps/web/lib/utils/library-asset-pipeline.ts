import {
  mediaTypeMatchesKind,
  type LibraryKindFilter,
  type LibrarySortMode,
  type SourceFilterValue,
} from "@/hooks/use-library-browser-filters"
import { resolveAssetBadge } from "@/lib/utils/asset-badge"
import {
  filterAssetsByBadge,
  type BadgeFilterValue,
} from "@/lib/utils/asset-badge-filter"
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
  if (kind === "all") return assets
  return assets.filter((a) => mediaTypeMatchesKind(a.mediaType, kind))
}

export function filterAssetsBySource(
  assets: AssetSummary[],
  source: SourceFilterValue,
): AssetSummary[] {
  if (source === "all") return assets
  return assets.filter((a) => assetSourceLabel(a) === source)
}

export function sortLibraryAssets(
  assets: AssetSummary[],
  sort: LibrarySortMode,
): AssetSummary[] {
  const next = [...assets]
  switch (sort) {
    case "name":
      next.sort((a, b) =>
        a.originalFilename.localeCompare(b.originalFilename, undefined, {
          sensitivity: "base",
        }),
      )
      break
    case "size":
      next.sort((a, b) => b.sizeBytes - a.sizeBytes)
      break
    case "type":
      next.sort((a, b) =>
        a.mediaType.localeCompare(b.mediaType) ||
        a.originalFilename.localeCompare(b.originalFilename),
      )
      break
    case "modified":
    default:
      next.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      break
  }
  return next
}

export function pipelineLibraryAssets(
  assets: AssetSummary[],
  options: {
    badgeFilter: BadgeFilterValue
    kindFilter: LibraryKindFilter
    sourceFilter: SourceFilterValue
    sort: LibrarySortMode
    /** When false, skip kind filter (scoped library pages). */
    applyKind?: boolean
  },
): AssetSummary[] {
  let next = filterAssetsByBadge(assets, options.badgeFilter)
  if (options.applyKind !== false) {
    next = filterAssetsByKind(next, options.kindFilter)
  }
  next = filterAssetsBySource(next, options.sourceFilter)
  return sortLibraryAssets(next, options.sort)
}

export const GRID_PAGE_SIZE = 30
export const LIST_PAGE_SIZE = 10
