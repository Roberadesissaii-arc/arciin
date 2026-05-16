"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, Database } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { listAppDatabases } from "@/lib/api/app-databases"
import { queryKeys } from "@/lib/api/query-keys"
import { dashboardStatIconShell } from "@/lib/dashboard-card-styles"

export function DatabaseHubCard() {
  const databasesQuery = useQuery({
    queryKey: queryKeys.appDatabases,
    queryFn: ({ signal }) => listAppDatabases(signal),
  })

  const count = databasesQuery.data?.length ?? 0
  const tableCount = databasesQuery.data?.reduce((sum, db) => sum + (db.folderCount ?? 0), 0) ?? 0

  if (databasesQuery.isLoading) {
    return <Skeleton className="h-36 rounded-2xl" />
  }

  return (
    <Card className="border-border bg-muted/30 shadow-none transition-colors hover:border-primary/30 hover:bg-muted/50">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-3">
          <div className={dashboardStatIconShell}>
            <Database className="size-4" />
          </div>
          <div>
            <CardTitle className="text-foreground">Database</CardTitle>
            <div className="mt-1 text-sm font-medium text-zinc-600">
              {count.toLocaleString()} {count === 1 ? "database" : "databases"}
            </div>
          </div>
        </div>
        <Badge className="shrink-0 rounded-md border-0 bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90">
          {tableCount.toLocaleString()} tables
        </Badge>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">
          App data stores — JSON records in Postgres, separate from file libraries.
        </p>
        <Link
          href="/database/app-data"
          className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Open
          <ArrowUpRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
