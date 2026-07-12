"use client"

import { useQuery } from "@tanstack/react-query"
import { Boxes } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { getLogsOverview } from "@/lib/api/logs"
import { queryKeys } from "@/lib/api/query-keys"

export function JobsPageIntro() {
  // The job list below only ever shows the 50 most recent rows — pull true
  // lifetime counts from /logs/overview (unbounded DB counts) instead of
  // deriving stats from that capped array, which under-reports once an
  // instance has run more than 50 jobs.
  const overviewQuery = useQuery({
    queryKey: queryKeys.logsOverview,
    queryFn: ({ signal }) => getLogsOverview(signal),
    refetchInterval: 15_000,
  })
  const jobs = overviewQuery.data?.jobs
  const running = (jobs?.queued ?? 0) + (jobs?.active ?? 0)
  const completed = jobs?.completed ?? 0
  const failed = jobs?.failed ?? 0
  const total = running + completed + failed

  return (
    <DashboardPageIntro
      title="Jobs"
      subtitle="BullMQ workers · uploads · media processing"
      cornerDecoration={<IntroCornerIcon icon={Boxes} />}
      description="Background tasks run outside the API so uploads and analysis stay responsive. Each row shows the task type, status, and context such as the source URL or error message."
      stats={[
        {
          label: "Total jobs",
          value: overviewQuery.isLoading ? "…" : total.toLocaleString(),
        },
        {
          label: "Running",
          value: overviewQuery.isLoading ? "…" : running.toLocaleString(),
        },
        {
          label: "Completed",
          value: overviewQuery.isLoading ? "…" : completed.toLocaleString(),
        },
        {
          label: "Failed",
          value: overviewQuery.isLoading ? "…" : failed.toLocaleString(),
        },
      ]}
    />
  )
}
