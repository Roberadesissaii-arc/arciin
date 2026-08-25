"use client"

import { useMemo, useState } from "react"

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

/**
 * Kind chips on All Files.
 *
 * Archives = user-archived files (any media type), not only zip containers.
 * Other = unclassified / installers / code / zip containers that are still active.
 */
export function mediaTypeMatchesKind(
  mediaType: MediaType,
  kind: LibraryKindFilter,
  archivedAt?: string | null,
): boolean {
  const isArchived = Boolean(archivedAt)
  if (kind === "ARCHIVE") return isArchived
  if (isArchived) return false
  if (kind === "all") return true
  if (kind === "OTHER") {
    return (
      mediaType === "OTHER" ||
      mediaType === "APPLICATION" ||
      mediaType === "CODE" ||
      mediaType === "ARCHIVE"
    )
  }
  if (kind === "AUDIO") return mediaType === "AUDIO"
  return mediaType === kind
}

export function useLibraryBrowserFilters() {
  const [search, setSearch] = useState("")
  const [view, setView] = useState<LibraryViewMode>("grid")
  const [kindFilter, setKindFilter] = useState<LibraryKindFilter>("all")
  const [sourceFilter, setSourceFilter] = useState<SourceFilterValue>("all")
  const [page, setPage] = useState(1)

  const filters = useMemo(
    () => ({
      search,
      view,
      kindFilter,
      sourceFilter,
      page,
    }),
    [search, view, kindFilter, sourceFilter, page],
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
    setKindFilter: (value: LibraryKindFilter) => {
      setKindFilter(value)
      setPage(1)
    },
    setSourceFilter: (value: SourceFilterValue) => {
      setSourceFilter(value)
      setPage(1)
    },
    setPage,
  }
}
