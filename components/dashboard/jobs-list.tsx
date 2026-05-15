"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BriefcaseBusiness,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AppPagination } from "@/components/ui/app-pagination"
import { clearJobs, getJobs } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatRelativeDate } from "@/lib/utils/format-date"
import type { JobSummary } from "@/lib/types/models"

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatJobType(type: string) {
  return type
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ")
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  QUEUED: {
    label: "Queued",
    icon: CircleDashed,
    style: "bg-orange-50/50 text-orange-500 border border-orange-200/60",
  },
  ACTIVE: {
    label: "Active",
    icon: Loader2,
    style: "bg-orange-100/80 text-orange-700 border border-orange-300/80",
    spin: true,
  },
  COMPLETED: {
    label: "Completed",
    icon: CheckCircle2,
    style: "bg-[rgba(255,79,18,0.10)] text-primary border border-[rgba(255,79,18,0.22)]",
  },
  FAILED: {
    label: "Failed",
    icon: XCircle,
    style: "bg-red-50/80 text-red-700 border border-red-200/80",
  },
} as const

function StatusBadge({ status }: { status: JobSummary["status"] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.QUEUED
  const Icon = cfg.icon
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cfg.style}`}
    >
      <Icon className={`size-3 shrink-0 ${"spin" in cfg && cfg.spin ? "animate-spin" : ""}`} />
      {cfg.label}
    </span>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, status }: { value: number; status: JobSummary["status"] }) {
  const pct = Math.min(100, Math.max(0, value))
  const barColor = status === "FAILED" ? "#EF4444" : status === "QUEUED" ? "#a1a1aa" : "#22C55E"

  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <span className="w-8 text-right text-[12px] tabular-nums text-zinc-500">{pct}%</span>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted/40">
        <BriefcaseBusiness className="size-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-[14px] font-medium text-foreground">No jobs yet</p>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Background tasks appear here when uploads or processing starts
        </p>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function JobsList() {
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs,
    queryFn: ({ signal }) => getJobs(signal),
    refetchInterval: 15_000,
  })

  const clearMutation = useMutation({
    mutationFn: clearJobs,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
      setPage(1)
      toast.success(
        result.cleared === 0
          ? "Nothing to clear."
          : `Cleared ${result.cleared} completed/failed job${result.cleared === 1 ? "" : "s"}.`,
      )
    },
    onError: () => toast.error("Could not clear jobs."),
  })

  if (jobsQuery.isLoading) {
    return <Skeleton className="h-72 rounded-2xl" />
  }

  if (jobsQuery.isError) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-800">
        {jobsQuery.error instanceof Error ? jobsQuery.error.message : "Could not load jobs."}
      </div>
    )
  }

  const jobs = jobsQuery.data ?? []
  const totalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageJobs = jobs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const hasFinished = jobs.some((j) => j.status === "COMPLETED" || j.status === "FAILED")

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-foreground">Job queue</CardTitle>
          <CardDescription className="text-zinc-500">
            {jobs.length === 0
              ? "No background tasks running"
              : `${jobs.length} job${jobs.length === 1 ? "" : "s"} · refreshes every 15 s`}
          </CardDescription>
        </div>
        <Button
          size="sm"
          className="shrink-0 gap-1.5 bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
          disabled={clearMutation.isPending || !hasFinished}
          onClick={() => clearMutation.mutate()}
        >
          <Trash2 className="size-3.5" />
          {clearMutation.isPending ? "Clearing…" : "Clear completed"}
        </Button>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {jobs.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-6 text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                    Job
                  </TableHead>
                  <TableHead className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                    Status
                  </TableHead>
                  <TableHead className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                    Progress
                  </TableHead>
                  <TableHead className="pr-6 text-right text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                    Updated
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageJobs.map((job) => (
                  <TableRow key={job.id} className="border-border transition-colors hover:bg-muted/30">
                    <TableCell className="pl-6">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-medium text-foreground">
                          {formatJobType(job.type)}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-400">{job.id.slice(0, 8)}…</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell>
                      <ProgressBar value={job.progress} status={job.status} />
                    </TableCell>
                    <TableCell className="pr-6 text-right text-[12px] text-zinc-500">
                      {formatRelativeDate(job.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="border-t border-border px-6 py-3">
                <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
