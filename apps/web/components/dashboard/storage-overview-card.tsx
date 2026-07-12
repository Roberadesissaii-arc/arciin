"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, HardDrive } from "lucide-react"

import { getStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { storageProgressBarValue, storageUsageLabel } from "@/lib/utils/storage-progress"
import { resolveStorageUsagePercent } from "@/lib/utils/storage-usage"
import type { StorageSettings } from "@/lib/types/models"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { dashboardStatIconShell } from "@/lib/dashboard-card-styles"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function StorageOverviewCard({ className }: { className?: string }) {
  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })

  const storage = storageQuery.data

  const usagePercent = useMemo(() => {
    if (!storage) return null
    return resolveStorageUsagePercent(storage)
  }, [storage])

  const barValue = useMemo(() => storageProgressBarValue(usagePercent), [usagePercent])

  if (storageQuery.isLoading) {
    return <Skeleton className={cn("h-52 rounded-3xl", className)} />
  }

  if (storageQuery.isError) {
    return (
      <Card className={cn("border-red-500/20 bg-red-500/5", className)}>
        <CardHeader>
          <CardTitle className="text-red-900">Storage is unavailable</CardTitle>
          <CardDescription className="text-red-800">
            {storageQuery.error instanceof Error
              ? storageQuery.error.message
              : "Could not load storage status."}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!storage) return null

  const capacityLabel = formatCapacityLabel(storage)

  return (
    <Card
      className={cn(
        "border-border bg-card shadow-sm",
        className,
      )}
    >
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={dashboardStatIconShell}>
              <HardDrive className="size-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-foreground">Storage</CardTitle>
              <CardDescription className="text-zinc-600">
                Local object storage for this instance.
              </CardDescription>
            </div>
          </div>
          <Badge
            className={
              storage.writable
                ? "shrink-0 border-0 bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-none hover:bg-emerald-600"
                : "shrink-0 border-0 bg-red-600 px-2.5 text-xs font-semibold text-white shadow-none hover:bg-red-600"
            }
          >
            {storage.writable ? "Writable" : "Read only"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-zinc-50/80 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Used</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {formatBytes(storage.usageBytes)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-zinc-50/80 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Objects</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {storage.objectCount.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-600">
            <span>Usage</span>
            <span className="font-semibold text-primary">{storageUsageLabel(usagePercent)}</span>
          </div>
          <Progress value={barValue} className="h-2.5" />
          <p className="text-xs text-zinc-600">{capacityLabel}</p>
        </div>

        <Link
          href="/settings/storage"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80"
        >
          Storage settings
          <ChevronRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}

function formatCapacityLabel(storage: StorageSettings) {
  if (storage.totalBytes && storage.totalBytes > 0) {
    return `${formatBytes(storage.usageBytes)} of ${formatBytes(storage.totalBytes)} on disk`
  }
  if (storage.availableBytes != null && storage.availableBytes >= 0) {
    return `${formatBytes(storage.usageBytes)} used · ${formatBytes(storage.availableBytes)} free (reported)`
  }
  return "Disk total unavailable — usage is still tracked."
}
