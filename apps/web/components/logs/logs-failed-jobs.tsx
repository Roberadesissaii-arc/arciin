"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ChevronRight } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getLogsOverview } from "@/lib/api/logs"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"
import { formatRelativeDate } from "@/lib/utils/format-date"

function formatJobType(type: string) {
  return type
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ")
}

function JobStat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "muted" }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-zinc-50/80 px-3 py-2 text-center",
        tone === "bad" && value > 0 && "border-red-500/30",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums text-foreground",
          tone === "bad" && value > 0 && "text-red-700",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  )
}

export function LogsFailedJobs() {
  const overviewQuery = useQuery({
    queryKey: queryKeys.logsOverview,
    queryFn: ({ signal }) => getLogsOverview(signal),
    refetchInterval: 15_000,
  })

  const jobs = overviewQuery.data?.jobs
  const recent = jobs?.recentFailed ?? []

  return (
    <Card className="flex h-full flex-col border-border bg-card shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-zinc-50 text-zinc-700">
              <AlertTriangle className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-foreground">Worker errors</CardTitle>
              <CardDescription className="text-zinc-600">
                Recent failed background jobs. Open Jobs for the full queue and retries.
              </CardDescription>
            </div>
          </div>

          {jobs ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <JobStat label="Active" value={jobs.active} />
              <JobStat label="Queued" value={jobs.queued} />
              <JobStat label="Failed" value={jobs.failed} tone="bad" />
              <JobStat label="Done" value={jobs.completed} tone="muted" />
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 pt-0">
        {overviewQuery.isLoading ? (
          <Skeleton className="min-h-[12rem] flex-1 rounded-xl" />
        ) : recent.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-zinc-50/50 px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No recent failures</p>
            <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-zinc-600">
              When a worker task fails, the error message appears here with the job type and time.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {recent.map((job) => (
              <li
                key={job.id}
                className="rounded-xl border border-border bg-zinc-50/80 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {formatJobType(job.type)}
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-500">
                    {formatRelativeDate(job.createdAt)}
                  </span>
                </div>
                <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-zinc-700">
                  {job.error ?? "No error message recorded"}
                </p>
              </li>
            ))}
          </ul>
        )}

        <Link
          href="/jobs"
          className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View all jobs
          <ChevronRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
