"use client"

import { useMemo, useState } from "react"

import type { BadgeFilterValue } from "@/lib/utils/asset-badge-filter"
import type { MediaType } from "@/lib/types/models"

export type LibraryViewMode = "grid" | "table"

/** Kind chips on All Files (not on scoped library pages). */
export type LibraryKindFilter =
  | "all"
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "AUDIO"
  | "ARCHIVE"
  | "OTHER"

export type LibrarySortMode = "modified" | "name" | "size" | "type"

export type SourceFilterValue = "all" | (string & {})

export const KIND_CHIP_OPTIONS: { value: LibraryKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "IMAGE", label: "Images" },
  { value: "VIDEO", label: "Videos" },
  { value: "DOCUMENT", label: "Documents" },
  { value: "AUDIO", label: "Audio" },
  { value: "ARCHIVE", label: "Archives" },
  { value: "OTHER", label: "Other" },
]

export const SORT_OPTIONS: { value: LibrarySortMode; label: string }[] = [
  { value: "modified", label: "Sort: Modified" },
  { value: "name", label: "Sort: Name" },
  { value: "size", label: "Sort: Size" },
  { value: "type", label: "Sort: Type" },
]

export function mediaTypeMatchesKind(
  mediaType: MediaType,
  kind: LibraryKindFilter,
): boolean {
  if (kind === "all") return true
  if (kind === "OTHER") {
    return mediaType === "OTHER" || mediaType === "APPLICATION" || mediaType === "CODE"
  }
  if (kind === "AUDIO") return mediaType === "AUDIO"
  return mediaType === kind
}

export function useLibraryBrowserFilters() {
  const [search, setSearch] = useState("")
  const [view, setView] = useState<LibraryViewMode>("grid")
  const [badgeFilter, setBadgeFilter] = useState<BadgeFilterValue>("all")
  const [kindFilter, setKindFilter] = useState<LibraryKindFilter>("all")
  const [sourceFilter, setSourceFilter] = useState<SourceFilterValue>("all")
  const [sort, setSort] = useState<LibrarySortMode>("modified")
  const [page, setPage] = useState(1)

  const filters = useMemo(
    () => ({
      search,
      view,
      badgeFilter,
      kindFilter,
      sourceFilter,
      sort,
      page,
    }),
    [search, view, badgeFilter, kindFilter, sourceFilter, sort, page],
  )

  return {
    ...filters,
    setSearch: (value: string) => {
      setSearch(value)
      setPage(1)
    },
    setView: (value: LibraryViewMode) => {
      setView(value)
      setPage(1)
    },
    setBadgeFilter: (value: BadgeFilterValue) => {
      setBadgeFilter(value)
      setPage(1)
    },
    setKindFilter: (value: LibraryKindFilter) => {
      setKindFilter(value)
      setPage(1)
    },
    setSourceFilter: (value: SourceFilterValue) => {
      setSourceFilter(value)
      setPage(1)
    },
    setSort: (value: LibrarySortMode) => {
      setSort(value)
      setPage(1)
    },
    setPage,
  }
}
