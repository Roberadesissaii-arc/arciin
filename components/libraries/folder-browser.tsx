"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronRight, Grid3X3, List, Search } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { BrowserSectionHeading } from "@/components/libraries/browser-section-heading"
import { AssetGrid } from "@/components/libraries/asset-grid"
import { AssetTable } from "@/components/libraries/asset-table"
import { SelectableAssetsContainer } from "@/components/libraries/selectable-assets-container"
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
import { useUploadStore } from "@/lib/stores/upload-store"
import { cn } from "@/lib/utils"

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
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link href={`/${librarySlug}`} className="transition-colors hover:text-foreground/80">
          {libraryTitle}
        </Link>
        <ChevronRight className="size-3.5 shrink-0" />
        <span className="text-foreground/90">{folderName}</span>
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
                  : "border-border bg-card text-foreground hover:bg-muted/50"
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
                  : "border-border bg-card text-foreground hover:bg-muted/50"
              }
              onClick={() => setView("table")}
            >
              <List className="size-4" />
              Table
            </Button>
          </>
        }
      />

      <div className="w-full min-w-0 rounded-2xl border border-border bg-muted/30 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Search className="size-4 shrink-0 text-zinc-600" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files and folders"
            className="h-10 min-w-0 flex-1 border-0 bg-transparent py-0 pl-2 pr-2 text-sm text-foreground placeholder:text-zinc-500 focus-visible:ring-0 sm:pl-3 sm:pr-3"
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
          {subFolders.length > 0 ? (
            <section className="space-y-3">
              <BrowserSectionHeading>Folders</BrowserSectionHeading>
              <FolderGrid folders={subFolders} librarySlug={librarySlug} />
            </section>
          ) : null}

          <section
            className={cn(
              "space-y-3",
              subFolders.length > 0 && "border-t border-zinc-200/90 pt-8"
            )}
          >
            <BrowserSectionHeading>Assets</BrowserSectionHeading>
            {assets.length > 0 ? (
              <SelectableAssetsContainer assets={assets} defaultLibraryId={library?.id}>
                {view === "grid" ? (
                  <AssetGrid assets={assets} />
                ) : (
                  <AssetTable assets={assets} />
                )}
              </SelectableAssetsContainer>
            ) : (
              <Empty className="border border-border bg-card py-16">
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
          </section>
        </>
      )}
    </div>
  )
}
