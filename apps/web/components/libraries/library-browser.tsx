"use client"

import { useEffect, useMemo, type ReactNode } from "react"
import { Search } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { BrowserSectionHeading } from "@/components/libraries/browser-section-heading"
import { AssetGrid } from "@/components/libraries/asset-grid"
import { AssetTable } from "@/components/libraries/asset-table"
import { CreateFolderDialog } from "@/components/libraries/create-folder-dialog"
import { FolderGrid } from "@/components/libraries/folder-grid"
import { FoldersEmptyPlaceholder } from "@/components/libraries/folders-empty-placeholder"
import { LibraryBrowserToolbar } from "@/components/libraries/library-browser-toolbar"
import { SelectableAssetsContainer } from "@/components/libraries/selectable-assets-container"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useAssets } from "@/hooks/use-assets"
import { useLibraryBrowserFilters } from "@/hooks/use-library-browser-filters"
import { useFolders, useLibraries } from "@/hooks/use-libraries"
import type { MediaType } from "@/lib/types/models"
import { useUploadStore } from "@/lib/stores/upload-store"
import {
  collectBadgeFilterOptions,
  filterAssetsByBadge,
  hasActiveLibraryFilters,
} from "@/lib/utils/asset-badge-filter"
import { cn } from "@/lib/utils"

export function LibraryBrowser({
  title,
  description,
  librarySlug,
  mediaType,
  intro,
}: {
  title: string
  description: string
  librarySlug?: string
  mediaType?: MediaType
  /** Optional hero intro (e.g. All Files). Replaces PageHeader when set. */
  intro?: ReactNode
}) {
  const { search, setSearch, view, setView, badgeFilter, setBadgeFilter } =
    useLibraryBrowserFilters()
  const setUploadContext = useUploadStore((state) => state.setUploadContext)
  const librariesQuery = useLibraries()
  const library = useMemo(
    () => librariesQuery.data?.find((item) => item.slug === librarySlug),
    [librariesQuery.data, librarySlug]
  )

  useEffect(() => {
    if (library?.id) {
      setUploadContext({ libraryId: library.id, libraryKind: library.kind })
    }
    return () => setUploadContext(null)
  }, [library?.id, library?.kind, setUploadContext])

  const foldersQuery = useFolders(library?.id || "")
  const assetsQuery = useAssets({
    libraryId: library?.id,
    mediaType,
    search: search || undefined,
  })
  const folders = foldersQuery.data ?? []
  const rawAssets = librarySlug
    ? (assetsQuery.data ?? []).filter((a) => !a.folderId)
    : (assetsQuery.data ?? [])
  const badgeOptions = useMemo(() => collectBadgeFilterOptions(rawAssets), [rawAssets])
  const assets = useMemo(
    () => filterAssetsByBadge(rawAssets, badgeFilter),
    [rawAssets, badgeFilter],
  )
  const filtersActive = hasActiveLibraryFilters(search, badgeFilter)

  const librariesLoading = librariesQuery.isLoading
  const foldersBootLoading = Boolean(librarySlug && foldersQuery.isLoading && foldersQuery.data === undefined)
  const assetsBootLoading = assetsQuery.isLoading && assetsQuery.data === undefined
  const assetsRefetching = assetsQuery.isFetching && !assetsBootLoading

  if (librariesLoading || foldersBootLoading) {
    return (
      <div className="space-y-5 pb-10">
        {intro ?? <PageHeader title={title} description={description} />}
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      {intro ?? <PageHeader title={title} description={description} />}

      {librarySlug ? (
        <section className="space-y-2 pb-2">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200/90 pb-2">
            <BrowserSectionHeading className="w-auto border-0 pb-0">Folders</BrowserSectionHeading>
            {library?.id ? <CreateFolderDialog libraryId={library.id} /> : null}
          </div>
          {folders.length > 0 ? (
            <FolderGrid folders={folders} librarySlug={librarySlug} />
          ) : (
            <FoldersEmptyPlaceholder />
          )}
        </section>
      ) : null}

      <section className={cn("space-y-3 pb-4", librarySlug && "pt-4")}>
        <BrowserSectionHeading>Assets</BrowserSectionHeading>

        <LibraryBrowserToolbar
          search={search}
          onSearchChange={setSearch}
          view={view}
          onViewChange={setView}
          badgeFilter={badgeFilter}
          onBadgeFilterChange={setBadgeFilter}
          badgeOptions={badgeOptions}
          placeholder="Search files and metadata"
        />

        {assetsBootLoading ? (
          <Skeleton className="h-80 rounded-2xl" />
        ) : assets.length ? (
          <div className={cn(assetsRefetching && "opacity-70 transition-opacity")}>
            <SelectableAssetsContainer assets={assets} defaultLibraryId={library?.id}>
              {view === "grid" ? (
                <AssetGrid assets={assets} />
              ) : (
                <AssetTable assets={assets} title={librarySlug ? "Assets" : "Files"} />
              )}
            </SelectableAssetsContainer>
          </div>
        ) : (
          <Empty className="relative overflow-hidden border border-border bg-gradient-to-b from-muted/40 via-card to-card py-20">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 30% 15%, var(--arciin-accent, #ff4f12) 0%, transparent 45%)",
              }}
            />
            <EmptyHeader className="relative">
              <EmptyMedia
                variant="icon"
                className="mb-3 size-14 rounded-2xl bg-[var(--arciin-accent-icon-bg)] text-[var(--arciin-accent)] ring-1 ring-inset ring-[var(--arciin-accent-icon-ring)]"
              >
                <Search className="size-6" />
              </EmptyMedia>
              <EmptyTitle className="text-base">
                {filtersActive
                  ? "No files match your filters."
                  : "Drop anything. Arciin will sort it out."}
              </EmptyTitle>
              <EmptyDescription>
                {filtersActive
                  ? "Try a different search term, pick another badge, or clear filters to see everything in this library."
                  : "Upload files from anywhere in the app. Arciin detects the content type, organizes it into the right library, and keeps the activity visible in real time."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  )
}
