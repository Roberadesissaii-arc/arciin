"use client"

import { useState } from "react"
import { Activity, RefreshCw } from "lucide-react"

import { ActivityItem } from "@/components/activity/activity-item"
import { AppPagination } from "@/components/ui/app-pagination"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

// ── Limited view (dashboard widget) ──────────────────────────────────────────

export function ActivityFeed({ limit, tall = false }: { limit?: number; tall?: boolean }) {
  const [page, setPage] = useState(1)
  const activityQuery = useActivity()

  if (activityQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>
    )
  }

  if (activityQuery.isError) {
    return (
      <div className="rounded-2xl border border-red-500/25 bg-red-50 p-4 text-sm text-red-800">
        {activityQuery.error instanceof Error
          ? activityQuery.error.message
          : "Could not load activity."}
      </div>
    )
  }

  const all = activityQuery.data ?? []

  // Dashboard widget: just slice, no card/pagination
  if (limit !== undefined) {
    const items = all.slice(0, limit)
    if (!items.length) return <ActivityEmpty bare />
    return (
      <div
        className={cn(
          "divide-y divide-border",
          tall && "min-h-0 flex-1 overflow-y-auto",
        )}>
        {items.map((event) => (
          <ActivityItem key={event.id} event={event} />
        ))}
      </div>
    )
  }

  // Full page view
  if (!all.length) return <ActivityEmpty />

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-foreground">Event log</CardTitle>
          <CardDescription className="text-zinc-500">
            {all.length} {all.length === 1 ? "event" : "events"} across your instance
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          {/* page indicator */}
          {totalPages > 1 && (
            <span className="rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
              {safePage} / {totalPages}
            </span>
          )}
          <Button
            size="sm"
            className="gap-1.5 bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
            onClick={() => activityQuery.refetch()}
            disabled={activityQuery.isFetching}
          >
            <RefreshCw className={`size-3.5 ${activityQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        <div className="divide-y divide-border">
          {pageItems.map((event) => (
            <ActivityItem key={event.id} event={event} />
          ))}
        </div>

        {totalPages > 1 && (
          <div className="border-t border-border px-5 py-3">
            <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function ActivityEmpty({ bare }: { bare?: boolean }) {
  const inner = (
    <Empty className={bare ? "" : "border border-border bg-card"}>
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
  return inner
}
