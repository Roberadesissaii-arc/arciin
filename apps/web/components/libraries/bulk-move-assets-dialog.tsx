"use client"

import { useState } from "react"

import { MoveAssetsSheetContent } from "@/components/libraries/move-assets-sheet-content"
import { notifyAssetsMoved, notifyError } from "@/lib/notifications/toast-actions"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useFolders, useLibraries } from "@/hooks/use-libraries"
import { useMoveAsset } from "@/hooks/use-assets"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

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

  const librariesQuery = useLibraries()
  const foldersQuery = useFolders(libraryId)
  const moveAssetMutation = useMoveAsset()

  const libraries = librariesQuery.data ?? []

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next)
    if (next) {
      setLibraryId(defaultLibraryId ?? first?.libraryId ?? "")
      setFolderId("root")
    }
  }

  const count = assets.length

  async function handleMove() {
    const atRoot = folderId === "root"
    try {
      for (const asset of assets) {
        const payload: { folderId?: string; libraryId?: string } = {}
        if (!atRoot) {
          payload.folderId = folderId
        } else if (libraryId !== asset.libraryId) {
          payload.libraryId = libraryId
        }
        if (Object.keys(payload).length > 0) {
          await moveAssetMutation.mutateAsync({
            assetId: asset.id,
            ...payload,
          })
        }
      }
      const destination =
        folderId === "root"
          ? libraries.find((lib) => lib.id === libraryId)?.name
          : (foldersQuery.data ?? []).find((folder) => folder.id === folderId)?.pathCache
      notifyAssetsMoved(count, destination)
      handleOpenChange(false)
      onComplete?.()
    } catch (error) {
      notifyError(
        "Could not move assets",
        error instanceof Error ? error.message : "Something went wrong. Try again.",
      )
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
          movePending={moveAssetMutation.isPending}
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
