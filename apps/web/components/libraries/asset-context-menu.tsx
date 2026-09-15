"use client"

import type { ReactNode } from "react"
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Info,
  PencilLine,
  Share2,
  Sparkles,
} from "lucide-react"

import { useAssetPanelIntent } from "@/components/libraries/asset-panel-intent"
import { useAssistLicense } from "@/components/libraries/assist-license-gate"
import { useAssetViewerOptional } from "@/components/libraries/asset-viewer-context"
import { useVideoEditor } from "@/components/libraries/video-edit-context"
import { useArchiveAsset, useUnarchiveAsset } from "@/hooks/use-assets"
import { toast } from "@/lib/notifications/arciin-toast"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  libraryContextMenuLabel,
  libraryGlassContextMenu,
  libraryGlassContextMenuItem,
} from "@/lib/library-glass-sheet"
import { assetOffersAssist, assetOffersMediaAssist } from "@/lib/utils/asset-assist"
import type { AssetSummary } from "@/lib/types/models"

/**
 * Same right-click menu on every library page: Videos, Images, Music, Documents, Inbox.
 *
 * Overview, Assist (when the type supports it), Rename, Move, Share, Archive.
 * Computer-browser `readOnly` is the only thing that hides mutate actions.
 */
export function AssetContextMenu({
  asset,
  readOnly = false,
  children,
}: {
  asset: AssetSummary
  readOnly?: boolean
  children: ReactNode
}) {
  const viewer = useAssetViewerOptional()
  const panelIntent = useAssetPanelIntent()
  const videoEditor = useVideoEditor()
  const { locked: assistLocked, planLabel: assistPlanLabel } = useAssistLicense()
  const archiveMutation = useArchiveAsset()
  const unarchiveMutation = useUnarchiveAsset()
  const isArchived = Boolean(asset.archivedAt)
  const canMutate = !readOnly

  const openAt = (section: "overview" | "edit" | "ai" | "move" | "share") => {
    panelIntent?.open({ assetId: asset.id, section })
  }

  const openAi = () => {
    if (assistLocked) {
      openAt("ai")
      return
    }
    if (assetOffersMediaAssist(asset) && videoEditor?.canEdit(asset)) {
      videoEditor.openEditor(asset)
      return
    }
    if (asset.mediaType === "IMAGE" && viewer?.canOpen(asset)) {
      viewer.openViewer(asset.id)
      return
    }
    openAt("ai")
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className={libraryGlassContextMenu} data-testid="asset-card-menu">
        <ContextMenuLabel className={libraryContextMenuLabel} title={asset.originalFilename}>
          {asset.originalFilename}
        </ContextMenuLabel>
        <ContextMenuSeparator className="-mx-0.5 my-1" />
        <ContextMenuItem
          className={libraryGlassContextMenuItem}
          onSelect={() => openAt("overview")}
          data-testid="asset-menu-overview"
        >
          <Info />
          Overview
        </ContextMenuItem>
        {assetOffersAssist(asset) ? (
          <ContextMenuItem
            className={libraryGlassContextMenuItem}
            onSelect={openAi}
            data-testid="asset-menu-ai"
          >
            <Sparkles />
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span>Assist</span>
              {assistLocked ? (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                  style={{
                    color: "var(--arciin-accent, #ff4f12)",
                    background:
                      "color-mix(in srgb, var(--arciin-accent, #ff4f12) 12%, transparent)",
                    border:
                      "1px solid color-mix(in srgb, var(--arciin-accent, #ff4f12) 28%, transparent)",
                  }}
                >
                  {assistPlanLabel}
                </span>
              ) : null}
            </span>
          </ContextMenuItem>
        ) : null}
        {canMutate ? (
          <ContextMenuItem
            className={libraryGlassContextMenuItem}
            onSelect={() => openAt("edit")}
            data-testid="asset-menu-rename"
          >
            <PencilLine />
            Rename
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator className="-mx-0.5 my-1" />
        {canMutate ? (
          <ContextMenuItem
            className={libraryGlassContextMenuItem}
            onSelect={() => openAt("move")}
            data-testid="asset-menu-move"
          >
            <ArrowRightLeft />
            Move
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          className={libraryGlassContextMenuItem}
          onSelect={() => openAt("share")}
          data-testid="asset-menu-share"
        >
          <Share2 />
          Share
        </ContextMenuItem>
        {canMutate ? (
          <>
            <ContextMenuSeparator className="-mx-0.5 my-1" />
            {isArchived ? (
              <ContextMenuItem
                className={libraryGlassContextMenuItem}
                disabled={unarchiveMutation.isPending}
                onSelect={() => {
                  unarchiveMutation.mutate(asset.id, {
                    onSuccess: () =>
                      toast.success("Restored from Archives", {
                        description: asset.originalFilename,
                      }),
                    onError: () =>
                      toast.error("Could not unarchive", {
                        description: "Try again in a moment.",
                      }),
                  })
                }}
                data-testid="asset-menu-unarchive"
              >
                <ArchiveRestore />
                Unarchive
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                className={libraryGlassContextMenuItem}
                disabled={archiveMutation.isPending}
                onSelect={() => {
                  archiveMutation.mutate(asset.id, {
                    onSuccess: () =>
                      toast.success("Moved to Archives", {
                        description: "Find it under All Files → Archives.",
                      }),
                    onError: () =>
                      toast.error("Could not archive", {
                        description: "Try again in a moment.",
                      }),
                  })
                }}
                data-testid="asset-menu-archive"
              >
                <Archive />
                Archive
              </ContextMenuItem>
            )}
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
