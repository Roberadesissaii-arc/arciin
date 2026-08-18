"use client"

import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, Loader2, X } from "lucide-react"

import { AssetEditContent } from "@/components/libraries/rename-asset-dialog"
import { AssetMoveContent } from "@/components/libraries/move-asset-dialog"
import { AssetShareContent } from "@/components/shares/share-dialog"
import { DocumentAssistSection } from "@/components/libraries/document-assist-section"
import { isPdfAsset } from "@/lib/api/documents"
import { VideoTranscriptSection } from "@/components/libraries/video-edit-drawer"
import { useAssetPanelIntent } from "@/components/libraries/asset-panel-intent"
import { AssetOverviewContent } from "@/components/libraries/asset-overview-content"
import { useAssetSelection } from "@/components/libraries/asset-selection"
import { useAssetViewerOptional } from "@/components/libraries/asset-viewer-context"
import { useVideoEditor } from "@/components/libraries/video-edit-context"
import { isViewableAsset } from "@/lib/utils/viewable-asset"
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
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * One workspace for one selected file.
 *
 * Clicking a card always opens Overview — that is what a plain selection means.
 * Edit, Move, Share and AI live on the card's right-click menu instead of a tab
 * bar across the top of this panel. Those actions still render here (same forms
 * as the standalone sheets), just without a permanent tab strip to aim at.
 */

type Section = "overview" | "edit" | "ai" | "move" | "share"

const SECTION_LABELS: Record<Section, string> = {
  overview: "Overview",
  edit: "Edit",
  // Same label as the card right-click menu.
  ai: "Assist",
  move: "Move",
  share: "Share",
}

function sectionsFor(asset: AssetSummary): Section[] {
  const base: Section[] = ["overview", "edit"]
  if (asset.mediaType === "VIDEO" || isPdfAsset(asset)) base.push("ai")
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
              className="truncate pr-2 text-[14px] font-semibold leading-snug text-foreground"
              title={asset.originalFilename}
            >
              {asset.originalFilename}
            </SheetTitle>
            {/* Filename only — kind/size already live in Overview details. */}
            <SheetDescription className="sr-only">
              {assetKindLabel(asset)} details
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
 * Active section for one file.
 *
 * No tab bar — click always lands on Overview. Edit / Move / Share / AI arrive
 * through the card context menu (or the AI indicator), via panel intent.
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
  const videoEditor = useVideoEditor()
  const viewer = useAssetViewerOptional()
  const sections = sectionsFor(asset)

  /**
   * Read once on mount for this asset so the first paint is already on the
   * right section when the open came from a menu or AI indicator.
   */
  const [seed] = useState(() => intentContext?.consume(asset.id) ?? null)
  const [section, setSection] = useState<Section>(seed?.section ?? "overview")
  const [aiTab, setAiTab] = useState<"transcript" | "title" | undefined>(seed?.aiTab)
  const [appliedGeneration, setAppliedGeneration] = useState(intentContext?.generation ?? 0)

  /**
   * Apply a later intent without remounting.
   *
   * Right-click → Edit while this file is already selected does not change the
   * asset key, so the mount initialiser never runs again. Watching generation
   * is what makes that path land on the requested section.
   *
   * Adjusted during render rather than in an effect. An effect would paint
   * Overview first and then correct it, which is the cascading render the
   * lint rule is about; setting state while rendering lets React discard this
   * pass and re-render on the right section before anything reaches the screen.
   * The generation guard runs the branch exactly once per intent.
   */
  const generation = intentContext?.generation ?? 0
  if (generation !== appliedGeneration) {
    setAppliedGeneration(generation)
    const next = intentContext?.peek(asset.id) ?? null
    if (next?.section && sectionsFor(asset).includes(next.section)) {
      setSection(next.section)
      if (next.aiTab) setAiTab(next.aiTab)
    }
  }

  // Drop the intent once it has been committed, not while rendering.
  useEffect(() => {
    intentContext?.clear(asset.id)
  }, [appliedGeneration, asset.id, intentContext])

  const active = sections.includes(section) ? section : "overview"

  return (
    <>
      {/* When a menu opened a non-overview section, offer a quiet way back.
          No permanent tabs — just the current destination and Overview. */}
      {active !== "overview" ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-2"
          data-testid="asset-panel-section-bar"
        >
          <button
            type="button"
            onClick={() => setSection("overview")}
            data-testid="asset-panel-back-overview"
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium",
              "text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            )}
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            Overview
          </button>
          <span className="text-[12px] text-border" aria-hidden>
            /
          </span>
          <span className="text-[12.5px] font-semibold text-foreground">{SECTION_LABELS[active]}</span>
        </div>
      ) : null}

      {active === "overview" ? (
        <AssetOverviewContent
          asset={asset}
          onDownload={() => downloadAsset(asset.id)}
          onDelete={onDeleteRequest}
          onOpen={
            viewer?.canOpen(asset) && isViewableAsset(asset)
              ? () => viewer.openViewer(asset.id)
              : undefined
          }
          onOpenAi={
            asset.mediaType === "VIDEO"
              ? () => {
                  if (videoEditor?.canEdit(asset)) videoEditor.openEditor(asset)
                  else setSection("ai")
                }
              : isPdfAsset(asset)
                ? () => setSection("ai")
                : undefined
          }
        />
      ) : null}
      {active === "edit" ? (
        <AssetEditContent asset={asset} onDone={() => setSection("overview")} />
      ) : null}
      {active === "ai" ? (
        asset.mediaType === "VIDEO" ? (
          <VideoTranscriptSection
            asset={asset}
            showDetails={false}
            initialTab={aiTab}
          />
        ) : (
          <DocumentAssistSection asset={asset} />
        )
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
