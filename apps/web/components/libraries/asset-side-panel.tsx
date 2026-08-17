"use client"

import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, Info, Loader2, Pencil, Share2, Sparkles, X } from "lucide-react"

import { AssetEditContent } from "@/components/libraries/rename-asset-dialog"
import { AssetMoveContent } from "@/components/libraries/move-asset-dialog"
import { AssetShareContent } from "@/components/shares/share-dialog"
import { VideoTranscriptSection } from "@/components/libraries/video-edit-drawer"
import { useAssetPanelIntent } from "@/components/libraries/asset-panel-intent"
import { AssetOverviewContent } from "@/components/libraries/asset-overview-content"
import { useAssetSelection } from "@/components/libraries/asset-selection"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { deleteAsset } from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { notifyDeleted } from "@/lib/notifications/toast-actions"
import { toast } from "@/lib/notifications/arciin-toast"
import { formatBytes } from "@/lib/utils/format-bytes"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * One workspace for one selected file.
 *
 * Selecting a single file used to raise a bottom toolbar whose every button
 * opened a different floating dialog — edit here, move there, share somewhere
 * else — so a simple "rename it and put it in the right folder" meant three
 * separate modals with three separate animations.
 *
 * This is the same set of capabilities behind one panel that stays mounted
 * while you move between them. Nothing here reimplements any of it: Edit, Move
 * and Share render the very same form components the standalone sheets do, and
 * the transcript is the one the video drawer already used.
 *
 * The shell is `libraryGlassSheetPanel` — the token Edit File, Move, Share and
 * Create Folder already share — so this belongs to that family by construction
 * rather than by imitation, insets and corner radius included.
 */

type Section = "overview" | "edit" | "ai" | "move" | "share"

const SECTION_LABELS: Record<Section, string> = {
  overview: "Overview",
  edit: "Edit",
  ai: "AI",
  move: "Move",
  share: "Share",
}

const SECTION_ICONS: Record<Section, typeof Info> = {
  overview: Info,
  edit: Pencil,
  ai: Sparkles,
  move: ArrowRightLeft,
  share: Share2,
}

/**
 * Which sections this file actually has.
 *
 * A transcript is meaningless for a PNG, and offering it would be a promise the
 * panel cannot keep, so AI appears only where there is something behind it.
 */
function sectionsFor(asset: AssetSummary): Section[] {
  const base: Section[] = ["overview", "edit"]
  if (asset.mediaType === "VIDEO") base.push("ai")
  return [...base, "move", "share"]
}

