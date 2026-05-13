"use client"

import { useQuery } from "@tanstack/react-query"

import { getJobs } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatRelativeDate } from "@/lib/utils/format-date"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

export function JobsList() {
  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs,
    queryFn: ({ signal }) => getJobs(signal),
    refetchInterval: 15_000,
  })

  if (jobsQuery.isLoading) {
    return <Skeleton className="h-72 rounded-3xl" />
  }

  if (jobsQuery.isError) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">
        {jobsQuery.error instanceof Error ? jobsQuery.error.message : "Could not load jobs."}
      </div>
    )
  }

  const jobs = jobsQuery.data ?? []

  return (
    <div className="rounded-3xl border border-white/8 bg-white/[0.02] p-3">
      <Table>
        <TableHeader>
          <TableRow className="border-white/8 hover:bg-transparent">
            <TableHead className="text-zinc-400">Type</TableHead>
            <TableHead className="text-zinc-400">Status</TableHead>
            <TableHead className="text-zinc-400">Progress</TableHead>
            <TableHead className="text-zinc-400">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id} className="border-white/8 hover:bg-white/[0.02]">
              <TableCell className="font-medium text-white">{job.type}</TableCell>
              <TableCell>
                <Badge variant="outline" className="border-white/8 text-zinc-400">
                  {job.status}
                </Badge>
              </TableCell>
              <TableCell className="text-zinc-400">{job.progress}%</TableCell>
              <TableCell className="text-zinc-400">{formatRelativeDate(job.updatedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
