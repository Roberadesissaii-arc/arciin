"use client"

import { useState } from "react"

import { useQueryClient } from "@tanstack/react-query"

import { MoveAssetsSheetContent } from "@/components/libraries/move-assets-sheet-content"
import { notifyAssetsMoved, notifyError } from "@/lib/notifications/toast-actions"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useFolders, useLibraries } from "@/hooks/use-libraries"
import { moveAsset } from "@/lib/api/assets"
import {
  beginBulkLibraryMutation,
  endBulkLibraryMutation,
} from "@/lib/realtime/refresh-library-queries"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/** Enough to keep the API busy without saturating the browser's 6 connections. */
const MOVE_CONCURRENCY = 4

export function BulkMoveAssetsDialog({
  assets,
  open,
  onOpenChange,
  onComplete,
  defaultLibraryId,
}: {
  assets: AssetSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete?: () => void
  defaultLibraryId?: string
}) {
  const first = assets[0]
  const [libraryId, setLibraryId] = useState(defaultLibraryId ?? first?.libraryId ?? "")
  const [folderId, setFolderId] = useState<string>("root")

  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const queryClient = useQueryClient()
  const librariesQuery = useLibraries()
  const foldersQuery = useFolders(libraryId)

  const libraries = librariesQuery.data ?? []
  const moving = progress.total > 0

  const handleOpenChange = (next: boolean) => {
    // Closing mid-move would strand the batch with no feedback.
    if (!next && moving) return
    onOpenChange(next)
    if (next) {
      setLibraryId(defaultLibraryId ?? first?.libraryId ?? "")
      setFolderId("root")
      setProgress({ done: 0, total: 0 })
    }
  }

  const count = assets.length

  async function handleMove() {
    const atRoot = folderId === "root"

    const jobs = assets.flatMap((asset) => {
      const payload: { folderId?: string; libraryId?: string } = {}
      if (!atRoot) {
        payload.folderId = folderId
      } else if (libraryId !== asset.libraryId) {
        payload.libraryId = libraryId
      }
      return Object.keys(payload).length > 0 ? [{ assetId: asset.id, ...payload }] : []
    })

    if (jobs.length === 0) {
      handleOpenChange(false)
      return
    }

    setProgress({ done: 0, total: jobs.length })
    // Park the realtime per-asset refreshes; this batch owns the one refresh.
    beginBulkLibraryMutation()
    try {
      // Run a few at a time: 60 sequential round trips is slow, and firing all
      // 60 at once just queues them behind the browser's connection limit.
      let cursor = 0
      const runNext = async (): Promise<void> => {
        const index = cursor++
        if (index >= jobs.length) return
        await moveAsset(jobs[index]!.assetId, jobs[index]!)
        setProgress((p) => ({ ...p, done: p.done + 1 }))
        await runNext()
      }
      await Promise.all(
        Array.from({ length: Math.min(MOVE_CONCURRENCY, jobs.length) }, () => runNext()),
      )

      const destination =
        folderId === "root"
          ? libraries.find((lib) => lib.id === libraryId)?.name
          : (foldersQuery.data ?? []).find((folder) => folder.id === folderId)?.pathCache
      notifyAssetsMoved(jobs.length, destination)
      handleOpenChange(false)
      onComplete?.()
    } catch (error) {
      notifyError(
        "Could not move assets",
        error instanceof Error ? error.message : "Something went wrong. Try again.",
      )
    } finally {
      // One refresh for the whole batch, owned by endBulkLibraryMutation.
      // Going through the per-asset mutation meant 60 optimistic removals
      // interleaved with 60 full list refetches, so the grid visibly flickered
      // items out and back in for the duration.
      setProgress({ done: 0, total: 0 })
      endBulkLibraryMutation(queryClient)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(libraryGlassSheetPanel, "dashboard-main border-primary/25 text-foreground")}
      >
        <MoveAssetsSheetContent
          assets={assets}
          count={count}
          libraryId={libraryId}
          folderId={folderId}
          libraries={libraries}
          folders={foldersQuery.data ?? []}
          foldersLoading={foldersQuery.isFetching}
          librariesLoading={librariesQuery.isPending}
          movePending={moving}
          moveProgress={moving ? progress : undefined}
          onLibraryChange={(id) => {
            setLibraryId(id)
            setFolderId("root")
          }}
          onFolderChange={setFolderId}
          onMove={handleMove}
        />
      </SheetContent>
    </Sheet>
  )
}
