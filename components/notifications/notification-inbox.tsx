"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Bell, CheckCheck, Settings, Trash2 } from "lucide-react"

import { AppPagination } from "@/components/ui/app-pagination"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useActivity } from "@/hooks/use-activity"
import {
  isInboxNotificationUnread,
  unreadNotificationCount,
  useNotificationInboxStore,
  type InboxNotification,
} from "@/lib/stores/notification-inbox-store"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

const VARIANT_BORDER: Record<InboxNotification["variant"], string> = {
  default: "border-border",
  success: "border-emerald-500/25",
  error: "border-red-500/25",
  warning: "border-amber-500/25",
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

export function NotificationInbox() {
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
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
    setExpandedId(null)
  }

  function handleOpenItem(item: InboxNotification) {
    hydrate()
    markRead(item.id)
    setExpandedId((current) => (current === item.id ? null : item.id))
  }

  function handleClearAll() {
    clearAll()
    setPage(1)
  }

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Bell className="size-5 text-primary" />
            Recent alerts
          </CardTitle>
          <CardDescription className="text-zinc-600">
            {sorted.length > 0
              ? unread > 0
                ? `${sorted.length} ${sorted.length === 1 ? "alert" : "alerts"} · ${unread} unread — tap an alert to read it`
                : `${sorted.length} ${sorted.length === 1 ? "alert" : "alerts"} · all read`
              : "Toasts and live events for this browser. New alerts appear here and in the corner overlay."}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {totalPages > 1 ? (
            <span className="rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
              {safePage} / {totalPages}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={unread === 0}
            onClick={handleMarkAllRead}
          >
            <CheckCheck className="size-4" />
            Mark all read
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={items.length === 0} onClick={handleClearAll}>
            <Trash2 className="size-4" />
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {sorted.length === 0 ? (
          <div className="px-6 pb-6">
            <Empty className="border border-dashed border-border py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Bell className="size-5" />
                </EmptyMedia>
                <EmptyTitle>No notifications yet</EmptyTitle>
                <EmptyDescription>
                  Upload a file, sign in, or trigger activity — alerts will show here when notification
                  channels are enabled in preferences.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <>
            <ul className="space-y-2 px-6 pt-0 pb-4">
              {pageItems.map((item) => {
                const unreadItem = isInboxNotificationUnread(item)
                const expanded = expandedId === item.id
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleOpenItem(item)}
                      aria-expanded={expanded}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/40",
                        VARIANT_BORDER[item.variant],
                        unreadItem && "ring-1 ring-primary/25 bg-muted/30",
                        !unreadItem && "opacity-90",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          unreadItem ? "bg-primary shadow-[0_0_0_3px_rgba(255,79,18,0.2)]" : "bg-zinc-400",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span
                            className={cn(
                              "text-[13px] font-semibold",
                              unreadItem ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {item.title}
                          </span>
                          {unreadItem ? (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                              Unread
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Read
                            </span>
                          )}
                        </span>
                        {item.message && !expanded ? (
                          <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                            {item.message}
                          </p>
                        ) : null}
                        {expanded && item.message ? (
                          <p className="mt-1.5 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-[12px] leading-relaxed text-foreground">
                            {item.message}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-zinc-500" suppressHydrationWarning>
                          {formatRelativeDate(item.createdAt)}
                          {expanded ? " · tap again to collapse" : " · tap to open"}
                        </p>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {totalPages > 1 ? (
              <div className="border-t border-border px-5 py-3">
                <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
              </div>
            ) : null}
          </>
        )}

        <p className="border-t border-border px-6 py-3 text-[12px] text-muted-foreground">
          To change sounds and which events raise toasts, use{" "}
          <Link
            href="/settings?tab=notifications"
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
          >
            <Settings className="size-3.5" />
            Settings → Notifications
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  )
}
