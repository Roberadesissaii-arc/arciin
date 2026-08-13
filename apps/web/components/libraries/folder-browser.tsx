"use client"

import { useEffect, useMemo } from "react"
import { Search } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { BrowserSectionHeading } from "@/components/libraries/browser-section-heading"
import { AssetGrid } from "@/components/libraries/asset-grid"
import { AssetTable } from "@/components/libraries/asset-table"
import { SelectableAssetsContainer } from "@/components/libraries/selectable-assets-container"
import { CreateFolderDialog } from "@/components/libraries/create-folder-dialog"
import { FolderAccessGate } from "@/components/libraries/folder-access-gate"
import { FolderGrid } from "@/components/libraries/folder-grid"
import { FoldersEmptyPlaceholder } from "@/components/libraries/folders-empty-placeholder"
import { LibraryBrowserToolbar } from "@/components/libraries/library-browser-toolbar"
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
import { collectBadgeFilterOptions } from "@/lib/utils/asset-badge-filter"
import {
  collectSourceFilterOptions,
  GRID_PAGE_SIZE,
  LIST_PAGE_SIZE,
  pipelineLibraryAssets,
} from "@/lib/utils/library-asset-pipeline"
import { cn } from "@/lib/utils"

export function FolderBrowser({
  librarySlug,
  folderSlug,
}: {
  librarySlug: string
  folderSlug: string
}) {
  const {
    search,
    setSearch,
    view,
    setView,
    badgeFilter,
    setBadgeFilter,
    sourceFilter,
    setSourceFilter,
    sort,
    setSort,
    page,
    setPage,
  } = useLibraryBrowserFilters()
  const setUploadContext = useUploadStore((state) => state.setUploadContext)

  const librariesQuery = useLibraries()
  const library = useMemo(
    () => librariesQuery.data?.find((l) => l.slug === librarySlug),
    [librariesQuery.data, librarySlug]
  )

  const foldersQuery = useFolders(library?.id ?? "")
  const allFolders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])

  const folder = useMemo(
    () => allFolders.find((f) => f.slug === folderSlug),
    [allFolders, folderSlug]
  )

  // Set upload context: dropped files go to this library + this folder
  useEffect(() => {
    if (library?.id) {
      setUploadContext({
        libraryId: library.id,
        folderId: folder?.id,
        libraryKind: library.kind,
      })
    }
    return () => setUploadContext(null)
  }, [library?.id, library?.kind, folder?.id, setUploadContext])

  const subFolders = useMemo(
    () => allFolders.filter((f) => f.parentFolderId === folder?.id),
    [allFolders, folder?.id]
  )

  const assetsQuery = useAssetsPage({
    libraryId: library?.id,
    folderId: folder?.id,
    search: search || undefined,
  })

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

  const rawAssets = useMemo(
    () => assetsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [assetsQuery.data],
  )
  const badgeOptions = useMemo(() => collectBadgeFilterOptions(rawAssets), [rawAssets])
  const sourceOptions = useMemo(() => collectSourceFilterOptions(rawAssets), [rawAssets])
  const assets = useMemo(
    () =>
      pipelineLibraryAssets(rawAssets, {
        badgeFilter,
        kindFilter: "all",
        sourceFilter,
        sort,
        applyKind: false,
      }),
    [rawAssets, badgeFilter, sourceFilter, sort],
  )
  const pageSize = view === "grid" ? GRID_PAGE_SIZE : LIST_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(assets.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageAssets = useMemo(
    () => assets.slice((safePage - 1) * pageSize, safePage * pageSize),
    [assets, safePage, pageSize],
  )
  const filtersActive =
    Boolean(search.trim()) || badgeFilter !== "all" || sourceFilter !== "all"

  const librariesLoading = librariesQuery.isLoading
  const foldersBootLoading = foldersQuery.isLoading && foldersQuery.data === undefined
  const assetsBootLoading = assetsQuery.isLoading && assetsQuery.data === undefined
  const assetsRefetching = assetsQuery.isFetching && !assetsBootLoading

  const folderName = folder?.name ?? folderSlug

  const browserBody = (
    <div className="space-y-5 pb-10">
      <PageHeader
        title={folderName}
        description={`Contents of the ${folderName} folder.`}
      />

      <section className="space-y-2 pb-2">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200/90 pb-2">
          <BrowserSectionHeading className="w-auto border-0 pb-0">Folders</BrowserSectionHeading>
          {library?.id && folder?.id ? (
            <CreateFolderDialog libraryId={library.id} parentFolderId={folder.id} />
          ) : null}
        </div>
        {subFolders.length > 0 ? (
          <FolderGrid folders={subFolders} librarySlug={librarySlug} />
        ) : (
          <FoldersEmptyPlaceholder />
        )}
      </section>

      <section className="space-y-3 pt-4">
        <BrowserSectionHeading>Assets</BrowserSectionHeading>

        <LibraryBrowserToolbar
          search={search}
          onSearchChange={setSearch}
          view={view}
          onViewChange={setView}
          resultCount={assets.length}
          badgeFilter={badgeFilter}
          onBadgeFilterChange={setBadgeFilter}
          badgeOptions={badgeOptions}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          sourceOptions={sourceOptions}
          sort={sort}
          onSortChange={setSort}
          placeholder="Search files in this folder"
        />

        {assetsBootLoading ? (
          view === "table" ? (
            <AssetTableSkeleton />
          ) : (
            <AssetGridSkeleton />
          )
        ) : assets.length > 0 ? (
          <div
            className={cn(
              "space-y-3",
              assetsRefetching && "opacity-70 transition-opacity",
            )}
          >
            <SelectableAssetsContainer assets={pageAssets} defaultLibraryId={library?.id}>
              {view === "grid" ? (
                <AssetGrid assets={pageAssets} />
              ) : (
                <AssetTable
                  assets={pageAssets}
                  title="Files"
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
          <Empty className="border border-border bg-card py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search className="size-4" />
              </EmptyMedia>
              <EmptyTitle>
                {filtersActive ? "No files match your filters." : "This folder is empty."}
              </EmptyTitle>
              <EmptyDescription>
                {filtersActive
                  ? "Try a different search term, pick another badge, or clear filters."
                  : "Upload files or create sub-folders to organize this folder."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  )

  if (librariesLoading || foldersBootLoading) {
    return <LibraryBrowserSkeleton showFolders view={view} />
  }

  if (folder) {
    return (
      <FolderAccessGate folder={folder} librarySlug={librarySlug}>
        {browserBody}
      </FolderAccessGate>
    )
  }

  return browserBody
}
