"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Search } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { BrowserSectionHeading } from "@/components/libraries/browser-section-heading"
import { AssetGrid } from "@/components/libraries/asset-grid"
import { VideoEditProvider } from "@/components/libraries/video-edit-context"
import { AssetTable } from "@/components/libraries/asset-table"
import { CreateFolderDialog } from "@/components/libraries/create-folder-dialog"
import { FolderGrid } from "@/components/libraries/folder-grid"
import { FoldersEmptyPlaceholder } from "@/components/libraries/folders-empty-placeholder"
import { LibraryBrowserToolbar } from "@/components/libraries/library-browser-toolbar"
import type { LibraryAssetScope } from "@/components/libraries/library-scope-switch"
import { SelectableAssetsContainer } from "@/components/libraries/selectable-assets-container"
import { GridPaginationBar } from "@/components/ui/app-pagination"
import {
  AssetGridSkeleton,
  AssetTableSkeleton,
  LibraryBrowserSkeleton,
} from "@/components/libraries/library-browser-skeleton"
import { useAssetsPage } from "@/hooks/use-assets"
import { useLibraryBrowserFilters } from "@/hooks/use-library-browser-filters"
import { useFolders, useLibraries } from "@/hooks/use-libraries"
import { useUploadStore } from "@/lib/stores/upload-store"
import {
  collectSourceFilterOptions,
  GRID_PAGE_SIZE,
  LIST_PAGE_SIZE,
  pipelineLibraryAssets,
} from "@/lib/utils/library-asset-pipeline"
import { cn } from "@/lib/utils"

export function LibraryBrowser({
  title,
  description,
  librarySlug,
  intro,
}: {
  title: string
  description: string
  librarySlug?: string
  /** Optional hero intro (e.g. All Files). Replaces PageHeader when set. */
  intro?: ReactNode
}) {
  const {
    search,
    setSearch,
    view,
    setView,
    kindFilter,
    setKindFilter,
    sourceFilter,
    setSourceFilter,
    page,
    setPage,
  } = useLibraryBrowserFilters()
  /**
   * Root only by default.
   *
   * Once AI Chat (or anyone) files a photo into a folder, that file belongs
   * in the folder — not still listed under Assets at the library root. "All
   * files" remains a deliberate switch for people who want the flat dump.
   */
  const [scope, setScope] = useState<LibraryAssetScope>("root")
  const setUploadContext = useUploadStore((state) => state.setUploadContext)
  const librariesQuery = useLibraries()
  const library = useMemo(
    () => librariesQuery.data?.find((item) => item.slug === librarySlug),
    [librariesQuery.data, librarySlug]
  )
  const isAllFiles = !librarySlug

  useEffect(() => {
    if (library?.id) {
      setUploadContext({ libraryId: library.id, libraryKind: library.kind })
    }
    return () => setUploadContext(null)
  }, [library?.id, library?.kind, setUploadContext])

  const foldersQuery = useFolders(library?.id || "")
  /**
   * No mediaType filter on the API: kind chips filter client-side so a file
   * filed under a mismatched library stays reachable from its library page.
   */
  const assetsQuery = useAssetsPage({
    libraryId: library?.id,
    search: search || undefined,
    // Library pages default to root; All Files has no folders so keep the full set.
    ...(librarySlug && scope === "root" ? { rootOnly: true } : {}),
  })

  // Pull remaining pages so grid/list page numbers can walk the full set.
  useEffect(() => {
    if (assetsQuery.hasNextPage && !assetsQuery.isFetchingNextPage) {
      void assetsQuery.fetchNextPage()
    }
  }, [
    assetsQuery.hasNextPage,
    assetsQuery.isFetchingNextPage,
    assetsQuery.fetchNextPage,
    assetsQuery.data?.pages.length,
  ])

  /** Only top-level folders on the library page — nested ones live inside their parent. */
  const folders = useMemo(
    () => (foldersQuery.data ?? []).filter((f) => f.parentFolderId == null),
    [foldersQuery.data],
  )
  const rawAssets = useMemo(
    () => assetsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [assetsQuery.data],
  )
  const sourceOptions = useMemo(() => collectSourceFilterOptions(rawAssets), [rawAssets])
  const assets = useMemo(
    () =>
      pipelineLibraryAssets(rawAssets, {
        kindFilter,
        sourceFilter,
        applyKind: isAllFiles,
      }),
    [rawAssets, kindFilter, sourceFilter, isAllFiles],
  )
  const pageSize = view === "grid" ? GRID_PAGE_SIZE : LIST_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(assets.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageAssets = useMemo(
    () => assets.slice((safePage - 1) * pageSize, safePage * pageSize),
    [assets, safePage, pageSize],
  )
  const filtersActive =
    Boolean(search.trim()) ||
    sourceFilter !== "all" ||
    (isAllFiles && kindFilter !== "all")

  const librariesLoading = librariesQuery.isLoading
  const foldersBootLoading = Boolean(librarySlug && foldersQuery.isLoading && foldersQuery.data === undefined)
  const assetsBootLoading = assetsQuery.isLoading && assetsQuery.data === undefined
  const assetsRefetching = assetsQuery.isFetching && !assetsBootLoading

  if (librariesLoading || foldersBootLoading) {
    return (
      <LibraryBrowserSkeleton
        showFolders={Boolean(librarySlug)}
        view={view}
        intro={intro ?? undefined}
      />
    )
  }

  return (
    // One drawer for the whole browser — see video-edit-context for why it is
    // not mounted per card.
    <VideoEditProvider>
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
          resultCount={assets.length}
          showKindChips={isAllFiles}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          showScopeChips={Boolean(librarySlug)}
          scope={scope}
          onScopeChange={setScope}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          sourceOptions={sourceOptions}
          placeholder="Search files and metadata"
        />

        {/* Same hierarchy hairline as Folders / Assets section titles */}
        <div className="border-b border-zinc-200/90" aria-hidden />

        {assetsBootLoading ? (
          view === "table" ? (
            <AssetTableSkeleton />
          ) : (
            <AssetGridSkeleton />
          )
        ) : assets.length ? (
          <div className={cn(assetsRefetching && "opacity-70 transition-opacity")}>
            {/* Full filtered set for selection/viewer; page slice for display only. */}
            <SelectableAssetsContainer assets={assets} defaultLibraryId={library?.id}>
              {view === "grid" ? (
                <AssetGrid assets={pageAssets} />
              ) : (
                <AssetTable
                  assets={pageAssets}
                  title={librarySlug ? "Assets" : "Files"}
                  totalCount={assets.length}
                  page={safePage}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              )}
            </SelectableAssetsContainer>
            {view === "grid" ? (
              <GridPaginationBar
                page={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            ) : null}
          </div>
        ) : (
          <div
            className={cn(
              "flex min-h-[calc(100dvh-22rem)] flex-col items-center justify-center rounded-2xl",
              "border border-dashed border-zinc-300/90 px-4 py-10 text-center md:px-6",
            )}
          >
            <Search className="size-12 text-zinc-300" strokeWidth={1.5} aria-hidden />
            <p className="mt-4 text-sm font-semibold text-zinc-900">
              {filtersActive ? "No files match your filters" : "No files yet"}
            </p>
            <p className="mt-1 max-w-md text-sm leading-relaxed text-zinc-500">
              {filtersActive
                ? "Try a different search term, pick another source, or clear filters."
                : "Upload or drop files here. Arciin will place them in the right library."}
            </p>
          </div>
        )}
      </section>
    </div>
    </VideoEditProvider>
  )
}
