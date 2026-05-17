"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ChevronRight } from "lucide-react"

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
import { getLogsOverview } from "@/lib/api/logs"
import { queryKeys } from "@/lib/api/query-keys"
import { formatRelativeDate } from "@/lib/utils/format-date"

function formatJobType(type: string) {
  return type
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ")
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
    <Card className="border-border bg-card shadow-sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-zinc-50 text-amber-600">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <CardTitle className="text-foreground">Worker errors</CardTitle>
              <CardDescription className="text-zinc-600">
                Recent failed background jobs — full history on the Jobs page.
              </CardDescription>
            </div>
          </div>
          {jobs ? (
            <div className="text-right text-xs text-zinc-500">
              <p>
                {jobs.active} active · {jobs.queued} queued
              </p>
              <p>
                {jobs.failed} failed · {jobs.completed} completed
              </p>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {overviewQuery.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : recent.length === 0 ? (
          <p className="rounded-xl border border-border bg-zinc-50/80 px-4 py-6 text-center text-sm text-zinc-600">
            No failed jobs in the recent window. When a worker task fails, it appears here with the
            error message.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Type</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium text-foreground">
                      {formatJobType(job.type)}
                    </TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs text-red-800">
                      {job.error ?? "No error message recorded"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-zinc-500">
                      {formatRelativeDate(job.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Link
          href="/jobs"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View all jobs
          <ChevronRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
