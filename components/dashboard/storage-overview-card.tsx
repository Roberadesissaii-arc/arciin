"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { HardDrive } from "lucide-react"

import { getStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import type { StorageSettings } from "@/lib/types/models"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { dashboardStatIconShell } from "@/lib/dashboard-card-styles"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"

function resolveUsagePercent(storage: StorageSettings): number | null {
  let total = storage.totalBytes ?? null
  if (total == null && storage.availableBytes != null && storage.availableBytes >= 0) {
    const inferred = storage.usageBytes + storage.availableBytes
    if (inferred > 0) {
      total = inferred
    }
  }
  if (total != null && total > 0) {
    return Math.min(100, Math.round((storage.usageBytes / total) * 100))
  }
  return null
}

export function StorageOverviewCard() {
  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })

  const storage = storageQuery.data

  const usagePercent = useMemo(() => {
    if (!storage) {
      return null
    }
    return resolveUsagePercent(storage)
  }, [storage])

  if (storageQuery.isLoading) {
    return <Skeleton className="h-56 rounded-3xl" />
  }

  if (storageQuery.isError) {
    return (
      <Card className="border-red-500/20 bg-red-500/5">
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

  if (!storage) {
    return null
  }

  const capacityLabel = (() => {
    if (storage.totalBytes && storage.totalBytes > 0) {
      return (
        <>
          {formatBytes(storage.usageBytes)} / {formatBytes(storage.totalBytes)}
        </>
      )
    }
    if (storage.availableBytes != null && storage.availableBytes >= 0) {
      return (
        <>
          {formatBytes(storage.usageBytes)} used · {formatBytes(storage.availableBytes)} reported free
        </>
      )
    }
    return "Disk capacity not reported — usage is still tracked below."
  })()

  return (
    <Card className="relative overflow-hidden border-border bg-card shadow-none">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,75,51,0.12)_0%,rgba(244,244,245,0.75)_38%,transparent_58%)]" />
        <div className="absolute -top-28 left-1/2 aspect-[1.4] w-[min(100%,420px)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_50%_30%,rgba(255,75,51,0.42)_0%,rgba(255,75,51,0.1)_45%,transparent_70%)] blur-[56px]" />
        <div className="absolute -top-16 right-[8%] h-[200px] w-[min(45%,240px)] bg-[radial-gradient(ellipse_at_center,rgba(255,120,90,0.2)_0%,transparent_68%)] blur-[40px]" />
      </div>

      <CardHeader className="relative z-10 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={dashboardStatIconShell}>
              <HardDrive className="size-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-foreground">Storage usage</CardTitle>
              <CardDescription className="text-zinc-600">
                Managed local object storage for this instance.
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
      <CardContent className="relative z-10 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <div className="text-sm font-medium text-zinc-600">Used</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {formatBytes(storage.usageBytes)}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <div className="text-sm font-medium text-zinc-600">Objects</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {storage.objectCount}
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm font-medium text-zinc-600">
            <span>Storage root</span>
            <span className="max-w-[min(100%,28rem)] truncate font-mono text-xs text-zinc-800 sm:text-sm">
              {storage.storageRoot}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-zinc-600">
            <span className="font-semibold text-zinc-700">Capacity</span>
            <span className="text-right text-zinc-800">{capacityLabel}</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
              <span>Usage</span>
              {usagePercent != null ? (
                <span className="font-medium text-primary">{usagePercent}%</span>
              ) : (
                <span className="text-zinc-600">No disk total</span>
              )}
            </div>
            <Progress value={usagePercent} className="h-3" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
