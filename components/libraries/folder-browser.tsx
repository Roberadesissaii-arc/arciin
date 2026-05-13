"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ChevronRight, Grid3X3, List, Search } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { AssetGrid } from "@/components/libraries/asset-grid"
import { AssetTable } from "@/components/libraries/asset-table"
import { CreateFolderDialog } from "@/components/libraries/create-folder-dialog"
import { FolderGrid } from "@/components/libraries/folder-grid"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useAssets } from "@/hooks/use-assets"
import { useFolders, useLibraries } from "@/hooks/use-libraries"
import type { MediaType } from "@/lib/types/models"

export function FolderBrowser({
  librarySlug,
  libraryTitle,
  folderSlug,
  mediaType,
}: {
  librarySlug: string
  libraryTitle: string
  folderSlug: string
  mediaType?: MediaType
}) {
  const [search, setSearch] = useState("")
  const [view, setView] = useState<"grid" | "table">("grid")

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

  const subFolders = useMemo(
    () => allFolders.filter((f) => f.parentFolderId === folder?.id),
    [allFolders, folder?.id]
  )

  const assetsQuery = useAssets({
    libraryId: library?.id,
    folderId: folder?.id,
    mediaType,
    search: search || undefined,
  })
  const assets = assetsQuery.data ?? []

  const loading =
    librariesQuery.isLoading ||
    foldersQuery.isLoading ||
    assetsQuery.isLoading

  const folderName = folder?.name ?? folderSlug

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[13px] text-white/40">
        <Link href={`/${librarySlug}`} className="transition-colors hover:text-white/70">
          {libraryTitle}
        </Link>
        <ChevronRight className="size-3.5 shrink-0" />
        <span className="text-white/80">{folderName}</span>
      </div>

      <PageHeader
        title={folderName}
        description={`Contents of the ${folderName} folder.`}
        actions={
          <>
            {library?.id && folder?.id ? (
              <CreateFolderDialog libraryId={library.id} parentFolderId={folder.id} />
            ) : null}
            <Button
              variant={view === "grid" ? "default" : "outline"}
              className={
                view === "grid"
                  ? "bg-primary text-white hover:bg-primary/90"
                  : "border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]"
              }
              onClick={() => setView("grid")}
            >
              <Grid3X3 className="size-4" />
              Grid
            </Button>
            <Button
              variant={view === "table" ? "default" : "outline"}
              className={
                view === "table"
                  ? "bg-primary text-white hover:bg-primary/90"
                  : "border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]"
              }
              onClick={() => setView("table")}
            >
              <List className="size-4" />
              Table
            </Button>
          </>
        }
      />

      <div className="w-full min-w-0 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Search className="size-4 shrink-0 text-zinc-500" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files and folders"
            className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm text-white placeholder:text-zinc-500 focus-visible:ring-0"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-3xl" />
          <Skeleton className="h-80 rounded-3xl" />
        </div>
      ) : (
        <>
          {subFolders.length > 0 && (
            <section className="space-y-3">
              <div className="text-sm font-medium text-white">Folders</div>
              <FolderGrid folders={subFolders} librarySlug={librarySlug} />
            </section>
          )}

          {assets.length > 0 ? (
            view === "grid" ? (
              <AssetGrid assets={assets} />
            ) : (
              <AssetTable assets={assets} />
            )
          ) : (
            <Empty className="border border-white/8 bg-white/[0.02] py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search className="size-4" />
                </EmptyMedia>
                <EmptyTitle>This folder is empty.</EmptyTitle>
                <EmptyDescription>
                  Upload files or create sub-folders to organize this folder.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </>
      )}
    </div>
  )
}
