"use client"

import { useEffect, useMemo, useState } from "react"
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
import { recordInboxNotification } from "@/lib/notifications/record-inbox-notification"
import {
  unreadNotificationCount,
  useNotificationInboxStore,
  type InboxNotification,
} from "@/lib/stores/notification-inbox-store"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

const VARIANT_STYLE: Record<
  InboxNotification["variant"],
  { dot: string; border: string }
> = {
  default: { dot: "bg-zinc-400", border: "border-border" },
  success: { dot: "bg-emerald-500", border: "border-emerald-500/25" },
  error: { dot: "bg-red-500", border: "border-red-500/25" },
  warning: { dot: "bg-amber-500", border: "border-amber-500/25" },
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
  const hydrate = useNotificationInboxStore((s) => s.hydrate)
  const items = useNotificationInboxStore((s) => s.items)
  const markRead = useNotificationInboxStore((s) => s.markRead)
  const markAllRead = useNotificationInboxStore((s) => s.markAllRead)
  const clearAll = useNotificationInboxStore((s) => s.clearAll)
  const hydrated = useNotificationInboxStore((s) => s.hydrated)
  const activityBackfillDone = useNotificationInboxStore((s) => s.activityBackfillDone)
  const setActivityBackfillDone = useNotificationInboxStore((s) => s.setActivityBackfillDone)

  const activityQuery = useActivity()

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!hydrated || activityBackfillDone || items.length > 0 || !activityQuery.data?.length) {
      return
    }
    for (const event of activityQuery.data.slice(0, 40)) {
      const mapped = mapActivityToInbox(event)
      if (mapped) {
        recordInboxNotification({
          id: mapped.id,
          title: mapped.title,
          message: mapped.message,
          variant: mapped.variant,
          source: mapped.source,
          read: mapped.read,
        })
      }
    }
    setActivityBackfillDone()
  }, [
    hydrated,
    activityBackfillDone,
    items.length,
    activityQuery.data,
    setActivityBackfillDone,
  ])

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
              ? `${sorted.length} ${sorted.length === 1 ? "alert" : "alerts"} in this browser`
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
                const style = VARIANT_STYLE[item.variant]
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => markRead(item.id)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/40",
                        style.border,
                        !item.read && "ring-1 ring-primary/20",
                      )}
                    >
                      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", style.dot)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-[13px] font-semibold text-foreground">{item.title}</span>
                          {!item.read ? (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                              New
                            </span>
                          ) : null}
                        </span>
                        {item.message ? (
                          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                            {item.message}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-zinc-500" suppressHydrationWarning>
                          {formatRelativeDate(item.createdAt)}
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
