import React from "react"
import { Clock3 } from "lucide-react"

import { accentIconShellSm } from "@/lib/accent-styles"
import { resolveActivityIcon } from "@/lib/activity/resolve-activity-icon"
import { dashboardFeedMeta } from "@/lib/dashboard-card-styles"
import { formatRelativeDate, formatRelativeDateShort } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"
import type { ActivitySummary } from "@/lib/types/models"

function getIconElement(event: ActivitySummary, dashboard = false) {
  const IconComponent = resolveActivityIcon(event)
  return <IconComponent className={dashboard ? "size-4" : "size-3.5"} />
}

// ── Type label ────────────────────────────────────────────────────────────────

function typeLabel(type: string) {
  const parts = type.split(".")
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" · ")
}

// ── Item ──────────────────────────────────────────────────────────────────────

export function ActivityItem({
  event,
  compact = false,
  dashboard = false,
  variant = "feed",
}: {
  event: ActivitySummary
  /** Dashboard widget: clamp the message to one line so long events can't stretch the row. */
  compact?: boolean
  /** Match dashboard overview feed styling. */
  dashboard?: boolean
  variant?: "feed" | "cards"
}) {
  const label = typeLabel(event.type)

  if (variant === "cards") {
    return (
      <div className="rounded-xl border border-zinc-200/80 bg-gradient-to-br from-white to-zinc-50/80 px-3 py-2.5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className={cn(accentIconShellSm, "mt-0.5 size-8 rounded-lg")}>
            {getIconElement(event)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-semibold leading-snug text-zinc-900">{event.title}</p>
              <span className="shrink-0 text-[10px] font-medium text-zinc-400">
                {formatRelativeDate(event.createdAt)}
              </span>
            </div>
            {event.message ? (
              <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-zinc-500">
                {event.message}
              </p>
            ) : null}
            <span className="mt-1.5 inline-flex rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              {label}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        dashboard
          ? cn(
              "flex min-w-0 items-center gap-3 overflow-hidden px-3 py-3 transition-colors hover:bg-zinc-50/90",
              "min-h-[3.1rem] max-lg:flex-none lg:min-h-[3.25rem] lg:flex-1 lg:gap-3.5",
            )
          : "flex items-start gap-3.5 px-5 py-3.5",
      )}
    >
      <div
        className={cn(
          accentIconShellSm,
          dashboard ? "size-9 shrink-0 rounded-lg" : "mt-px size-7 rounded-lg",
        )}
      >
        {getIconElement(event, dashboard)}
      </div>

      {dashboard ? (
        <>
          <div className="min-w-0 max-w-[9.5rem] flex-1 overflow-hidden sm:max-w-[13rem] lg:max-w-[16rem] xl:max-w-[20rem]">
            <p className="truncate text-[13.5px] font-semibold leading-tight text-zinc-900">
              {event.title}
            </p>
            {event.message ? (
              <p
                className="mt-0.5 truncate text-[12.5px] leading-snug text-zinc-500"
                title={event.message}
              >
                {event.message}
              </p>
            ) : null}
          </div>

          <span className="inline-flex min-w-[92px] shrink-0 items-center justify-center self-start rounded-md bg-zinc-100 px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            {label}
          </span>

          <div className={cn(dashboardFeedMeta, "shrink-0 self-start pt-0.5")}>
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-zinc-400 md:hidden">
              {formatRelativeDateShort(event.createdAt)}
            </span>
            <div className="hidden items-center gap-1 whitespace-nowrap text-[11px] font-medium text-zinc-400 md:flex">
              <Clock3 className="size-3 shrink-0" />
              {formatRelativeDate(event.createdAt)}
            </div>
          </div>
        </>
      ) : (
        <>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            "flex-wrap items-center gap-x-2 gap-y-1",
          )}
        >
          <span className="text-[13px] font-semibold text-foreground">
            {event.title}
          </span>
          <span className="text-[11px] font-medium text-zinc-400">{label}</span>
        </div>
        {event.message && (
          <p
            className={cn(
              "mt-1 text-[12px] leading-relaxed text-zinc-500",
              compact && "truncate",
            )}
            title={compact ? event.message : undefined}
          >
            {event.message}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-zinc-400">
        <Clock3 className="size-3 shrink-0" />
        {formatRelativeDate(event.createdAt)}
      </div>
        </>
      )}
    </div>
  )
}
