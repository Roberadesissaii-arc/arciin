"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, Folder, Monitor, Search } from "lucide-react"

import { AssetGrid } from "@/components/libraries/asset-grid"
import { AssetTable } from "@/components/libraries/asset-table"
import { BrowserSectionHeading } from "@/components/libraries/browser-section-heading"
import {
  AssetGridSkeleton,
  AssetTableSkeleton,
} from "@/components/libraries/library-browser-skeleton"
import { SelectableAssetsContainer } from "@/components/libraries/selectable-assets-container"
import { GridPaginationBar } from "@/components/ui/app-pagination"
import { browseComputer, type ComputerCard, type ComputerRoot } from "@/lib/api/computers"
import {
  filterAssetsByKind,
  computerBrowseCrumbs,
  filesSourceHref,
  GRID_PAGE_SIZE,
  LIST_PAGE_SIZE,
} from "@/lib/utils/library-asset-pipeline"
import { queryKeys } from "@/lib/api/query-keys"
import type { LibraryKindFilter, LibraryViewMode } from "@/hooks/use-library-browser-filters"
import type { FolderSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

function platformLabel(platform: ComputerCard["platform"]) {
  switch (platform) {
    case "WINDOWS":
      return "Windows"
    case "MACOS":
      return "macOS"
    case "LINUX":
      return "Linux"
    default:
      return "Other"
  }
}

function healthLabel(health: ComputerCard["health"] | ComputerRoot["status"]) {
  switch (health) {
    case "UP_TO_DATE":
    case "PROTECTED":
      return "Up to date"
    case "SYNCING":
      return "Backing up"
    case "PAUSED":
      return "Paused"
    case "OFFLINE":
      return "Offline"
    case "ERROR":
      return "Error"
    case "DISABLED":
      return "Disabled"
    default:
      return health
  }
}

function ComputerFolderTile({
  folder,
  href,
  root,
}: {
  folder: FolderSummary
  href: string
  root?: ComputerRoot
}) {
  return (
    <Link
      href={href}
      data-testid="computer-folder-card"
      data-folder-name={folder.name}
      className="group block select-none"
    >
      <div className="ml-3 h-[10px] w-[40%] rounded-t-[6px] border border-b-0 border-zinc-200 bg-gradient-to-b from-zinc-100 to-zinc-50 transition-colors group-hover:border-zinc-300 group-hover:from-zinc-200/80 group-hover:to-zinc-100" />
      <div className="relative overflow-hidden rounded-b-2xl rounded-tr-2xl border border-zinc-200 bg-white px-4 py-5 shadow-[0_1px_2px_rgba(24,24,27,0.05)] transition-all group-hover:-translate-y-px group-hover:border-zinc-300 group-hover:shadow-[0_10px_28px_-14px_rgba(24,24,27,0.22)]">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-zinc-50 to-transparent"
          aria-hidden
        />
        {folder.assetCount > 0 ? (
          <div className="absolute right-3 top-3 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600">
            {folder.assetCount} {folder.assetCount === 1 ? "file" : "files"}
          </div>
        ) : null}
        <div className="relative">
          <span className="mb-3 flex size-9 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 transition-colors group-hover:border-primary/25 group-hover:bg-[color-mix(in_srgb,var(--arciin-accent,#ff4f12)_8%,white)]">
            <Folder className="size-[18px] fill-primary/15 text-primary" />
          </span>
          <div className="truncate text-[13px] font-semibold text-zinc-900">{folder.name}</div>
          <div className="mt-0.5 text-[11px] font-medium text-zinc-500">
            {root ? healthLabel(root.status) : "Folder"}
          </div>
        </div>
      </div>
    </Link>
  )
}

export function ComputerSourceBrowser({
  deviceId,
  folderId,
  sourceValue,
  kindFilter,
  search,
  view,
  page,
  onPageChange,
}: {
  deviceId: string
  folderId?: string | null
  sourceValue: string
  kindFilter: LibraryKindFilter
  search: string
  view: LibraryViewMode
  page: number
  onPageChange: (page: number) => void
}) {
  const query = useQuery({
    queryKey: queryKeys.computerBrowse(deviceId, folderId),
    queryFn: ({ signal }) => browseComputer(deviceId, folderId ?? undefined, signal),
  })

  const atRoot = !folderId
  const folders = query.data?.folders ?? []
  const computer = query.data?.computer
  const rootByFolderId = useMemo(
    () => new Map((computer?.roots ?? []).map((root) => [root.folderId, root])),
    [computer],
  )
  const crumbs = useMemo(() => {
    if (!query.data) return []
    return computerBrowseCrumbs({
      computerName: query.data.computer.name,
      folderPathCache: query.data.folder.pathCache,
      currentFolderName: query.data.folder.name,
      atRoot,
    })
  }, [query.data, atRoot])

  const files = useMemo(() => {
    const raw = query.data?.assets ?? []
    const byKind = filterAssetsByKind(raw, kindFilter)
    const q = search.trim().toLowerCase()
    if (!q) return byKind
    return byKind.filter((asset) => asset.originalFilename.toLowerCase().includes(q))
  }, [query.data?.assets, kindFilter, search])

  const pageSize = view === "grid" ? GRID_PAGE_SIZE : LIST_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(files.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageFiles = files.slice((safePage - 1) * pageSize, safePage * pageSize)

  if (query.isLoading) {
    return view === "table" ? <AssetTableSkeleton /> : <AssetGridSkeleton />
  }

  if (query.isError || !query.data || !computer) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">Could not open this computer.</p>
    )
  }

  const folderHref = (id: string) => filesSourceHref(sourceValue, id)
  const rootHref = filesSourceHref(sourceValue)

  const parentFolderId = query.data.folder.parentFolderId
  const nestedCrumbs = crumbs.slice(1)

  const showFilesSection = !(atRoot && folders.length > 0 && files.length === 0)
  const protectedCount = computer.roots.filter((root) => root.status !== "DISABLED").length
  const statusLabel = `${platformLabel(computer.platform)} · ${protectedCount} protected ${
    protectedCount === 1 ? "folder" : "folders"
  } · ${healthLabel(computer.health)}`

  const folderTitle =
    atRoot || nestedCrumbs.length === 0 ? (
      "Folders"
    ) : (
      <nav
        className="flex min-w-0 flex-wrap items-center gap-1 normal-case tracking-normal"
        aria-label="Folder path"
        data-testid="computer-source-breadcrumbs"
      >
        <Link
          href={rootHref}
          className="uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-700"
        >
          Folders
        </Link>
        {nestedCrumbs.map((crumb, index) => {
          const isLast = index === nestedCrumbs.length - 1
          const isImmediateParent = !isLast && index === nestedCrumbs.length - 2 && parentFolderId
          return (
            <span key={`${index}-${crumb}`} className="flex items-center gap-1">
              <ChevronRight className="size-3 text-zinc-400" />
              {isLast ? (
                <span className="font-semibold text-zinc-600">{crumb}</span>
              ) : isImmediateParent && parentFolderId ? (
                <Link href={folderHref(parentFolderId)} className="text-zinc-500 hover:text-zinc-700">
                  {crumb}
                </Link>
              ) : (
                <span className="text-zinc-500">{crumb}</span>
              )}
            </span>
          )
        })}
      </nav>
    )

  return (
    <div className="space-y-3">
      <section className="space-y-2">
        <BrowserSectionHeading
          end={
            <div
              className="flex max-w-[min(100%,20rem)] items-center justify-end gap-1.5 text-[11px] font-medium text-zinc-500"
              data-testid="computer-source-header"
              aria-label={`${computer.name}, ${statusLabel}`}
            >
              <span className="sr-only">{computer.name}</span>
              <Monitor className="size-3 shrink-0 text-zinc-400" aria-hidden />
              <p className="truncate">{statusLabel}</p>
            </div>
          }
        >
          {folderTitle}
        </BrowserSectionHeading>
        {folders.length > 0 ? (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-3 lg:grid-cols-4">
            {folders.map((folder) => (
              <ComputerFolderTile
                key={folder.id}
                folder={folder}
                href={folderHref(folder.id)}
                root={rootByFolderId.get(folder.id)}
              />
            ))}
          </div>
        ) : null}
      </section>

      {showFilesSection ? (
        <section className="space-y-3">
          <BrowserSectionHeading>Files</BrowserSectionHeading>
          {files.length === 0 ? (
            <div
              className={cn(
                "flex min-h-40 flex-col items-center justify-center rounded-2xl",
                "border border-dashed border-zinc-300/90 px-4 py-8 text-center",
              )}
            >
              <Search className="size-10 text-zinc-300" strokeWidth={1.5} aria-hidden />
              <p className="mt-3 text-sm font-semibold text-zinc-900">
                {atRoot && folders.length > 0 ? "Choose a folder to browse its files." : "No files in this folder"}
              </p>
              <p className="mt-1 max-w-md text-sm text-zinc-500">
                {kindFilter !== "all"
                  ? "Folders stay available so you can keep browsing this computer."
                  : "This folder has no files yet."}
              </p>
            </div>
          ) : (
            <SelectableAssetsContainer assets={files} defaultLibraryId={query.data.folder.libraryId}>
              {view === "grid" ? (
                <AssetGrid assets={pageFiles} readOnly />
              ) : (
                <AssetTable
                  assets={pageFiles}
                  title="Files"
                  readOnly
                  totalCount={files.length}
                  page={safePage}
                  totalPages={totalPages}
                  onPageChange={onPageChange}
                />
              )}
            </SelectableAssetsContainer>
          )}
          {view === "grid" && files.length > 0 ? (
            <GridPaginationBar page={safePage} totalPages={totalPages} onPageChange={onPageChange} />
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
