"use client"

import { Skeleton } from "@/components/ui/skeleton"
import {
  dashboardTablePanel,
  dashboardTablePanelHeader,
} from "@/lib/dashboard-table-styles"
import { cn } from "@/lib/utils"

/** Mirrors LibraryBrowserToolbar chrome (search row + filter row). */
export function LibraryBrowserToolbarSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
      aria-hidden
    >
      <div className="flex min-h-[3.25rem] items-center gap-2 border-b border-zinc-100 bg-zinc-50/40 px-3 py-2.5 sm:px-4">
        <Skeleton className="size-4 shrink-0 rounded" />
        <Skeleton className="h-10 min-w-0 flex-1 rounded-lg" />
        <Skeleton className="h-5 w-10 shrink-0 rounded-md" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-12 rounded-lg" />
          <Skeleton className="h-8 w-14 rounded-lg" />
          <Skeleton className="h-[46px] w-[9.5rem] rounded-xl" />
          <Skeleton className="h-[46px] w-[9rem] rounded-xl" />
        </div>
        <Skeleton className="h-11 w-28 rounded-lg" />
      </div>
    </div>
  )
}

/** Mirrors AssetCard: ~216px white tile (104px preview + meta + badges). */
export function AssetCardSkeleton() {
  return (
    <div className="h-[14.25rem] overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-2.5 shadow-sm">
      <Skeleton className="h-[7.25rem] w-full rounded-xl" />
      <div className="mt-2.5 space-y-1">
        <Skeleton className="h-3.5 w-[85%]" />
        <Skeleton className="h-3 w-[55%]" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-1.5">
        <Skeleton className="h-5 w-16 rounded-md" />
        <Skeleton className="h-5 w-14 rounded-md" />
      </div>
    </div>
  )
}

/** Same grid breakpoints as AssetGrid. */
export function AssetGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 items-start gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      aria-busy
      aria-label="Loading files"
    >
      {Array.from({ length: count }).map((_, i) => (
        <AssetCardSkeleton key={i} />
      ))}
    </div>
  )
}

/** Mirrors AssetTable panel + rows. */
export function AssetTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className={cn(dashboardTablePanel, "min-w-0 max-w-full")} aria-busy aria-label="Loading files">
      <div className={dashboardTablePanelHeader}>
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="ml-auto h-5 w-24 rounded-md" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-5 py-3.5"
          >
            <Skeleton className="size-4 shrink-0 rounded" />
            <Skeleton className="h-4 min-w-0 flex-1 max-w-[11rem]" />
            <Skeleton className="hidden h-6 w-16 shrink-0 rounded-md sm:block" />
            <Skeleton className="h-7 w-[5rem] shrink-0 rounded-md" />
            <Skeleton className="hidden h-4 w-14 shrink-0 md:block" />
            <Skeleton className="hidden h-4 w-16 shrink-0 lg:block" />
            <div className="ml-auto flex shrink-0 gap-1.5">
              <Skeleton className="h-8 w-20 rounded-md" />
              <Skeleton className="size-7 rounded-md" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Mirrors FolderGrid + compact folder cards. */
export function FolderGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4"
      aria-busy
      aria-label="Loading folders"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-3 shadow-sm"
        >
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-[70%]" />
            <Skeleton className="h-3 w-[40%]" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function BrowserSectionHeadingSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("mb-1 h-5 w-20", className)} />
}

/**
 * Full library browser loading layout — matches intro + toolbar + assets
 * (and optional folders strip for library-scoped pages).
 */
export function LibraryBrowserSkeleton({
  showFolders = false,
  view = "grid",
  intro,
}: {
  showFolders?: boolean
  view?: "grid" | "table"
  intro?: React.ReactNode
}) {
  return (
    <div className="space-y-5 pb-10">
      {intro ?? (
        <div className="space-y-3 rounded-3xl border border-zinc-200/90 bg-gradient-to-br from-zinc-50 via-white to-zinc-50/95 p-5 shadow-sm md:p-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {showFolders ? (
        <section className="space-y-2 pb-2">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200/90 pb-2">
            <BrowserSectionHeadingSkeleton />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
          <FolderGridSkeleton />
        </section>
      ) : null}

      <section className={cn("space-y-3 pb-4", showFolders && "pt-4")}>
        <BrowserSectionHeadingSkeleton className="mb-0 h-5 w-16" />
        <LibraryBrowserToolbarSkeleton />
        {view === "table" ? <AssetTableSkeleton /> : <AssetGridSkeleton />}
      </section>
    </div>
  )
}
