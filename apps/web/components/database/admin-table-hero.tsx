"use client"

import { cn } from "@/lib/utils"
import type { AdminTableSummaryMetric } from "@/lib/api/admin"
import { TableIcon } from "@/components/database/table-icon"

/**
 * The introduction on a table's own page.
 *
 * Shares its title, description and metrics with the card on the Database hub,
 * because both read the same catalogue from the API — the wording cannot drift
 * between the two by editing one of them.
 *
 * Smaller than the hub's hero on purpose: this is a child page, and the reader
 * arrived here already knowing they wanted this table.
 */

const TONE_CLASSES: Record<AdminTableSummaryMetric["tone"], string> = {
  neutral: "border-border bg-muted/50 text-muted-foreground",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
}

export function AdminTableHero({
  table,
  label,
  description,
  summary,
  className,
}: {
  table: string
  label: string
  description?: string
  summary?: AdminTableSummaryMetric[]
  className?: string
}) {
  const metrics = (summary ?? []).filter((metric) => Number.isFinite(metric.value))

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card px-4 py-4 shadow-sm ring-1 ring-black/[0.03] sm:px-5",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {/* TableIcon brings its own framed container, the same one the hub
            cards use, so the two surfaces stay visually related. */}
        <TableIcon name={table} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{label}</h2>
          {description ? (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
          ) : null}

          {metrics.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {metrics.map((metric) => (
                <span
                  key={metric.label}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium",
                    TONE_CLASSES[metric.tone],
                  )}
                >
                  <span className="font-bold tabular-nums">{metric.value.toLocaleString()}</span>
                  {metric.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
