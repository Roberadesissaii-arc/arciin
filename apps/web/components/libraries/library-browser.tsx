"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Search } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { BrowserSectionHeading } from "@/components/libraries/browser-section-heading"
import { AssetGrid } from "@/components/libraries/asset-grid"
import { AssetTable } from "@/components/libraries/asset-table"
import { CreateFolderDialog } from "@/components/libraries/create-folder-dialog"
import { FolderGrid } from "@/components/libraries/folder-grid"
import { FoldersEmptyPlaceholder } from "@/components/libraries/folders-empty-placeholder"
import { LibraryBrowserToolbar } from "@/components/libraries/library-browser-toolbar"
import {
  LibraryScopeSwitch,
  type LibraryAssetScope,
} from "@/components/libraries/library-scope-switch"
import { SelectableAssetsContainer } from "@/components/libraries/selectable-assets-container"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
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
  const [scope, setScope] = useState<LibraryAssetScope>("all")
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
   * "All files" is the default so the list matches the sidebar count: that
   * count is every visible asset in the library, folders included. Root-only
   * stays available as an explicit filter.
   *
   * No mediaType filter on the API: kind chips filter client-side so a file
   * filed under a mismatched library stays reachable from its library page.
   */
  const assetsQuery = useAssetsPage({
    libraryId: library?.id,
    search: search || undefined,
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

  const folders = foldersQuery.data ?? []
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

        {librarySlug ? (
          <LibraryScopeSwitch
            scope={scope}
            onScopeChange={setScope}
            loadedCount={assets.length}
            matchingTotal={assetsQuery.data?.pages[0]?.total}
          />
        ) : null}

        <LibraryBrowserToolbar
          search={search}
          onSearchChange={setSearch}
          view={view}
          onViewChange={setView}
          resultCount={assets.length}
          showKindChips={isAllFiles}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          sourceOptions={sourceOptions}
          placeholder="Search files and metadata"
        />

        {assetsBootLoading ? (
          view === "table" ? (
            <AssetTableSkeleton />
          ) : (
            <AssetGridSkeleton />
          )
        ) : assets.length ? (
          <div
            className={cn(
              "space-y-3",
              assetsRefetching && "opacity-70 transition-opacity",
            )}
          >
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
