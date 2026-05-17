"use client"

import { useQuery } from "@tanstack/react-query"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
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
          "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold",
          d.writable
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-800"
            : "border-red-500/25 bg-red-500/10 text-red-800"
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            d.writable
              ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(34,197,94,0.25)]"
              : "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.2)]"
          )}
        />
        {d.writable ? "Writable" : "Read-only / error"}
      </div>
    ) : null

  return (
    <DashboardPageIntro
      title="Storage"
      subtitle="Managed root · usage · object inventory"
      description="Arciin keeps originals and derived files under a single configurable root on this machine. Review usage here, then adjust the path only when you know the filesystem layout."
      badge={badge}
      footer={
        <StorageOverviewStats data={d} isLoading={storageQuery.isLoading} />
      }
    />
  )
}
