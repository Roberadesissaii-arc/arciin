import {
  mediaTypeMatchesKind,
  type LibraryKindFilter,
  type SourceFilterValue,
} from "@/hooks/use-library-browser-filters"
import { resolveAssetBadge } from "@/lib/utils/asset-badge"
import { inferDestinationLabel } from "@/lib/utils/media-type"
import type { AssetSummary } from "@/lib/types/models"
import type { FilterDropdownOption } from "@/components/ui/filter-dropdown"

export const SOURCE_ALL = "all"
export const SOURCE_MANUAL = "manual"
export function assetSourceLabel(asset: AssetSummary): string {
  const badge = resolveAssetBadge(asset)
  if (badge?.label) return badge.label
  return inferDestinationLabel(asset.mimeType, asset.originalFilename)
}

export function collectSourceFilterOptions(assets: AssetSummary[]): FilterDropdownOption[] {
  void assets
  return [
    { value: SOURCE_ALL, label: "All sources" },
    { value: SOURCE_MANUAL, label: "Manual uploads", group: "Manual uploads" },
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
  void source
  return assets
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

/** All Files query string for a source. */
export function filesSourceHref(source: SourceFilterValue, folderId?: string | null): string {
  const params: string[] = []
  if (source && source !== SOURCE_ALL) params.push(`source=${source}`)
  if (folderId) params.push(`folder=${encodeURIComponent(folderId)}`)
  return params.length > 0 ? `/files?${params.join("&")}` : "/files"
}


export const GRID_PAGE_SIZE = 30
export const LIST_PAGE_SIZE = 10
