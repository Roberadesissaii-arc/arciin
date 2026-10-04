"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertCircle, Bell, Check, CheckCheck, Inbox } from "lucide-react"

import { ConfirmDestructiveButton } from "@/components/shared/confirm-destructive-button"
import { AppPagination } from "@/components/ui/app-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useClearNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsPage,
} from "@/hooks/use-notifications"
import type { NotificationItem } from "@/lib/api/notifications"
import {
  dashboardTableBodyRow,
  dashboardTableHeadCell,
  dashboardTableHeadRow,
  dashboardTablePagination,
  dashboardTablePanel,
  dashboardTablePanelHeader,
} from "@/lib/dashboard-table-styles"
import { Skeleton } from "@/components/ui/skeleton"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

const SOURCE_LABEL: Record<NotificationItem["source"], string> = {
  upload: "Upload",
  security: "Security",
  activity: "Activity",
}

/** Badge color reflects the category (source) — stable regardless of outcome. Tinted, not solid: a list of solid blocks shouts. */
const SOURCE_BADGE: Record<NotificationItem["source"], string> = {
  upload: "border border-[#FF4F12]/25 bg-[#FF4F12]/[0.08] text-[#C23A06]",
  security: "border border-sky-500/30 bg-sky-500/10 text-sky-800",
  activity: "border border-violet-500/25 bg-violet-500/10 text-violet-800",
}

/** Outcome indicator, shown separately from the source badge so the two never conflate. */
const VARIANT_DOT: Record<NotificationItem["variant"], string> = {
  default: "bg-zinc-400",
  success: "bg-emerald-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
}

const VARIANT_LABEL: Record<NotificationItem["variant"], string> = {
  default: "Info",
  success: "Success",
  error: "Failed",
  warning: "Warning",
}

