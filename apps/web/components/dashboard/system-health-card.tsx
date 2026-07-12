"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ActivitySquare, ChevronRight } from "lucide-react"

import { fetchApi } from "@/lib/api/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { dashboardStatIconShell } from "@/lib/dashboard-card-styles"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { HealthStatus } from "@/lib/types/models"

const healthLabels: Array<keyof Omit<HealthStatus, "version" | "timestamp">> = [
  "api",
  "database",
  "redis",
  "worker",
  "storage",
]

export function SystemHealthCard({ className }: { className?: string }) {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchApi<HealthStatus>("/health"),
    refetchInterval: 30_000,
  })

  if (healthQuery.isLoading) {
    return <Skeleton className={cn("h-52 rounded-3xl", className)} />
  }

  if (healthQuery.isError) {
    return (
      <Card className={cn("border-red-500/20 bg-red-500/5", className)}>
        <CardHeader>
          <CardTitle className="text-red-900">Health checks unavailable</CardTitle>
          <CardDescription className="text-red-800">
            {healthQuery.error instanceof Error
              ? healthQuery.error.message
              : "Could not load system health."}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const health = healthQuery.data
  if (!health) return null

  const onlineCount = healthLabels.filter((l) => health[l] === "online").length

  return (
    <Card className={cn("border-border bg-card shadow-sm", className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={dashboardStatIconShell}>
              <ActivitySquare className="size-5" />
            </div>
            <div>
              <CardTitle className="text-foreground">System health</CardTitle>
              <CardDescription className="text-zinc-600">
                {onlineCount === healthLabels.length
                  ? "All services responding."
                  : `${onlineCount} of ${healthLabels.length} services online.`}
              </CardDescription>
            </div>
          </div>
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-zinc-700">
            {onlineCount}/{healthLabels.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2">
          {healthLabels.map((label) => {
            const value = health[label]
            const good = value === "online"
            const unknown = !value || value === "unknown"

            return (
              <div
                key={label}
                className="flex items-center justify-between rounded-xl border border-border bg-zinc-50/80 px-3 py-2.5"
              >
                <span className="text-sm font-medium capitalize text-zinc-800">{label}</span>
                <span className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      good ? "bg-emerald-500" : unknown ? "bg-zinc-400" : "bg-red-500",
                    )}
                  />
                  {value}
                </span>
              </div>
            )
          })}
        </div>
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80"
        >
          Background jobs
          <ChevronRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
