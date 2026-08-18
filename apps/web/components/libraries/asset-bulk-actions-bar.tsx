"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, Download, Loader2, Share2, Trash2, X } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { useAssetSelectionRequired } from "@/components/libraries/asset-selection"
import { notifyDeleted } from "@/lib/notifications/toast-actions"
import { BulkMoveAssetsDialog } from "@/components/libraries/bulk-move-assets-dialog"
import { ShareDialog } from "@/components/shares/share-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { deleteAsset } from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import {
  dashboardTableActionDanger,
  dashboardTableActionOutline,
} from "@/lib/dashboard-table-styles"
import { cn } from "@/lib/utils"

function downloadAsset(assetId: string) {
  const anchor = document.createElement("a")
  anchor.href = `/api/assets/${assetId}/download`
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function AssetBulkActionsBar({ defaultLibraryId }: { defaultLibraryId?: string }) {
  const queryClient = useQueryClient()
  const { selectedIds, selectedAssets, clear } = useAssetSelectionRequired()
  const [moveOpen, setMoveOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const count = selectedIds.size
  /**
   * Two or more.
   *
   * A single selected file opens the unified asset panel instead, which offers
   * the same actions with the file in front of you rather than a toolbar
   * floating over a grid. Showing both at once would put two different Delete
   * buttons on screen for the same file.
   *
   * Edit is intentionally omitted here — rename / AI live on the single-file
   * panel and the card context menu, not on a multi-select toolbar.
   */
  if (count < 2) return null

  const handleDownload = async () => {
    setBusy(true)
    try {
      let i = 0
      for (const asset of selectedAssets) {
        downloadAsset(asset.id)
        i += 1
        if (i < selectedAssets.length) {
          await new Promise((resolve) => setTimeout(resolve, 280))
        }
      }
      toast.success(
        count === 1 ? "Download started." : `Started download for ${count} files.`,
        { description: "Check your browser's downloads for progress." },
      )
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setBusy(true)
    setDeleting(true)
    try {
      for (const asset of selectedAssets) {
        await deleteAsset(asset.id)
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
      notifyDeleted({ kind: "files", count })
      clear()
      setDeleteOpen(false)
    } catch (error) {
      toast.error("Could not delete assets", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    } finally {
      setDeleting(false)
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
        style={{ bottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
        role="region"
        aria-label="Bulk asset actions"
      >
        <div
          className={cn(
            "pointer-events-auto flex min-h-14 flex-wrap items-center gap-2 rounded-2xl border-2 border-primary/40 bg-card px-3 py-2.5 shadow-[0_12px_40px_-12px_rgba(255,79,18,0.35),0_8px_24px_-8px_rgba(0,0,0,0.18)] ring-1 ring-primary/15 backdrop-blur-md",
            "supports-[backdrop-filter]:bg-card/95",
          )}
        >
          <span className="px-1.5 text-sm font-semibold tabular-nums text-foreground">
            {count} selected
          </span>
          <div className="hidden h-8 w-px bg-primary/20 sm:block" aria-hidden />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={dashboardTableActionOutline}
            disabled={busy}
            onClick={() => void handleDownload()}
          >
            <Download className="size-4" />
            Download
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={dashboardTableActionOutline}
            disabled={busy}
            onClick={() => setMoveOpen(true)}
          >
            <ArrowRightLeft className="size-4" />
            Move
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={dashboardTableActionOutline}
            disabled={busy}
            onClick={() => setShareOpen(true)}
          >
            <Share2 className="size-4" />
            Share
          </Button>
          <Button
            type="button"
            size="sm"
            variant="default"
            className={dashboardTableActionDanger}
            disabled={busy || deleting}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-9 text-muted-foreground hover:text-foreground"
            aria-label="Clear selection"
            onClick={clear}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        target={
          selectedAssets.length === 1
            ? { resourceType: "ASSET", asset: selectedAssets[0]! }
            : { resourceType: "ASSETS", assets: selectedAssets }
        }
      />

      <BulkMoveAssetsDialog
        assets={selectedAssets}
        open={moveOpen}
        defaultLibraryId={defaultLibraryId}
        onOpenChange={setMoveOpen}
        onComplete={clear}
      />

      <AlertDialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count} selected {count === 1 ? "file" : "files"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete everything you selected? This removes{" "}
              {count === 1 ? "this file" : `all ${count} files`} from your libraries. You can&apos;t
              undo this from the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                `Delete ${count === 1 ? "file" : "all"}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
