"use client"

import { useMemo, useState } from "react"
import { Grid3X3, List, Search } from "lucide-react"

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

export function LibraryBrowser({
  title,
  description,
  librarySlug,
  mediaType,
}: {
  title: string
  description: string
  librarySlug?: string
  mediaType?: MediaType
}) {
  const [search, setSearch] = useState("")
  const [view, setView] = useState<"grid" | "table">("grid")
  const librariesQuery = useLibraries()
  const library = useMemo(
    () => librariesQuery.data?.find((item) => item.slug === librarySlug),
    [librariesQuery.data, librarySlug]
  )

  const foldersQuery = useFolders(library?.id || "")
  const assetsQuery = useAssets({
    libraryId: library?.id,
    mediaType,
    search: search || undefined,
  })
  const folders = foldersQuery.data ?? []
  // Per-library root views only show assets not inside a folder.
  // The All Files page (no librarySlug) shows everything.
  const assets = librarySlug
    ? (assetsQuery.data ?? []).filter((a) => !a.folderId)
    : (assetsQuery.data ?? [])

  const loading = librariesQuery.isLoading || (librarySlug ? foldersQuery.isLoading : false) || assetsQuery.isLoading

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {library?.id ? <CreateFolderDialog libraryId={library.id} /> : null}
            <Button
              variant={view === "grid" ? "default" : "outline"}
              className={view === "grid" ? "bg-primary text-white hover:bg-primary/90" : "border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]"}
              onClick={() => setView("grid")}
            >
              <Grid3X3 className="size-4" />
              Grid
            </Button>
            <Button
              variant={view === "table" ? "default" : "outline"}
              className={view === "table" ? "bg-primary text-white hover:bg-primary/90" : "border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]"}
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
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search files, folders, and metadata"
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
          {librarySlug && folders.length ? (
            <section className="space-y-3">
              <div className="text-sm font-medium text-white">Folders</div>
              <FolderGrid folders={folders} librarySlug={librarySlug ?? ""} />
            </section>
          ) : null}

          {assets.length ? (
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
                <EmptyTitle>Drop anything. Arciin will sort it out.</EmptyTitle>
                <EmptyDescription>
                  Upload files from anywhere in the app. Arciin detects the content type,
                  organizes it into the right library, and keeps the activity visible in real time.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </>
      )}
    </div>
  )
}
