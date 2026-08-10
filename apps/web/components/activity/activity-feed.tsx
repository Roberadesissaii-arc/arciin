"use client"

import { useState } from "react"
import { Activity, RefreshCw } from "lucide-react"

import { ActivityItem } from "@/components/activity/activity-item"
import { AppPagination } from "@/components/ui/app-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useActivity } from "@/hooks/use-activity"
import {
  activityLogDetails,
  activityLogDetailsPreview,
  activityLogEventLabel,
  activityLogSubjectLabel,
  activityLogTypeLabel,
} from "@/lib/activity/activity-log-display"
import {
  DASHBOARD_ACTIVITY_LIMIT,
  dashboardActivityList,
  dashboardFeedEmpty,
} from "@/lib/dashboard-card-styles"
import {
  dashboardTableBodyRow,
  dashboardTableHeadCell,
  dashboardTableHeadRow,
  dashboardTablePagination,
  dashboardTablePanel,
  dashboardTablePanelHeader,
} from "@/lib/dashboard-table-styles"
import { cn } from "@/lib/utils"
import type { ActivitySummary } from "@/lib/types/models"
import { RelativeTime } from "@/components/shared/relative-time"

const PAGE_SIZE = 10

const typeBadgeClass =
  "border-0 bg-primary text-[11px] font-bold uppercase tracking-wide text-primary-foreground shadow-none"

function ActivityTableRow({ event }: { event: ActivitySummary }) {
  const details = activityLogDetails(event)
  const subject = activityLogSubjectLabel(event)

  return (
    <TableRow className={cn(dashboardTableBodyRow, "[&>td]:align-middle [&>td]:py-3.5")}>
      <TableCell className="whitespace-nowrap py-3.5 pl-5 text-[13px] tabular-nums text-zinc-500">
        <RelativeTime value={event.createdAt} />
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5">
        <Badge className={cn("inline-flex h-7 min-w-[5rem] justify-center rounded-md px-2.5", typeBadgeClass)}>
          {activityLogTypeLabel(event.type)}
        </Badge>
      </TableCell>
      <TableCell className="max-w-0 py-3.5">
        <span
          className="block min-w-0 max-w-[14rem] truncate text-[13px] font-medium text-zinc-900 sm:max-w-[18rem] lg:max-w-[24rem]"
          title={activityLogEventLabel(event)}
        >
          {activityLogEventLabel(event)}
        </span>
      </TableCell>
      <TableCell className="max-w-0 py-3.5">
        <span
          className="block min-w-0 max-w-[12rem] truncate text-[13px] text-zinc-600 sm:max-w-[16rem]"
          title={activityLogDetailsPreview(details) ?? undefined}
        >
          {activityLogDetailsPreview(details) ?? <span className="text-zinc-400">—</span>}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5 pr-5 text-right text-[13px] font-medium text-zinc-600">
        {subject ?? <span className="text-zinc-400">—</span>}
      </TableCell>
    </TableRow>
  )
}

export function ActivityFeed({
  limit,
  tall = false,
  dashboard = false,
  activityVariant = "feed",
}: {
  limit?: number
  tall?: boolean
  dashboard?: boolean
  activityVariant?: "feed" | "cards"
}) {
  const [page, setPage] = useState(1)
  const activityQuery = useActivity()

  if (activityQuery.isLoading) {
    if (dashboard) {
      const skeletonRows = limit ?? DASHBOARD_ACTIVITY_LIMIT
      return (
        <div className={dashboardActivityList}>
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <Skeleton key={i} className="mx-2.5 my-1.5 h-[3.1rem] shrink-0 rounded-lg" />
          ))}
        </div>
      )
    }

    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="space-y-0 px-5 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="my-3 h-12 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (activityQuery.isError) {
    return (
      <p className="rounded-2xl border border-red-500/25 bg-red-50 px-5 py-10 text-center text-sm text-red-600">
        {activityQuery.error instanceof Error
          ? activityQuery.error.message
          : "Could not load activity."}
      </p>
    )
  }

  const all = activityQuery.data ?? []

  if (limit !== undefined) {
    const items = all.slice(0, limit)
    if (!items.length) return <ActivityEmpty bare dashboard={dashboard} />
    return (
      <div
        className={cn(
          activityVariant === "cards"
            ? "divide-y divide-zinc-200/80"
            : dashboard
              ? dashboardActivityList
              : "divide-y divide-border",
          tall && "min-h-0 flex-1 overflow-y-auto",
        )}
      >
        {items.map((event) => (
          <ActivityItem
            key={event.id}
            event={event}
            compact
            dashboard={dashboard}
            variant={activityVariant}
          />
        ))}
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div className={dashboardTablePanel}>
      <div className={dashboardTablePanelHeader}>
        <Activity className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Activity log</span>
        <div className="ml-auto flex items-center gap-2">
          {all.length > 0 ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {all.length} event{all.length === 1 ? "" : "s"}
              {totalPages > 1 ? ` · page ${safePage} of ${totalPages}` : ""}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-border bg-card text-xs font-semibold text-foreground"
            onClick={() => activityQuery.refetch()}
            disabled={activityQuery.isFetching}
          >
            <RefreshCw className={`size-3.5 ${activityQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {all.length === 0 ? (
        <ActivityEmpty inTable />
      ) : (
        <>
          <Table className="w-full min-w-0 table-fixed">
            <colgroup>
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <TableHeader>
              <TableRow className={dashboardTableHeadRow}>
                <TableHead className={cn(dashboardTableHeadCell, "pl-5")}>Time</TableHead>
                <TableHead className={dashboardTableHeadCell}>Type</TableHead>
                <TableHead className={dashboardTableHeadCell}>Event</TableHead>
                <TableHead className={dashboardTableHeadCell}>Details</TableHead>
                <TableHead className={cn(dashboardTableHeadCell, "pr-5 text-right")}>Subject</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((event) => (
                <ActivityTableRow key={event.id} event={event} />
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className={dashboardTablePagination}>
              <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ActivityEmpty({
  bare,
  dashboard,
  inTable,
}: {
  bare?: boolean
  dashboard?: boolean
  inTable?: boolean
}) {
  if (bare && dashboard) {
    return (
      <div className={dashboardFeedEmpty}>
        <p className="text-sm font-semibold text-zinc-900">No activity yet</p>
        <p className="mt-1 max-w-[16rem] text-sm leading-relaxed text-zinc-500">
          Upload files, create folders, and Arciin will keep the latest events visible here.
        </p>
      </div>
    )
  }

  if (inTable) {
    return (
      <Empty className="rounded-none border-0 py-12">
        <EmptyMedia variant="icon">
          <Activity />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No activity yet</EmptyTitle>
          <EmptyDescription>
            Upload files, create folders, and Arciin will keep the latest events visible here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
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
}
