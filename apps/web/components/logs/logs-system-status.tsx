"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ChevronRight,
  Database,
  HardDrive,
  Radio,
  Server,
  Workflow,
  Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getLogsOverview } from "@/lib/api/logs"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"
import type { HealthStatus } from "@/lib/types/models"
import { RelativeTime } from "@/components/shared/relative-time"

type ServiceId = keyof Omit<HealthStatus, "version" | "timestamp" | "status">

const SERVICE_META: Record<
  ServiceId,
  { label: string; icon: LucideIcon; onlineHint: string; offlineHint: string; unknownHint?: string }
> = {
  api: {
    label: "API server",
    icon: Server,
    onlineHint: "Fastify is accepting requests on this instance.",
    offlineHint: "The API process is not responding. Restart with pnpm dev:api.",
  },
  database: {
    label: "PostgreSQL",
    icon: Database,
    onlineHint: "Prisma can query the instance database.",
    offlineHint: "Database connection failed. Check DATABASE_URL and that Postgres is running.",
  },
  redis: {
    label: "Redis",
    icon: Radio,
    onlineHint: "Queues and realtime pub/sub are reachable.",
    offlineHint: "Redis is unreachable. Start Redis and verify REDIS_URL.",
  },
  realtime: {
    label: "Realtime",
    icon: Zap,
    onlineHint: "Live upload progress and activity events can reach the browser.",
    offlineHint: "Redis pub/sub is down — realtime updates will not appear until Redis is back.",
  },
  worker: {
    label: "Background worker",
    icon: Workflow,
    onlineHint: "BullMQ worker heartbeat is fresh (within 60s).",
    offlineHint: "Worker heartbeat is stale or missing. Run pnpm dev:worker.",
    unknownHint: "No worker heartbeat yet. Start the worker process for uploads and media jobs.",
  },
  storage: {
    label: "Filesystem storage",
    icon: HardDrive,
    onlineHint: "Data directory is present and writable.",
    offlineHint: "Cannot write to the storage root. Check ARCIIN_DATA_DIR permissions.",
  },
}

const ORDER: ServiceId[] = ["api", "database", "redis", "realtime", "worker", "storage"]

function statusTone(status: string) {
  if (status === "online") return "good"
  if (status === "unknown") return "muted"
  return "bad"
}

export function LogsSystemStatus() {
  const overviewQuery = useQuery({
    queryKey: queryKeys.logsOverview,
    queryFn: ({ signal }) => getLogsOverview(signal),
    refetchInterval: 15_000,
  })

  if (overviewQuery.isLoading) {
    return <Skeleton className="h-80 rounded-xl" />
  }

  if (overviewQuery.isError) {
    return (
      <Card className="border-red-500/25 bg-red-500/5">
        <CardHeader>
          <CardTitle className="text-red-900">Could not load system status</CardTitle>
          <CardDescription className="text-red-800">
            {overviewQuery.error instanceof Error
              ? overviewQuery.error.message
              : "The logs API is unavailable."}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const overview = overviewQuery.data
  if (!overview) return null

  const { health } = overview
  const onlineCount = ORDER.filter((id) => health[id] === "online").length
  const allOnline = onlineCount === ORDER.length

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-zinc-50 text-primary">
              <Activity className="size-5" />
            </div>
            <div>
              <CardTitle className="text-foreground">System status</CardTitle>
              <CardDescription className="text-zinc-600">
                {allOnline
                  ? "All core services are healthy."
                  : `${onlineCount} of ${ORDER.length} services online — see details below.`}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 text-right text-xs text-zinc-500">
            <span>
              v{health.version} · {overview.environment}
            </span>
            <span>Checked <RelativeTime value={health.timestamp} /></span>
            {health.workerLastSeenAt ? (
              <span>Worker seen <RelativeTime value={health.workerLastSeenAt} /></span>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map((id) => {
          const meta = SERVICE_META[id]
          const status = health[id]
          const tone = statusTone(status)
          const Icon = meta.icon
          const hint =
            status === "online"
              ? meta.onlineHint
              : status === "unknown" && meta.unknownHint
                ? meta.unknownHint
                : meta.offlineHint

          return (
            <div
              key={id}
              className={cn(
                "rounded-xl border border-border bg-zinc-50/80 px-3 py-3",
                tone === "bad" && "border-red-500/30",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-zinc-600" />
                  <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                </div>
                <span className="flex items-center gap-1.5 text-xs font-medium capitalize text-zinc-700">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      tone === "good" && "bg-emerald-500",
                      tone === "bad" && "bg-red-500",
                      tone === "muted" && "bg-zinc-400",
                    )}
                  />
                  {status}
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-zinc-600">{hint}</p>
            </div>
          )
        })}
        <div className="lg:col-span-3 flex flex-wrap gap-3 border-t border-border pt-3 text-sm">
          <Link href="/jobs" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Background jobs
            <ChevronRight className="size-4" />
          </Link>
          <Link href="/database" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Database browser
            <ChevronRight className="size-4" />
          </Link>
          <span className="text-zinc-500">
            Logs path: <span className="font-mono text-zinc-700">{overview.logs.displayPath}</span>
            {overview.logs.writable ? "" : " (read-only)"}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
