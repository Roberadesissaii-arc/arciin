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

/**
 * Which archived files an All Files request should ask for.
 *
 * Browsing hides archived files — that is what archiving is for. Searching does
 * not: someone typing a filename wants the file wherever it went, and an
 * archived file that silently fails to match reads as a lost file. Trash is
 * never included either way; the server excludes deleted rows unconditionally.
 */
export function allFilesArchivedMode(input: {
  kindFilter: LibraryKindFilter
  search: string
}): "exclude" | "only" | "include" {
  if (input.kindFilter === "ARCHIVE") return "only"
  if (input.kindFilter === "OTHER") return "exclude"
  return input.search.trim() ? "include" : "exclude"
}

export function filterAssetsByKind(
  assets: AssetSummary[],
  kind: LibraryKindFilter,
  options: { includeArchived?: boolean } = {},
): AssetSummary[] {
  if (kind === "all") {
    // All Files default: hide user-archived (Archives chip shows those).
    return options.includeArchived ? assets : assets.filter((a) => !a.archivedAt)
  }
  if (options.includeArchived && kind !== "ARCHIVE") {
    // A search inside a kind chip: archived files match by what they are.
    return assets.filter((a) => mediaTypeMatchesKind(a.mediaType, kind, null))
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
    /** Search results keep archived files (badged) instead of hiding them. */
    includeArchived?: boolean
  },
): AssetSummary[] {
  let next = assets
  if (options.applyKind !== false) {
    next = filterAssetsByKind(next, options.kindFilter, {
      includeArchived: options.includeArchived,
    })
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
