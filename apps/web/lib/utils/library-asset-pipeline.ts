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
export const SOURCE_COMPUTER = "computer"

export function computerSourceValue(deviceId: string): string {
  return `computer:${deviceId}`
}

export function parseComputerSourceDeviceId(source: string): string | null {
  if (!source.startsWith("computer:")) return null
  const id = source.slice("computer:".length).trim()
  return id || null
}

export function assetSourceLabel(asset: AssetSummary): string {
  const badge = resolveAssetBadge(asset)
  if (badge?.label) return badge.label
  return inferDestinationLabel(asset.mimeType, asset.originalFilename)
}

export function collectSourceFilterOptions(
  assets: AssetSummary[],
  computers?: Array<{ deviceId: string; name: string }> | null,
): FilterDropdownOption[] {
  const byId = new Map<string, string>()
  const listed = Array.isArray(computers)
  if (listed) {
    for (const computer of computers) {
      if (!computer.deviceId) continue
      byId.set(computer.deviceId, computer.name)
    }
  } else {
    for (const asset of assets) {
      const ctx = asset.sourceContext
      if (!ctx?.deviceId) continue
      if (!byId.has(ctx.deviceId)) byId.set(ctx.deviceId, ctx.deviceName)
    }
  }

  const hasBackupAssets = assets.some((asset) => Boolean(asset.sourceContext))
  const options: FilterDropdownOption[] = [
    { value: SOURCE_ALL, label: "All sources" },
    { value: SOURCE_MANUAL, label: "Manual uploads" },
  ]
  if (byId.size === 0 && !hasBackupAssets) return options

  options.push({ value: SOURCE_COMPUTER, label: "Computer backups" })
  const named = [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
  for (const [deviceId, name] of named) {
    options.push({
      value: computerSourceValue(deviceId),
      label: name,
      indent: true,
    })
  }
  return options
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
  if (source === SOURCE_ALL) return assets
  if (source === SOURCE_MANUAL) return assets.filter((asset) => !asset.sourceContext)
  if (source === SOURCE_COMPUTER) return assets.filter((asset) => Boolean(asset.sourceContext))
  const deviceId = parseComputerSourceDeviceId(source)
  if (deviceId) {
    return assets.filter((asset) => asset.sourceContext?.deviceId === deviceId)
  }
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

export const GRID_PAGE_SIZE = 30
export const LIST_PAGE_SIZE = 10
