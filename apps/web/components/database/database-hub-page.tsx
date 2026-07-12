"use client"

import { useQuery } from "@tanstack/react-query"
import { Database, Loader2 } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { DatabaseHubGrid } from "@/components/database/database-hub-grid"
import { useLicense } from "@/lib/license/use-license"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { getAdminTables } from "@/lib/api/admin"
import { queryKeys } from "@/lib/api/query-keys"

export function DatabaseHubPage() {
  const license = useLicense()
  const canAppData = license.hasFeature("developer.app_databases")
  const appDataPlan = license.requiredPlanFor("developer.app_databases") ?? "pro"

  const tablesQuery = useQuery({
    queryKey: queryKeys.adminTables,
    queryFn: ({ signal }) => getAdminTables(signal),
  })

  const tables = tablesQuery.data ?? []
  const totalRows = tables.reduce((s, t) => s + t.count, 0)

  return (
    <div className="space-y-5 pb-6">
      <DashboardPageIntro
        title="Database"
        subtitle="PostgreSQL · Prisma ORM · live record counts"
        cornerDecoration={<IntroCornerIcon icon={Database} />}
        description="Browse every table in the Arciin schema. Open a table to inspect rows and verify data. Reads are admin-only and never expose secrets or password hashes. For automation-facing logical databases (JSON + folders), use App data databases — separate from library file storage."
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
        <DatabaseHubGrid
          tables={tables}
          canAppData={canAppData}
          appDataPlanLabel={license.planLabel(appDataPlan)}
        />
      )}
    </div>
  )
}
