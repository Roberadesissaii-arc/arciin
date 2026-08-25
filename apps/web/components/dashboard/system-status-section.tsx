"use client"

import Link from "next/link"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, Database } from "lucide-react"

import { fetchApi } from "@/lib/api/client"
import { listAppDatabases } from "@/lib/api/app-databases"
import { getJobs, getStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { useLibraries } from "@/hooks/use-libraries"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"
import type { HealthStatus } from "@/lib/types/models"

const SERVICES: Array<keyof Omit<HealthStatus, "version" | "timestamp">> = [
  "api",
  "database",
  "redis",
  "worker",
  "storage",
]

const SERVICE_LABELS: Record<string, string> = {
  api: "API",
  database: "Database",
  redis: "Redis",
  worker: "Worker",
  storage: "Storage",
}

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  api: "Handles every request from the app and mobile.",
  database: "PostgreSQL keeps your metadata and records.",
  redis: "Cache and queues for realtime and jobs.",
  worker: "Processes uploads and background jobs.",
  storage: "Your files on this server's disks.",
}

/** System services strip — same card shell as storage, uploads, and activity. */
export function SystemStatusSection({ className }: { className?: string }) {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchApi<HealthStatus>("/health"),
    refetchInterval: 30_000,
  })

  const databasesQuery = useQuery({
    queryKey: queryKeys.appDatabases,
    queryFn: ({ signal }) => listAppDatabases(signal),
  })

  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs,
    queryFn: ({ signal }) => getJobs(signal),
  })

  const librariesQuery = useLibraries()

  const health = healthQuery.data
  const onlineCount = health
    ? SERVICES.filter((s) => health[s] === "online").length
    : null

  const totalAssets = useMemo(
    () => (librariesQuery.data ?? []).reduce((sum, lib) => sum + (lib.assetCount ?? 0), 0),
    [librariesQuery.data],
  )

  const jobs = jobsQuery.data ?? []
  const activeJobs = jobs.filter(
    (job) => job.status === "ACTIVE" || job.status === "QUEUED",
  ).length

  const storage = storageQuery.data

  const dbCount = databasesQuery.data?.length ?? 0
  const tableCount =
    databasesQuery.data?.reduce((sum, db) => sum + (db.folderCount ?? 0), 0) ?? 0

  const metrics: Record<string, string> = {
    api: health?.version ? `Version ${health.version}` : "Version —",
    database: librariesQuery.isLoading
      ? "…"
      : `${totalAssets.toLocaleString()} assets indexed`,
    redis: health
      ? `Realtime ${health.realtime === "online" ? "connected" : health.realtime}`
      : "…",
    worker: jobsQuery.isLoading
      ? "…"
      : activeJobs > 0
        ? `${activeJobs} active · ${jobs.length} tracked`
        : `${jobs.length} jobs tracked`,
    storage: storage
      ? `${formatBytes(storage.usageBytes)} · ${storage.objectCount.toLocaleString()} objects`
      : "…",
  }

  const description =
    onlineCount == null
      ? "Checking services…"
      : onlineCount === SERVICES.length
        ? "All services responding on this host."
        : `${onlineCount} of ${SERVICES.length} services online.`

  return (
    <Card
      className={cn(
        "overflow-hidden border-zinc-200/80 bg-card shadow-sm",
        className,
      )}
    >
      {/* No title here. The section heading above the card already says
          "System", and printing it twice made the page read as two nested
          things rather than one. What is left is the line that actually tells
          you something — whether the services are up. */}
      <CardHeader className="space-y-1 border-b border-zinc-100/80 pb-4">
        <CardDescription className="border-l-2 border-primary pl-3 text-sm text-zinc-600">
          {description}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-4 py-4 sm:px-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {SERVICES.map((service) => {
            if (healthQuery.isLoading) {
              return <Skeleton key={service} className="h-[11.5rem] rounded-2xl" />
            }

            const value = health?.[service]
            const good = value === "online"
            const unknown = !value || value === "unknown"

            return (
              <div
                key={service}
                className="flex min-h-[11.5rem] flex-col rounded-2xl border border-zinc-200/80 bg-card px-4 py-5 shadow-sm"
              >
                <p className="flex items-center justify-between text-[13px] font-semibold text-zinc-800">
                  {SERVICE_LABELS[service] ?? service}
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      good
                        ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
                        : unknown
                          ? "bg-zinc-400"
                          : "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]",
                    )}
                  />
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                  {SERVICE_DESCRIPTIONS[service]}
                </p>
                <p className="mt-auto pt-2 text-xs font-semibold tabular-nums text-zinc-700">
                  {metrics[service]}
                </p>
                <p
                  className={cn(
                    "mt-1 text-xs font-semibold capitalize",
                    good ? "text-emerald-600" : unknown ? "text-zinc-500" : "text-red-600",
                  )}
                >
                  {healthQuery.isError ? "Unreachable" : (value ?? "unknown")}
                </p>
              </div>
            )
          })}

          {databasesQuery.isLoading ? (
            <Skeleton className="h-[11.5rem] rounded-2xl" />
          ) : (
            <Link
              href="/database/app-data"
              className="group flex min-h-[11.5rem] flex-col rounded-2xl border border-zinc-200/80 bg-card px-4 py-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-[#fff8f5]"
            >
              <p className="flex items-center justify-between text-[13px] font-semibold text-zinc-800">
                <span className="flex items-center gap-1.5">
                  <Database className="size-3.5 text-primary" />
                  App data
                </span>
                <ArrowUpRight className="size-3.5 text-zinc-400 transition-colors group-hover:text-primary" />
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                JSON records in Postgres, separate from file libraries.
              </p>
              <p className="mt-auto pt-2 text-xs font-semibold tabular-nums text-zinc-700">
                {databasesQuery.isError
                  ? "Included with Pro"
                  : `${dbCount.toLocaleString()} ${dbCount === 1 ? "database" : "databases"} · ${tableCount.toLocaleString()} tables`}
              </p>
              <p className="mt-1 text-xs font-semibold text-primary">Open</p>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
