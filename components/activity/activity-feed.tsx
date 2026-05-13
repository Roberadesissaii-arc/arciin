"use client"

import { useState } from "react"
import { Activity } from "lucide-react"

import { ActivityItem } from "@/components/activity/activity-item"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useActivity } from "@/hooks/use-activity"

const PAGE_SIZE = 5

function pageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  if (current <= 4) return [1, 2, 3, 4, 5, "ellipsis", total]
  if (current >= total - 3) return [1, "ellipsis", total - 4, total - 3, total - 2, total - 1, total]
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total]
}

export function ActivityFeed({ limit }: { limit?: number }) {
  const [page, setPage] = useState(1)
  const activityQuery = useActivity()

  if (activityQuery.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    )
  }

  if (activityQuery.isError) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">
        {activityQuery.error instanceof Error
          ? activityQuery.error.message
          : "Could not load activity."}
      </div>
    )
  }

  const all = activityQuery.data ?? []

  // When limit is set (e.g. dashboard widget), just slice and show — no pagination
  if (limit !== undefined) {
    const items = all.slice(0, limit)
    if (!items.length) return <ActivityEmpty />
    return (
      <div className="space-y-3">
        {items.map((event) => <ActivityItem key={event.id} event={event} />)}
      </div>
    )
  }

  // Full page view — paginate at PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageItems  = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  if (!all.length) return <ActivityEmpty />

  return (
    <div className="space-y-4">
      {/* Entry count */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-white/40">
          {all.length} {all.length === 1 ? "event" : "events"} total
        </span>
        <span className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-[11px] font-mono text-white/35">
          Page {safePage} of {totalPages}
        </span>
      </div>

      {/* Items */}
      <div className="space-y-3">
        {pageItems.map((event) => <ActivityItem key={event.id} event={event} />)}
      </div>

      {/* Pagination — only when there's more than one page */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(e) => { e.preventDefault(); if (safePage > 1) setPage((p) => p - 1) }}
                className={safePage === 1 ? "pointer-events-none opacity-40" : "cursor-pointer"}
              />
            </PaginationItem>

            {pageNumbers(safePage, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <PaginationItem key={`ell-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    isActive={p === safePage}
                    onClick={(e) => { e.preventDefault(); setPage(p) }}
                    className="cursor-pointer"
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              )
            )}

            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(e) => { e.preventDefault(); if (safePage < totalPages) setPage((p) => p + 1) }}
                className={safePage === totalPages ? "pointer-events-none opacity-40" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}

function ActivityEmpty() {
  return (
    <Empty className="border border-white/8 bg-white/[0.02]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Activity className="size-4" />
        </EmptyMedia>
        <EmptyTitle>No activity yet</EmptyTitle>
        <EmptyDescription>
          Upload files, create folders, and Arciin will keep the latest events visible here.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  )
}
