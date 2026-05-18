"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, Download, Loader2, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { useAssetSelectionRequired } from "@/components/libraries/asset-selection"
import { BulkMoveAssetsDialog } from "@/components/libraries/bulk-move-assets-dialog"
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const count = selectedIds.size
  if (count === 0) return null

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
      await queryClient.invalidateQueries({ queryKey: queryKeys.assets() })
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
      toast.success(count === 1 ? "Asset deleted." : `${count} assets deleted.`)
      clear()
      setDeleteOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete assets.")
    } finally {
      setDeleting(false)
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
        role="region"
        aria-label="Bulk asset actions"
      >
        <div
          className={cn(
            "pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-lg ring-1 ring-black/[0.06] backdrop-blur-md",
            "supports-[backdrop-filter]:bg-card/90",
          )}
        >
          <span className="px-2 text-sm font-medium tabular-nums text-foreground">
            {count} selected
          </span>
          <div className="hidden h-6 w-px bg-border sm:block" aria-hidden />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-border bg-card"
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
            className="border-border bg-card"
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
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
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
            className="text-muted-foreground"
            aria-label="Clear selection"
            onClick={clear}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

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
