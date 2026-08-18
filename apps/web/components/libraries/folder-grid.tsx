"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

import { FolderCard } from "@/components/libraries/folder-card"
import type { FolderSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/** How many folder tiles show before "View more". */
export const FOLDER_GRID_PREVIEW_LIMIT = 8

/**
 * Collapse state for a folder section.
 * The toggle lives in the Folders header (beside Create folder); the grid
 * only renders the visible slice — no extra row under the tiles.
 */
export function useFolderGridLimit(folders: FolderSummary[]) {
  const [expanded, setExpanded] = useState(false)
  const needsCollapse = folders.length > FOLDER_GRID_PREVIEW_LIMIT
  const hiddenCount = Math.max(0, folders.length - FOLDER_GRID_PREVIEW_LIMIT)
  const visibleFolders = useMemo(
    () => (expanded || !needsCollapse ? folders : folders.slice(0, FOLDER_GRID_PREVIEW_LIMIT)),
    [expanded, needsCollapse, folders],
  )

  return {
    visibleFolders,
    expanded,
    setExpanded,
    needsCollapse,
    hiddenCount,
    toggle: () => setExpanded((v) => !v),
  }
}

/** Compact header control — sits in front of Create folder. */
export function FolderViewMoreButton({
  expanded,
  needsCollapse,
  hiddenCount,
  onToggle,
  className,
}: {
  expanded: boolean
  needsCollapse: boolean
  hiddenCount: number
  onToggle: () => void
  className?: string
}) {
  if (!needsCollapse) return null

  return (
    <button
      type="button"
      data-testid="folder-grid-view-more"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5",
        "text-[12px] font-semibold text-zinc-600 transition-colors",
        "hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900",
        className,
      )}
    >
      {expanded ? (
        <>
          <ChevronUp className="size-3.5" aria-hidden />
          Show less
        </>
      ) : (
        <>
          <ChevronDown className="size-3.5" aria-hidden />
          View more
          <span className="font-medium text-zinc-400">({hiddenCount})</span>
        </>
      )}
    </button>
  )
}

export function FolderGrid({
  folders,
  librarySlug,
}: {
  folders: FolderSummary[]
  librarySlug: string
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
      {folders.map((folder) => (
        <FolderCard key={folder.id} folder={folder} librarySlug={librarySlug} />
      ))}
    </div>
  )
}
