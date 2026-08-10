"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BriefcaseBusiness, Trash2 } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { AppPagination } from "@/components/ui/app-pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { clearJobs, getJobs } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import {
  formatJobTypeLabel,
  jobDetailsPreview,
  jobQueueStatus,
  jobSubjectLabel,
  jobTypeBadgeLabel,
} from "@/lib/jobs/job-queue-display"
import {
  dashboardTableBodyRow,
  dashboardTableHeadCell,
  dashboardTableHeadRow,
  dashboardTablePagination,
  dashboardTablePanel,
  dashboardTablePanelHeader,
} from "@/lib/dashboard-table-styles"
import { cn } from "@/lib/utils"
import type { JobSummary } from "@/lib/types/models"
import { RelativeTime } from "@/components/shared/relative-time"

const PAGE_SIZE = 10

const typeBadgeClass =
  "border-0 bg-primary text-[11px] font-bold uppercase tracking-wide text-primary-foreground shadow-none"

function JobStatusCell({ job }: { job: JobSummary }) {
  const status = jobQueueStatus(job)

  return (
    <span
      className={cn(
        "text-[13px] font-semibold",
        status.tone === "good" && "text-emerald-600",
        status.tone === "bad" && "text-red-600",
        status.tone === "warn" && "text-amber-600",
        status.tone === "muted" && "text-zinc-500",
      )}
    >
      {status.label}
    </span>
  )
}

function JobTableRow({ job }: { job: JobSummary }) {
  const details = jobDetailsPreview(job)
  const subject = jobSubjectLabel(job)

  return (
    <TableRow className={cn(dashboardTableBodyRow, "[&>td]:align-middle [&>td]:py-3.5")}>
      <TableCell className="whitespace-nowrap py-3.5 pl-5 text-[13px] tabular-nums text-zinc-500">
        <RelativeTime value={job.updatedAt} />
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5">
        <Badge className={cn("inline-flex h-7 min-w-[5rem] justify-center rounded-md px-2.5", typeBadgeClass)}>
          {jobTypeBadgeLabel(job.type)}
        </Badge>
      </TableCell>
      <TableCell className="max-w-0 py-3.5">
        <span
          className="block min-w-0 max-w-[14rem] truncate text-[13px] font-medium text-zinc-900 sm:max-w-[18rem] lg:max-w-[22rem]"
          title={formatJobTypeLabel(job.type)}
        >
          {formatJobTypeLabel(job.type)}
        </span>
      </TableCell>
      <TableCell className="max-w-0 py-3.5">
        <span
          className={cn(
            "block min-w-0 max-w-[12rem] truncate text-[13px] sm:max-w-[18rem] lg:max-w-[26rem]",
            job.status === "FAILED" && job.error ? "text-red-600" : "text-zinc-600",
          )}
          title={details ?? undefined}
        >
          {details ?? <span className="text-zinc-400">—</span>}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5">
        <JobStatusCell job={job} />
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5 pr-5 text-right font-mono text-[12px] text-zinc-600">
        {subject}
      </TableCell>
    </TableRow>
  )
}

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
        {
          description:
            result.cleared === 0
              ? "No completed or failed jobs in the queue."
              : "Active and queued jobs stay untouched.",
        },
      )
    },
    onError: () =>
      toast.error("Could not clear jobs", { description: "Try again in a moment." }),
  })

  if (jobsQuery.isLoading) {
    return (
      <div className={dashboardTablePanel}>
        <div className="space-y-0 px-5 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="my-3 h-12 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (jobsQuery.isError) {
    return (
      <p className="rounded-2xl border border-red-500/25 bg-red-50 px-5 py-10 text-center text-sm text-red-600">
        {jobsQuery.error instanceof Error ? jobsQuery.error.message : "Could not load jobs."}
      </p>
    )
  }

  const jobs = jobsQuery.data ?? []
  const totalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageJobs = jobs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const hasFinished = jobs.some((j) => j.status === "COMPLETED" || j.status === "FAILED")

  return (
    <div className={dashboardTablePanel}>
      <div className={dashboardTablePanelHeader}>
        <BriefcaseBusiness className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Job queue</span>
        <div className="ml-auto flex items-center gap-2">
          {jobs.length > 0 ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {jobs.length} most recent
              {totalPages > 1 ? ` · page ${safePage} of ${totalPages}` : ""}
              {" · refreshes every 15 s"}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-border bg-card text-xs font-semibold text-foreground"
            disabled={clearMutation.isPending || !hasFinished}
            onClick={() => clearMutation.mutate()}
          >
            <Trash2 className="size-3.5" />
            {clearMutation.isPending ? "Clearing…" : "Clear completed"}
          </Button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <Empty className="rounded-none border-0 py-12">
          <EmptyMedia variant="icon">
            <BriefcaseBusiness />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No jobs yet</EmptyTitle>
            <EmptyDescription>
              Background tasks appear here when uploads, link imports, or media processing starts.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table className="w-full min-w-0 table-fixed">
            <colgroup>
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <TableHeader>
              <TableRow className={dashboardTableHeadRow}>
                <TableHead className={cn(dashboardTableHeadCell, "pl-5")}>Time</TableHead>
                <TableHead className={dashboardTableHeadCell}>Type</TableHead>
                <TableHead className={dashboardTableHeadCell}>Task</TableHead>
                <TableHead className={dashboardTableHeadCell}>Details</TableHead>
                <TableHead className={dashboardTableHeadCell}>Status</TableHead>
                <TableHead className={cn(dashboardTableHeadCell, "pr-5 text-right")}>Job ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageJobs.map((job) => (
                <JobTableRow key={job.id} job={job} />
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className={dashboardTablePagination}>
              <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
