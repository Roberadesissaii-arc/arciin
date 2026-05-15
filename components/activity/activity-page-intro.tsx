"use client"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { useActivity } from "@/hooks/use-activity"
import { formatRelativeDate } from "@/lib/utils/format-date"

export function ActivityPageIntro() {
  const activityQuery = useActivity()
  const events = activityQuery.data ?? []
  const total = events.length
  const assetEvents = events.filter((e) => e.entityType === "asset").length
  const folderEvents = events.filter((e) => e.entityType === "folder").length
  const last = events[0]?.createdAt

  return (
    <DashboardPageIntro
      title="Activity"
      subtitle="Instance timeline · uploads, folders, and system events"
      description="Every action across your instance shows in the feed below. Counts refresh with the same data as the list—use them as a quick read on volume before you scroll."
      stats={[
        {
          label: "Total events",
          value: activityQuery.isLoading ? "…" : total.toLocaleString(),
        },
        {
          label: "Asset events",
          value: activityQuery.isLoading ? "…" : assetEvents.toLocaleString(),
        },
        {
          label: "Folder events",
          value: activityQuery.isLoading ? "…" : folderEvents.toLocaleString(),
        },
        {
          label: "Latest",
          value:
            activityQuery.isLoading ? "…" : last ? formatRelativeDate(last) : "—",
        },
      ]}
    />
  )
}
