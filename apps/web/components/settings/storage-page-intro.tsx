"use client"

import { useQuery } from "@tanstack/react-query"
import { HardDrive } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { StorageOverviewStats } from "@/components/settings/storage-overview-stats"
import { getStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"

export function StoragePageIntro() {
  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })
  const d = storageQuery.data

  const badge =
    d != null ? (
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold",
          d.writable ? "text-foreground" : "text-destructive",
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            d.writable ? "bg-primary" : "bg-destructive",
          )}
        />
        {d.writable ? "Writable" : "Read-only / error"}
      </div>
    ) : null

  return (
    <DashboardPageIntro
      title="Storage"
      subtitle="Managed root · usage · object inventory"
      cornerDecoration={<IntroCornerIcon icon={HardDrive} />}
      description="Disk usage, active root, and one-click transfer when you add a larger drive."
      badge={badge}
      footer={
        <StorageOverviewStats data={d} isLoading={storageQuery.isLoading} />
      }
    />
  )
}
