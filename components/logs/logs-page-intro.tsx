"use client"

import { useQuery } from "@tanstack/react-query"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { getLogsOverview } from "@/lib/api/logs"
import { queryKeys } from "@/lib/api/query-keys"
import type { HealthStatus } from "@/lib/types/models"

const HEALTH_KEYS: Array<keyof Omit<HealthStatus, "version" | "timestamp">> = [
  "api",
  "database",
  "redis",
  "realtime",
  "worker",
  "storage",
]

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function LogsPageIntro() {
  const overviewQuery = useQuery({
    queryKey: queryKeys.logsOverview,
    queryFn: ({ signal }) => getLogsOverview(signal),
    refetchInterval: 15_000,
  })

  const overview = overviewQuery.data
  const health = overview?.health
  const online =
    health == null
      ? null
      : HEALTH_KEYS.filter((k) => health[k] === "online").length

  return (
    <DashboardPageIntro
      title="Logs"
      subtitle="System health · log files · worker errors"
      description="Live status for API, database, Redis, worker, and storage. Read recent API log output from disk and inspect failed background jobs."
      stats={[
        {
          label: "Services online",
          value:
            overviewQuery.isLoading || online == null
              ? "…"
              : `${online}/${HEALTH_KEYS.length}`,
        },
        {
          label: "Log files",
          value: overviewQuery.isLoading
            ? "…"
            : overview?.logs.readable
              ? String(overview.logs.fileCount)
              : "—",
        },
        {
          label: "Log disk usage",
          value: overviewQuery.isLoading
            ? "…"
            : overview?.logs.readable
              ? formatBytes(overview.logs.totalBytes)
              : "—",
        },
        {
          label: "Failed jobs",
          value: overviewQuery.isLoading
            ? "…"
            : (overview?.jobs.failed ?? 0).toLocaleString(),
        },
      ]}
    />
  )
}
