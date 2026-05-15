"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  ArrowRight,
  Boxes,
  Database,
  Film,
  Folder,
  FolderTree,
  HardDrive,
  Home,
  Key,
  KeyRound,
  Layers2,
  Library,
  Loader2,
  Puzzle,
  User,
} from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { getAdminTables } from "@/lib/api/admin"
import { queryKeys } from "@/lib/api/query-keys"
import { fetchApi } from "@/lib/api/client"
import type { HealthStatus } from "@/lib/types/models"
import { cn } from "@/lib/utils"

const TABLE_ICONS: Record<string, LucideIcon> = {
  users: User,
  sessions: KeyRound,
  "api-keys": Key,
  libraries: Library,
  folders: Folder,
  assets: Film,
  "storage-objects": HardDrive,
  "activity-events": Activity,
  jobs: Boxes,
  integrations: Puzzle,
  "app-databases": Layers2,
  "app-database-folders": FolderTree,
  "app-database-records": Database,
  "instance-config": Home,
}

function TableIcon({ name }: { name: string }) {
  const Icon = TABLE_ICONS[name] ?? Database
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-primary shadow-inner shadow-black/[0.03]">
      <Icon className="size-4" aria-hidden />
    </div>
  )
}

export default function DatabasePage() {
  const tablesQuery = useQuery({
    queryKey: queryKeys.adminTables,
    queryFn: ({ signal }) => getAdminTables(signal),
  })

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchApi<HealthStatus>("/health"),
    refetchInterval: 15_000,
  })

  const tables = tablesQuery.data ?? []
  const dbOnline = healthQuery.data?.database === "online"
  const totalRows = tables.reduce((s, t) => s + t.count, 0)

  const badge = (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold",
        dbOnline
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-800"
          : "border-red-500/25 bg-red-500/10 text-red-800"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          dbOnline
            ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(34,197,94,0.25)]"
            : "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.2)]"
        )}
      />
      {healthQuery.isLoading ? "Checking…" : dbOnline ? "Connected" : "Offline"}
    </div>
  )

  return (
    <div className="space-y-5 pb-6">
      <DashboardPageIntro
        title="Database"
        subtitle="PostgreSQL · Prisma ORM · live record counts"
        description="Browse every table in the Arciin schema. Open a table to inspect rows and verify data. Reads are admin-only and never expose secrets or password hashes. For automation-facing logical databases (JSON + folders), use App data databases — separate from library file storage."
        badge={badge}
        stats={[
          { label: "Tables", value: tables.length || "—" },
          { label: "Total rows", value: tablesQuery.isLoading ? "…" : totalRows.toLocaleString() },
          { label: "Engine", value: "PostgreSQL" },
          { label: "ORM", value: "Prisma" },
        ]}
      />

      {tablesQuery.isLoading ? (
        <Empty className="rounded-2xl border border-dashed border-border bg-muted/10 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Loader2 className="size-4 animate-spin text-primary" />
            </EmptyMedia>
            <EmptyTitle>Loading database tables</EmptyTitle>
            <EmptyDescription>
              Fetching table metadata and row counts. Ensure the API is running if this takes more than a few seconds.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : tablesQuery.isError ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-50 p-4 text-sm text-red-800">
          Could not load database tables. Make sure the API is running.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
      )}
    </div>
  )
}
