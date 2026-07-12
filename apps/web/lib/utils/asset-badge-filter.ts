import { resolveAssetBadge } from "@/lib/utils/asset-badge"
import type { AssetSummary } from "@/lib/types/models"

export type BadgeFilterValue = "all" | "none" | (string & {})

export type BadgeFilterOption = {
  value: BadgeFilterValue
  label: string
  color?: string
}

export function badgeFilterKey(asset: Pick<
  AssetSummary,
  "importSourceUrl" | "badgeLabel" | "badgeColor" | "showBadge"
>): string | null {
  const badge = resolveAssetBadge(asset)
  if (!badge) return null
  if (badge.isCustomLabel) return `label:${badge.label}`
  return badge.key
}

export function collectBadgeFilterOptions(assets: AssetSummary[]): BadgeFilterOption[] {
  const seen = new Map<string, BadgeFilterOption>()

  for (const asset of assets) {
    const badge = resolveAssetBadge(asset)
    if (!badge) continue
    const value = badgeFilterKey(asset)
    if (!value || seen.has(value)) continue
    seen.set(value, {
      value,
      label: badge.label,
      color: badge.color,
    })
  }

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}

export function filterAssetsByBadge(
  assets: AssetSummary[],
  badgeFilter: BadgeFilterValue,
): AssetSummary[] {
  if (badgeFilter === "all") return assets

  return assets.filter((asset) => {
    const key = badgeFilterKey(asset)
    if (badgeFilter === "none") return key === null
    return key === badgeFilter
  })
}

export function hasActiveLibraryFilters(search: string, badgeFilter: BadgeFilterValue): boolean {
  return Boolean(search.trim()) || badgeFilter !== "all"
}
