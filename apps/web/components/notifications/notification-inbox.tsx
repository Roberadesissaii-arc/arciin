"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Bell, CheckCheck, Trash2 } from "lucide-react"

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
import { useActivity } from "@/hooks/use-activity"
import {
  dashboardTableBodyRow,
  dashboardTableHeadCell,
  dashboardTableHeadRow,
  dashboardTablePagination,
  dashboardTablePanel,
  dashboardTablePanelHeader,
} from "@/lib/dashboard-table-styles"
import {
  isInboxNotificationUnread,
  unreadNotificationCount,
  useNotificationInboxStore,
  type InboxNotification,
} from "@/lib/stores/notification-inbox-store"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

const SOURCE_LABEL: Record<InboxNotification["source"], string> = {
  upload: "Upload",
  security: "Security",
  activity: "Activity",
  system: "System",
}

const VARIANT_BADGE: Record<InboxNotification["variant"], string> = {
  default: "border-0 bg-zinc-900 text-white",
  success: "border-0 bg-emerald-600 text-white",
  error: "border-0 bg-red-600 text-white",
  warning: "border-0 bg-amber-500 text-white",
}

function mapActivityToInbox(event: {
  id: string
  type: string
  title: string
  message?: string | null
  createdAt: string
}): InboxNotification | null {
  const t = event.type
  if (t.startsWith("auth.login_failed") || t.startsWith("auth.")) {
    return {
      id: `activity-${event.id}`,
      title: event.title,
      message: event.message ?? undefined,
      variant: t.includes("failed") ? "warning" : "default",
      source: "security",
      createdAt: event.createdAt,
      read: true,
    }
  }
  if (t.startsWith("upload.") || t.includes("upload")) {
    return {
      id: `activity-${event.id}`,
      title: event.title,
      message: event.message ?? undefined,
      variant: t.includes("failed") ? "error" : "success",
      source: "upload",
      createdAt: event.createdAt,
      read: true,
    }
  }
  if (t.startsWith("integration.") || t.startsWith("settings.")) {
    return {
      id: `activity-${event.id}`,
      title: event.title,
      message: event.message ?? undefined,
      variant: "default",
      source: "activity",
      createdAt: event.createdAt,
      read: true,
    }
  }
  return {
    id: `activity-${event.id}`,
    title: event.title,
    message: event.message ?? undefined,
    variant: "default",
    source: "activity",
    createdAt: event.createdAt,
    read: true,
  }
}

function NotificationTableRow({
  item,
  onOpen,
}: {
  item: InboxNotification
  onOpen: (item: InboxNotification) => void
}) {
  const unreadItem = isInboxNotificationUnread(item)

  return (
    <TableRow
      className={cn(
        dashboardTableBodyRow,
        "cursor-pointer [&>td]:align-middle [&>td]:py-3.5",
        unreadItem && "bg-muted/20",
      )}
      onClick={() => onOpen(item)}
    >
      <TableCell className="whitespace-nowrap py-3.5 pl-5 text-[13px] tabular-nums text-zinc-500">
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
            "inline-flex h-7 min-w-[5rem] justify-center rounded-md px-2.5 text-[11px] font-bold uppercase tracking-wide shadow-none",
            VARIANT_BADGE[item.variant],
          )}
        >
          {SOURCE_LABEL[item.source] ?? "Activity"}
        </Badge>
      </TableCell>
      <TableCell className="max-w-0 py-3.5">
        <span
          className={cn(
            "block min-w-0 max-w-[14rem] truncate text-[13px] font-medium sm:max-w-[18rem] lg:max-w-[24rem]",
            unreadItem ? "text-zinc-900" : "text-zinc-600",
          )}
          title={item.title}
        >
          {item.title}
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
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
            Unread
          </span>
        ) : (
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Read
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}

export function NotificationInbox() {
  const [page, setPage] = useState(1)
  const hydrate = useNotificationInboxStore((s) => s.hydrate)
  const items = useNotificationInboxStore((s) => s.items)
  const markRead = useNotificationInboxStore((s) => s.markRead)
  const markAllRead = useNotificationInboxStore((s) => s.markAllRead)
  const clearAll = useNotificationInboxStore((s) => s.clearAll)
  const hydrated = useNotificationInboxStore((s) => s.hydrated)
  const activityBackfillDone = useNotificationInboxStore((s) => s.activityBackfillDone)
  const backfillFromActivity = useNotificationInboxStore((s) => s.backfillFromActivity)

  const needsActivityBackfill = hydrated && !activityBackfillDone && items.length === 0
  const activityQuery = useActivity({ enabled: needsActivityBackfill })
  const backfillStartedRef = useRef(false)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!needsActivityBackfill || !activityQuery.data?.length || backfillStartedRef.current) {
      return
    }
    backfillStartedRef.current = true
    const entries = activityQuery.data
      .slice(0, 40)
      .map(mapActivityToInbox)
      .filter((row): row is InboxNotification => row !== null)
      .map((row) => ({
        id: row.id,
        title: row.title,
        message: row.message,
        variant: row.variant,
        source: row.source,
        read: row.read,
        createdAt: row.createdAt,
      }))
    backfillFromActivity(entries)
  }, [needsActivityBackfill, activityQuery.data, backfillFromActivity])

  const sorted = useMemo(
    () => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [items],
  )

  const unread = unreadNotificationCount(items)
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageItems = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function handleMarkAllRead() {
    hydrate()
    markAllRead()
  }

  function handleOpenItem(item: InboxNotification) {
    hydrate()
    markRead(item.id)
  }

  function handleClearAll() {
    clearAll()
    setPage(1)
  }

  return (
    <div className={dashboardTablePanel}>
      <div className={dashboardTablePanelHeader}>
        <Bell className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Recent alerts</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {sorted.length > 0 ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {sorted.length} alert{sorted.length === 1 ? "" : "s"}
              {unread > 0 ? ` · ${unread} unread` : " · all read"}
              {totalPages > 1 ? ` · page ${safePage} of ${totalPages}` : ""}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-border bg-card text-xs font-semibold text-foreground"
            disabled={unread === 0}
            onClick={handleMarkAllRead}
          >
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-border bg-card text-xs font-semibold text-foreground"
            disabled={items.length === 0}
            onClick={handleClearAll}
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Empty className="rounded-none border-0 py-12">
          <EmptyMedia variant="icon">
            <Bell />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No notifications yet</EmptyTitle>
            <EmptyDescription>
              Upload a file, sign in, or trigger activity — alerts will show here when notification
              channels are enabled in preferences.
            </EmptyDescription>
          </EmptyHeader>
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
            <div className={dashboardTablePagination}>
              <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
