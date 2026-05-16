"use client"

import { useState } from "react"
import { ArrowRightLeft, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useFolders, useLibraries } from "@/hooks/use-libraries"
import { useMoveAsset } from "@/hooks/use-assets"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import type { AssetSummary } from "@/lib/types/models"

const selectTrigger =
  "h-10 w-full min-w-0 border-border bg-muted/40 text-left text-sm text-foreground hover:bg-muted/70 focus-visible:ring-primary/20"

const selectContent =
  "z-[120] max-h-60 border border-border bg-popover text-foreground shadow-lg"

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

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}
      >
        <SheetHeader className="relative shrink-0 space-y-1 border-b border-border p-2 pr-11">
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </SheetClose>
          <SheetTitle className="font-heading text-lg font-semibold tracking-tight text-foreground">
            Move {count} {count === 1 ? "asset" : "assets"}
          </SheetTitle>
          <SheetDescription className="text-[13px] leading-snug text-muted-foreground">
            All selected items will go to the same library and folder.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-2">
          <div className="space-y-2">
            <Label
              htmlFor="bulk-move-library"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Library
            </Label>
            <Select
              value={libraryId}
              onValueChange={(id) => {
                setLibraryId(id)
                setFolderId("root")
              }}
              disabled={librariesQuery.isPending}
            >
              <SelectTrigger id="bulk-move-library" size="default" className={selectTrigger}>
                <SelectValue placeholder="Choose a library" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                side="bottom"
                align="start"
                sideOffset={6}
                className={selectContent}
              >
                {libraries.map((lib) => (
                  <SelectItem key={lib.id} value={lib.id} className="cursor-pointer">
                    {lib.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="bulk-move-folder"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Folder
            </Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger id="bulk-move-folder" size="default" className={selectTrigger}>
                <SelectValue placeholder="Choose a folder" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                side="bottom"
                align="start"
                sideOffset={6}
                className={selectContent}
              >
                <SelectItem value="root" className="cursor-pointer">
                  Library root
                </SelectItem>
                {(foldersQuery.data ?? []).map((folder) => (
                  <SelectItem key={folder.id} value={folder.id} className="cursor-pointer">
                    <span className="block max-w-[min(18rem,calc(100vw-5rem))] truncate">
                      {folder.pathCache}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {foldersQuery.isFetching ? (
              <p className="text-xs text-muted-foreground">Loading folders…</p>
            ) : null}
          </div>
        </div>

        <SheetFooter className="shrink-0 border-t border-border p-2">
          <Button
            className="h-10 w-full bg-primary text-white hover:bg-primary/90"
            disabled={moveAssetMutation.isPending || !libraryId || count === 0}
            onClick={async () => {
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
                toast.success(
                  count === 1 ? "Asset moved." : `${count} assets moved.`,
                )
                handleOpenChange(false)
                onComplete?.()
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not move assets.")
              }
            }}
          >
            {moveAssetMutation.isPending ? "Moving…" : `Move ${count} ${count === 1 ? "asset" : "assets"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