function NotificationTableRow({
  item,
  onOpen,
}: {
  item: NotificationItem
  onOpen: (item: NotificationItem) => void
}) {
  const unreadItem = !item.read

  return (
    <TableRow
      data-unread={unreadItem || undefined}
      className={cn(
        dashboardTableBodyRow,
        "relative cursor-pointer [&>td]:align-middle [&>td]:py-3.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FF4F12]/30",
        unreadItem ? "bg-[#FF4F12]/[0.035]" : "",
      )}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen(item)
        }
      }}
      tabIndex={0}
      aria-label={`${item.title}${unreadItem ? ", unread. Press Enter to mark read." : ", read."}`}
    >
      <TableCell className="relative whitespace-nowrap py-3.5 pl-5 text-[13px] tabular-nums text-zinc-600">
        {unreadItem ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#FF4F12]" aria-hidden /> : null}
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              unreadItem
                ? "bg-primary shadow-[0_0_0_3px_rgba(255,79,18,0.2)]"
                : "bg-zinc-300",
            )}
            aria-hidden
          />
          <span suppressHydrationWarning>{formatRelativeDate(item.createdAt)}</span>
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5">
        <Badge
          className={cn(
            "inline-flex h-6 min-w-[4.75rem] justify-center rounded-md px-2 text-[11px] font-semibold shadow-none",
            SOURCE_BADGE[item.source] ?? SOURCE_BADGE.activity,
          )}
        >
          {SOURCE_LABEL[item.source] ?? "Activity"}
        </Badge>
      </TableCell>
      <TableCell className="max-w-0 py-3.5">
        <span className="flex min-w-0 items-center gap-1.5" title={`${VARIANT_LABEL[item.variant]}: ${item.title}`}>
          <span
            className={cn("size-1.5 shrink-0 rounded-full", VARIANT_DOT[item.variant])}
            aria-hidden
          />
          <span
            className={cn(
              "block min-w-0 max-w-[14rem] truncate text-[13px] font-medium sm:max-w-[18rem] lg:max-w-[24rem]",
              unreadItem ? "font-semibold text-zinc-900" : "text-zinc-600",
            )}
          >
            {item.title}
          </span>
        </span>
      </TableCell>
      <TableCell className="max-w-0 py-3.5">
        <span
          className="block min-w-0 max-w-[12rem] truncate text-[13px] text-zinc-600 sm:max-w-[16rem]"
          title={item.message ?? undefined}
        >
          {item.message ?? <span className="text-zinc-400">—</span>}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5 pr-5 text-right">
        {unreadItem ? (
          <span className="rounded-md border border-[#FF4F12]/25 bg-[#FF4F12]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#C23A06]">
            Unread
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
            <Check className="size-3" aria-hidden />
            Read
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}

export function NotificationInbox() {
  const [page, setPage] = useState(1)
  const query = useNotificationsPage(page, PAGE_SIZE)
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const clearInbox = useClearNotifications()

  const pageItems = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const unread = query.data?.unreadCount ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(Math.max(1, page), totalPages)

  function handleOpenItem(item: NotificationItem) {
    if (!item.read) markRead.mutate(item.id)
  }

  return (
    <div className={dashboardTablePanel}>
      <div className={cn(dashboardTablePanelHeader, "flex-wrap gap-y-2")}>
        <Bell className="size-4 text-primary" aria-hidden />
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-foreground">Recent alerts</span>
          {total > 0 ? (
            <span className="text-[12px] text-zinc-600" data-testid="notifications-summary">
              {unread > 0 ? (
                <>
                  <span className="font-semibold text-[#C23A06]">{unread.toLocaleString()} unread</span> ·{" "}
                </>
              ) : (
                "All read · "
              )}
              {total.toLocaleString()} total
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-border bg-card text-xs font-semibold text-foreground"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
          <ConfirmDestructiveButton
            variant="outline"
            className="h-8 gap-1.5 border-border bg-card text-xs font-semibold text-foreground"
            title="Clear all notifications?"
            description="This removes them from your notification inbox. Your Activity history will stay available."
            confirmLabel="Clear inbox"
            disabled={total === 0}
            pending={clearInbox.isPending}
            onConfirm={() => clearInbox.mutateAsync()}
            data-testid="notifications-clear"
          >
            <Inbox className="size-3.5" />
            Clear inbox
          </ConfirmDestructiveButton>
        </div>
      </div>

      {query.isError && !query.data ? (
        <Empty className="rounded-none border-0 py-12">
          <EmptyMedia variant="icon">
            <AlertCircle />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Notifications could not be loaded</EmptyTitle>
            <EmptyDescription>
              The server did not answer. Check that Arciin is running, then try again.
            </EmptyDescription>
          </EmptyHeader>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </Empty>
      ) : query.isPending ? (
        <div className="space-y-2 p-5" aria-busy="true" aria-label="Loading notifications">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <Empty className="rounded-none border-0 py-12">
          <EmptyMedia variant="icon">
            <Bell />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No notifications</EmptyTitle>
            <EmptyDescription>
              Your inbox is clear. Uploads, sign-ins, and other events on this server will appear
              here, on every device you use. Everything that happened is still in Activity.
            </EmptyDescription>
          </EmptyHeader>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/activity">View Activity</Link>
          </Button>
        </Empty>
      ) : (
        <>
          <Table className="w-full min-w-0 table-fixed">
            <colgroup>
              <col style={{ width: "16%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <TableHeader>
              <TableRow className={dashboardTableHeadRow}>
                <TableHead className={cn(dashboardTableHeadCell, "pl-5")}>Time</TableHead>
                <TableHead className={dashboardTableHeadCell}>Source</TableHead>
                <TableHead className={dashboardTableHeadCell}>Alert</TableHead>
                <TableHead className={dashboardTableHeadCell}>Message</TableHead>
                <TableHead className={cn(dashboardTableHeadCell, "pr-5 text-right")}>
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((item) => (
                <NotificationTableRow key={item.id} item={item} onOpen={handleOpenItem} />
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className={cn(dashboardTablePagination, "flex flex-wrap items-center justify-between gap-2")}>
              <span className="text-[12px] tabular-nums text-zinc-600" data-testid="notifications-range">
                Showing {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–
                {Math.min(safePage * PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}
              </span>
              <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
