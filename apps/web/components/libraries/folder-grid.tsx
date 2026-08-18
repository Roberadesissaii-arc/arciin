"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

import { FolderCard } from "@/components/libraries/folder-card"
import type { FolderSummary } from "@/lib/types/models"

/** How many folder tiles show before "View more". */
export const FOLDER_GRID_PREVIEW_LIMIT = 8

export function FolderGrid({
  folders,
  librarySlug,
}: {
  folders: FolderSummary[]
  librarySlug: string
}) {
  const [expanded, setExpanded] = useState(false)
  const needsCollapse = folders.length > FOLDER_GRID_PREVIEW_LIMIT
  const visible =
    expanded || !needsCollapse ? folders : folders.slice(0, FOLDER_GRID_PREVIEW_LIMIT)
  const hiddenCount = folders.length - FOLDER_GRID_PREVIEW_LIMIT

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
        {visible.map((folder) => (
          <FolderCard key={folder.id} folder={folder} librarySlug={librarySlug} />
        ))}
      </div>

      {needsCollapse ? (
        <div className="flex justify-center pt-0.5">
          <button
            type="button"
            data-testid="folder-grid-view-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] font-semibold text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
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
                <span className="font-medium text-zinc-400">({hiddenCount} more)</span>
              </>
            )}
          </button>
        </div>
      ) : null}
    </div>
  )
}
