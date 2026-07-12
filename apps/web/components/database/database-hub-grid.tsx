import Link from "next/link"
import { Activity, ArrowRight, Layers2 } from "lucide-react"

import { LockedFeatureCard } from "@/components/license/locked-feature-card"
import { TableIcon } from "@/components/database/table-icon"
import type { AdminTable } from "@/lib/api/admin"

export function DatabaseHubGrid({
  tables,
  canAppData,
  appDataPlanLabel,
}: {
  tables: AdminTable[]
  canAppData: boolean
  appDataPlanLabel: string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {canAppData ? (
        <Link
          href="/database/app-data"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-primary/35 bg-gradient-to-br from-primary/12 via-card to-card p-4 shadow-sm ring-1 ring-primary/15 transition-all hover:border-primary/50 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary shadow-inner">
                <Layers2 className="size-4" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">App data databases</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Create logical stores for API clients: folders + JSON records in PostgreSQL (not media files).
                </p>
              </div>
            </div>
            <ArrowRight className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-primary/15 pt-3">
            <span className="text-[11px] font-medium text-muted-foreground">Automation and agents</span>
            <span className="rounded-lg border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Open
            </span>
          </div>
        </Link>
      ) : (
        <LockedFeatureCard
          plan={appDataPlanLabel}
          title="App data databases"
          description="Logical JSON databases for automation. Available on Pro and above. Core table browser stays free."
        />
      )}
      {tables.map((table) => (
        <Link
          key={table.name}
          href={`/database/${table.name}`}
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm ring-1 ring-black/[0.03] transition-all hover:border-primary/30 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <TableIcon name={table.name} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">{table.label}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{table.description}</p>
              </div>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border/80 pt-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="size-3" aria-hidden />
              <span className="text-[11px] font-medium">Records</span>
            </div>
            <span className="rounded-lg border border-border bg-muted/50 px-2 py-0.5 text-[12px] font-bold tabular-nums text-foreground">
              {table.count.toLocaleString()}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
