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
  SheetTrigger,
} from "@/components/ui/sheet"
import { useFolders, useLibraries } from "@/hooks/use-libraries"
import { useMoveAsset } from "@/hooks/use-assets"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import type { AssetSummary } from "@/lib/types/models"

const selectTrigger =
  "h-10 w-full min-w-0 border-white/[0.08] bg-white/[0.04] text-left text-sm text-[rgba(255,255,255,0.95)] backdrop-blur-sm hover:bg-white/[0.06] focus-visible:ring-white/20"

const selectContent =
  "z-[120] max-h-60 border border-white/[0.08] bg-[rgba(12,12,16,0.96)] text-[rgba(255,255,255,0.95)] shadow-lg backdrop-blur-xl"

export function MoveAssetDialog({ asset }: { asset: AssetSummary }) {
  const [libraryId, setLibraryId] = useState(asset.libraryId)
  const [folderId, setFolderId] = useState<string>("root")
  const [open, setOpen] = useState(false)

  const librariesQuery = useLibraries()
  const foldersQuery = useFolders(libraryId)
  const moveAssetMutation = useMoveAsset()

  const libraries = librariesQuery.data ?? []

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setLibraryId(asset.libraryId)
      setFolderId("root")
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]"
        >
          <ArrowRightLeft className="size-4" />
          Move
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(libraryGlassSheetPanel)}
      >
        <SheetHeader className="relative shrink-0 space-y-1 border-b border-white/[0.06] p-2 pr-11">
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
          <SheetTitle className="font-heading text-lg font-semibold tracking-tight text-[rgba(255,255,255,0.95)]">
            Move asset
          </SheetTitle>
          <SheetDescription className="text-[13px] leading-snug text-[rgba(255,255,255,0.45)]">
            Choose a library, then a folder.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-2">
          <div className="space-y-2">
            <Label
              htmlFor="move-library"
              className="text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)]"
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
              <SelectTrigger id="move-library" size="default" className={selectTrigger}>
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
              htmlFor="move-folder"
              className="text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)]"
            >
              Folder
            </Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger id="move-folder" size="default" className={selectTrigger}>
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
              <p className="text-xs text-[rgba(255,255,255,0.35)]">Loading folders…</p>
            ) : null}
          </div>
        </div>

        <SheetFooter className="shrink-0 border-t border-white/[0.06] p-2">
          <Button
            className="h-10 w-full bg-primary text-white hover:bg-primary/90"
            disabled={moveAssetMutation.isPending}
            onClick={async () => {
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
                toast.success("Asset moved.")
                handleOpenChange(false)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not move asset.")
              }
            }}
          >
            {moveAssetMutation.isPending ? "Moving…" : "Move asset"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
