"use client"

import { useState } from "react"
import { ArrowRightLeft } from "lucide-react"

import { MoveAssetsSheetContent } from "@/components/libraries/move-assets-sheet-content"
import { notifyAssetsMoved, notifyError } from "@/lib/notifications/toast-actions"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useFolders, useLibraries } from "@/hooks/use-libraries"
import { useMoveAsset } from "@/hooks/use-assets"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * Destination picking and the move itself, with no shell around it.
 *
 * Split out so the unified asset panel moves a file through exactly the same
 * mutation and the same destination rules as the standalone sheet. The
 * presentation was already shared (`MoveAssetsSheetContent`); this shares the
 * behaviour too, rather than growing a second copy of it.
 */
export function AssetMoveContent({
  asset,
  onDone,
}: {
  asset: AssetSummary
  /** Called after a successful move, so a host can step back or close. */
  onDone?: () => void
}) {
  const [libraryId, setLibraryId] = useState(asset.libraryId)
  const [folderId, setFolderId] = useState<string>("root")

  const librariesQuery = useLibraries()
  const foldersQuery = useFolders(libraryId)
  const moveAssetMutation = useMoveAsset()

  const libraries = librariesQuery.data ?? []

  async function handleMove() {
    try {
      const atRoot = folderId === "root"
      const payload: { folderId?: string; libraryId?: string } = {}
      if (!atRoot) {
        payload.folderId = folderId
      } else if (libraryId !== asset.libraryId) {
        payload.libraryId = libraryId
      }

      await moveAssetMutation.mutateAsync({
        assetId: asset.id,
        ...payload,
      })
      const destination =
        folderId === "root"
          ? libraries.find((lib) => lib.id === libraryId)?.name
          : (foldersQuery.data ?? []).find((folder) => folder.id === folderId)?.pathCache
      notifyAssetsMoved(1, destination)
      onDone?.()
    } catch (error) {
      notifyError(
        "Could not move asset",
        error instanceof Error ? error.message : "Something went wrong. Try again.",
      )
    }
  }

  return (
    <MoveAssetsSheetContent
          assets={[asset]}
          count={1}
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
  )
}

/**
 * The standalone Move sheet, kept for callers that open Move on its own.
 */
export function MoveAssetDialog({
  asset,
  iconOnly = false,
  triggerClassName,
}: {
  asset: AssetSummary
  iconOnly?: boolean
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size={iconOnly ? "icon" : "sm"}
          className={cn(
            "border-border bg-card text-foreground hover:bg-muted/50",
            iconOnly && "h-9 w-full shrink-0",
            triggerClassName,
          )}
          aria-label="Move"
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowRightLeft className="size-4" />
          {!iconOnly ? "Move" : null}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(libraryGlassSheetPanel, "dashboard-main border-primary/25 text-foreground")}
      >
        {open ? <AssetMoveContent asset={asset} onDone={() => setOpen(false)} /> : null}
      </SheetContent>
    </Sheet>
  )
}
