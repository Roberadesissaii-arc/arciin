"use client"

import { useMemo, useState } from "react"

import type { BadgeFilterValue } from "@/lib/utils/asset-badge-filter"

export type LibraryViewMode = "grid" | "table"

export function useLibraryBrowserFilters() {
  const [search, setSearch] = useState("")
  const [view, setView] = useState<LibraryViewMode>("grid")
  const [badgeFilter, setBadgeFilter] = useState<BadgeFilterValue>("all")

  const filters = useMemo(
    () => ({
      search,
      view,
      badgeFilter,
    }),
    [search, view, badgeFilter],
  )

  return {
    ...filters,
    setSearch,
    setView,
    setBadgeFilter,
  }
}
