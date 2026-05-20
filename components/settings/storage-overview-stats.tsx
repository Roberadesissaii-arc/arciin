"use client"

import { Database, Gauge, HardDrive, Lock } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import type { StorageSettings } from "@/lib/types/models"
import { formatBytes } from "@/lib/utils/format-bytes"

export function StorageOverviewStats({
  data,
  isLoading,
}: {
  data?: StorageSettings
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-border bg-card/80 px-4 py-3.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <HardDrive className="size-3.5 text-primary" />
          Disk used
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
          {formatBytes(data?.usageBytes ?? 0)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Tracked under the storage root</p>
      </div>
      <div className="rounded-2xl border border-border bg-card/80 px-4 py-3.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <Database className="size-3.5 text-primary" />
          Objects
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
          {(data?.objectCount ?? 0).toLocaleString()}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Rows in storage_objects</p>
      </div>
      <div className="rounded-2xl border border-border bg-card/80 px-4 py-3.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <Gauge className="size-3.5 text-primary" />
          Free space
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
          {data?.availableBytes != null ? formatBytes(data.availableBytes) : "—"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">From host filesystem (statfs)</p>
      </div>
      <div className="rounded-2xl border border-border bg-card/80 px-4 py-3.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <Lock className="size-3.5 text-primary" />
          Writable
        </div>
        <p className="mt-2 text-2xl font-semibold text-foreground">{data?.writable ? "Yes" : "No"}</p>
        <p className="mt-1 text-xs text-muted-foreground">Arciin can create files under root</p>
      </div>
    </div>
  )
}
