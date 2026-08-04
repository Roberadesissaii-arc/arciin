"use client"

import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Explicit paging control for asset lists.
 *
 * A button rather than infinite scroll: the list is also the selection surface
 * for move/delete, and auto-loading under a user who is mid-selection shifts
 * the page beneath them.
 */
export function LoadMoreAssets({
  hasMore,
  isLoading,
  onLoadMore,
  loadedCount,
  total,
}: {
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
  loadedCount: number
  total?: number
}) {
  if (!hasMore) {
    // Only claim completeness when the total confirms it.
    if (typeof total === "number" && loadedCount >= total && total > 0) {
      return (
        <p className="py-4 text-center text-xs text-muted-foreground">
          All {total.toLocaleString()} {total === 1 ? "file" : "files"} loaded.
        </p>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <Button
        type="button"
        variant="outline"
        onClick={onLoadMore}
        disabled={isLoading}
        className="min-w-40"
      >
        {isLoading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </>
        ) : (
          "Load more"
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        Showing {loadedCount.toLocaleString()}
        {typeof total === "number" ? ` of ${total.toLocaleString()}` : ""}
      </p>
    </div>
  )
}
