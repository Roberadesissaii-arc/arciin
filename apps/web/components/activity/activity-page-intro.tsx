"use client"

import Link from "next/link"
import { Activity } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
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
      subtitle="Instance timeline · files, uploads, and library actions"
      cornerDecoration={<IntroCornerIcon icon={Activity} />}
      description={
        <>
          Tracks what happens inside your libraries — uploads, moves, folders, shares, and settings. Sign-ins,
          devices, and IP policy live on{" "}
          <Link href="/security" className="font-medium text-foreground underline-offset-2 hover:underline">
            Security
          </Link>
          . Use the pager at the bottom of the log to move through older events.
        </>
      }
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
