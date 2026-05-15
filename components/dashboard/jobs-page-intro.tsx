"use client"

import { useQuery } from "@tanstack/react-query"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { getJobs } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

const ACTIVE = new Set(["QUEUED", "ACTIVE"])

export function JobsPageIntro() {
  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs,
    queryFn: ({ signal }) => getJobs(signal),
    refetchInterval: 15_000,
  })
  const jobs = jobsQuery.data ?? []
  const running = jobs.filter((j) => ACTIVE.has(j.status)).length
  const completed = jobs.filter((j) => j.status === "COMPLETED").length
  const failed = jobs.filter((j) => j.status === "FAILED").length

  return (
    <DashboardPageIntro
      title="Jobs"
      subtitle="BullMQ workers · uploads · media processing"
      description="Background tasks run outside the API so uploads and analysis stay responsive. Status and progress update on this page; failed jobs can be inspected in detail later from the same list."
      stats={[
        {
          label: "Total jobs",
          value: jobsQuery.isLoading ? "…" : jobs.length.toLocaleString(),
        },
        {
          label: "Running",
          value: jobsQuery.isLoading ? "…" : running.toLocaleString(),
        },
        {
          label: "Completed",
          value: jobsQuery.isLoading ? "…" : completed.toLocaleString(),
        },
        {
          label: "Failed",
          value: jobsQuery.isLoading ? "…" : failed.toLocaleString(),
        },
      ]}
    />
  )
}