/** The same anchor-click download the bulk bar uses. */
function downloadAsset(assetId: string) {
  const anchor = document.createElement("a")
  anchor.href = `/api/assets/${assetId}/download`
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function AssetSidePanel() {
  const selection = useAssetSelection()
  const queryClient = useQueryClient()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const selected = selection?.selectedAssets ?? []
  /**
   * One file, and only one.
   *
   * Two or more selected is the bulk bar's job — showing a single-file
   * workspace while five files are selected would misrepresent what an action
   * is about to affect.
   */
  const asset = selected.length === 1 ? selected[0]! : null
  const open = Boolean(asset)

  const close = () => {
    selection?.clear()
  }

  /**
   * Escape closes the panel, from anywhere.
   *
   * The sheet is non-modal so the grid stays clickable, which also means Radix
   * only sees Escape when focus happens to be inside the panel. A reader who
   * selected a card and never moved focus would otherwise be stuck with it.
   */
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") selection?.clear()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, selection])

  const handleDelete = async () => {
    if (!asset) return
    setDeleting(true)
    try {
      await deleteAsset(asset.id)
      await queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
      notifyDeleted({ kind: "files", count: 1 })
      setDeleteOpen(false)
      selection?.clear()
    } catch (error) {
      toast.error("Could not delete file", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    } finally {
      setDeleting(false)
    }
  }

  if (!asset) return null

  return (
    <>
      {/*
        Non-modal on purpose.
        
        This panel is a view of the current selection, so the grid behind it has
        to stay live: clicking the next card should swap the panel's contents,
        which a modal overlay makes impossible by swallowing the click. Closing
        is therefore driven by selection — the close button, Escape, or picking
        a second file — rather than by clicking "outside", which here is a
        legitimate place to click.
      */}
      <Sheet
        open={open}
        modal={false}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          showOverlay={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          data-testid="asset-side-panel"
          // The shared library panel token: inset top/right/bottom, all four
          // corners rounded. Same shell as Edit File, Move and Share.
          className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground sm:max-w-[420px]")}
        >
          {/* ── stable header: the file, not the section ─────────────────── */}
          <SheetHeader className="relative shrink-0 space-y-1 border-b border-border p-2 pr-11">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              aria-label="Close"
              onClick={close}
            >
              <X className="size-4" />
            </Button>
            <SheetTitle
              tabIndex={-1}
              className="truncate font-heading text-lg font-semibold tracking-tight text-foreground outline-none"
              title={asset.originalFilename}
            >
              {asset.originalFilename}
            </SheetTitle>
            <SheetDescription className="text-[13px] leading-snug text-muted-foreground">
              {[assetKindLabel(asset), formatBytes(asset.sizeBytes)].filter(Boolean).join(" · ")}
            </SheetDescription>
          </SheetHeader>

          {/* Keyed by asset: selecting a different file resets the section and
              every section's draft by remounting, rather than by an effect that
              writes state during render. */}
          <PanelSections key={asset.id} asset={asset} onDeleteRequest={() => setDeleteOpen(true)} />
        </SheetContent>
      </Sheet>

      {/* Destructive actions keep their own confirmation — navigating between
          sections is reversible, deleting a file is not. */}
      <AlertDialog open={deleteOpen} onOpenChange={(next) => !deleting && setDeleteOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <span className="font-medium">{asset.originalFilename}</span> from your
              libraries. You can&apos;t undo this from the UI.
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
                "Delete file"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Navigation plus the active section.
 *
 * Separate component so React can reset it by key. The panel shell stays
 * mounted across files — no close/reopen animation when you click the next
 * card — while everything inside starts fresh.
 */
function PanelSections({
  asset,
  onDeleteRequest,
}: {
  asset: AssetSummary
  onDeleteRequest: () => void
}) {
  const selection = useAssetSelection()
  const intentContext = useAssetPanelIntent()
  const sections = sectionsFor(asset)

  /**
   * Read once, while mounting for this asset.
   *
   * This component is keyed by asset id, so the initialiser runs exactly when a
   * new file is opened — which is the moment an intent is either relevant or
   * spent. Consuming it here rather than in an effect also means the first paint
   * is already on the right section, with no flash of Overview.
   */
  const [intent] = useState(() => intentContext?.consume(asset.id) ?? null)
  const [section, setSection] = useState<Section>(intent?.section ?? "overview")
  const active = sections.includes(section) ? section : "overview"

  return (
    <>
      <nav
        aria-label="Asset sections"
        /**
         * A grid, not a scrolling row.
         *
         * Five items with icon-and-label overflowed the panel and grew arrows,
         * so reaching Share meant scrolling a five-item menu. Equal columns fit
         * every section at once at any panel width, and the labels stack under
         * their icons rather than competing with them for horizontal space.
         */
        className="grid shrink-0 gap-0.5 border-b border-border p-1.5"
        // Columns follow the number of sections, so a file without an AI
        // section does not leave a gap where its tab would have been.
        style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}
        data-testid="asset-panel-nav"
      >
        {sections.map((key) => {
          const Icon = SECTION_ICONS[key]
          const current = key === active
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              aria-current={current ? "page" : undefined}
              data-testid={`asset-panel-tab-${key}`}
              title={SECTION_LABELS[key]}
              className={cn(
                "group relative flex flex-col items-center gap-1 rounded-lg px-1 pb-1.5 pt-2 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                current
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="text-[10.5px] font-semibold leading-none tracking-tight">
                {SECTION_LABELS[key]}
              </span>
              {/* The active marker, in the accent — a tab bar without the scroll. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-2 -bottom-px h-[2px] rounded-full transition-opacity",
                  current ? "bg-primary opacity-100" : "opacity-0",
                )}
              />
            </button>
          )
        })}
      </nav>

      {active === "overview" ? (
        <AssetOverviewContent
          asset={asset}
          onDownload={() => downloadAsset(asset.id)}
          onDelete={onDeleteRequest}
        />
      ) : null}
      {active === "edit" ? (
        <AssetEditContent asset={asset} onDone={() => setSection("overview")} />
      ) : null}
      {active === "ai" ? (
        <VideoTranscriptSection
          asset={asset}
          showDetails={false}
          initialTab={intent?.aiTab}
          initialDubLanguage={intent?.language}
        />
      ) : null}
      {active === "move" ? (
        <AssetMoveContent asset={asset} onDone={() => selection?.clear()} />
      ) : null}
      {active === "share" ? (
        <AssetShareContent
          target={{ resourceType: "ASSET", asset }}
          onDone={() => setSection("overview")}
        />
      ) : null}
    </>
  )
}

/** "Video", "Image", "Document" — the word a person would use. */
function assetKindLabel(asset: AssetSummary): string {
  switch (asset.mediaType) {
    case "VIDEO":
      return "Video"
    case "IMAGE":
      return "Image"
    case "AUDIO":
      return "Audio"
    case "DOCUMENT":
      return "Document"
    default:
      return "File"
  }
}

export { downloadAsset as downloadAssetFromPanel }
