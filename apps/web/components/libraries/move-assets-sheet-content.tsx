"use client"

import { ArrowRight, ArrowRightLeft, FolderOpen, Library, X } from "lucide-react"

import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { AssetSummary, FolderSummary, LibrarySummary } from "@/lib/types/models"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"

const selectTrigger =
  "h-11 w-full min-w-0 rounded-xl border-border bg-muted/40 text-left text-sm text-foreground hover:bg-muted/70 focus-visible:ring-primary/25"

const selectContent =
  "z-[120] max-h-60 rounded-xl border border-border bg-popover text-foreground shadow-lg"

function MoveAssetThumb({ asset, compact = false }: { asset: AssetSummary; compact?: boolean }) {
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const showImage =
    asset.mediaType === "IMAGE" ||
    asset.mediaType === "VIDEO" ||
    asset.mediaType === "DOCUMENT"

  if (showImage) {
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border border-border/80 bg-muted/30",
          compact ? "aspect-square" : "aspect-[16/10]",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbSrc} alt="" className="size-full object-cover" loading="lazy" />
        {!compact ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-6">
            <p className="truncate text-[11px] font-medium text-white">{asset.originalFilename}</p>
            <p className="text-[10px] text-zinc-300">{formatBytes(asset.sizeBytes)}</p>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-border/80 bg-gradient-to-br from-muted/50 to-muted/20",
        compact ? "aspect-square p-2" : "aspect-[16/10] p-4",
      )}
    >
      <MediaTypeIcon
        mediaType={asset.mediaType}
        filename={asset.originalFilename}
        mimeType={asset.mimeType}
        extension={asset.extension}
        className={cn("text-primary", compact ? "size-5" : "size-8")}
      />
      {!compact ? (
        <>
          <p className="max-w-full truncate text-[11px] font-medium text-foreground">
            {asset.originalFilename}
          </p>
          <p className="text-[10px] text-muted-foreground">{formatBytes(asset.sizeBytes)}</p>
        </>
      ) : null}
    </div>
  )
}

function MoveAssetsPreview({ assets }: { assets: AssetSummary[] }) {
  if (assets.length === 1) {
    return (
      <div className="rounded-xl border border-border/80 bg-muted/15 p-2.5">
        <MoveAssetThumb asset={assets[0]!} />
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-muted/15 p-2.5">
      <div className="scrollbar-hide max-h-44 overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-2 gap-2">
          {assets.map((asset) => (
            <MoveAssetThumb key={asset.id} asset={asset} compact />
          ))}
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        {assets.length} files selected
      </p>
    </div>
  )
}

function DestinationSummary({
  libraryName,
  folderLabel,
}: {
  libraryName: string
  folderLabel: string
}) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Destination</p>
      <div className="mt-2 flex items-start gap-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
          <ArrowRight className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <Library className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{libraryName}</span>
          </p>
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <FolderOpen className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{folderLabel}</span>
          </p>
        </div>
      </div>
    </div>
  )
}

export function MoveAssetsSheetContent({
  assets,
  count,
  libraryId,
  folderId,
  libraries,
  folders,
  foldersLoading,
  librariesLoading,
  movePending,
  moveProgress,
  onLibraryChange,
  onFolderChange,
  onMove,
}: {
  assets: AssetSummary[]
  count: number
  libraryId: string
  folderId: string
  libraries: LibrarySummary[]
  folders: FolderSummary[]
  foldersLoading?: boolean
  librariesLoading?: boolean
  movePending?: boolean
  moveProgress?: { done: number; total: number }
  onLibraryChange: (id: string) => void
  onFolderChange: (id: string) => void
  onMove: () => void | Promise<void>
}) {
  const libraryName = libraries.find((lib) => lib.id === libraryId)?.name ?? "Library"
  const folderLabel =
    folderId === "root"
      ? "Library root"
      : (folders.find((folder) => folder.id === folderId)?.pathCache ?? "Folder")

  return (
    <>
      <SheetHeader className="relative shrink-0 space-y-3 border-b border-border px-4 py-4 pr-12">
        <SheetClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-3.5 right-3 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </SheetClose>
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <ArrowRightLeft className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <SheetTitle className="font-heading text-lg font-semibold tracking-tight text-foreground">
              Move {count} {count === 1 ? "asset" : "assets"}
            </SheetTitle>
            <SheetDescription className="text-[13px] leading-snug text-muted-foreground">
              Pick a library and folder. {count > 1 ? "All selected items" : "This file"} will land
              in the same place.
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <MoveAssetsPreview assets={assets} />

        <div className="space-y-4 rounded-xl border border-border bg-muted/10 p-3.5">
          <div className="space-y-2">
            <Label
              htmlFor="move-library"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Library
            </Label>
            <Select
              value={libraryId}
              onValueChange={onLibraryChange}
              disabled={librariesLoading}
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
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Folder
            </Label>
            <Select value={folderId} onValueChange={onFolderChange} disabled={!libraryId}>
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
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id} className="cursor-pointer">
                    <span className="block max-w-[min(18rem,calc(100vw-5rem))] truncate">
                      {folder.pathCache}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {foldersLoading ? (
              <p className="text-xs text-muted-foreground">Loading folders…</p>
            ) : folders.length === 0 && folderId === "root" ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                No subfolders yet — files will go to the library root.
              </p>
            ) : null}
          </div>
        </div>

        <DestinationSummary libraryName={libraryName} folderLabel={folderLabel} />
      </div>

      <SheetFooter className="shrink-0 gap-2 border-t border-border px-4 py-4 sm:flex-col">
        {moveProgress ? (
          <div className="w-full space-y-2 pb-1" aria-live="polite">
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="font-medium text-foreground">
                Moving {moveProgress.done} of {moveProgress.total}…
              </span>
              <span className="tabular-nums text-muted-foreground">
                {Math.round((moveProgress.done / Math.max(1, moveProgress.total)) * 100)}%
              </span>
            </div>
            <Progress
              value={(moveProgress.done / Math.max(1, moveProgress.total)) * 100}
              className="h-1.5"
            />
          </div>
        ) : null}
        <Button
          className="h-11 w-full bg-primary text-white hover:bg-primary/90"
          disabled={movePending || !libraryId || count === 0}
          onClick={() => void onMove()}
        >
          {movePending ? "Moving…" : `Move ${count} ${count === 1 ? "asset" : "assets"}`}
        </Button>
        {!movePending ? (
          <SheetClose asChild>
            <Button type="button" variant="outline" className="h-11 w-full border-border">
              Cancel
            </Button>
          </SheetClose>
        ) : null}
      </SheetFooter>
    </>
  )
}
