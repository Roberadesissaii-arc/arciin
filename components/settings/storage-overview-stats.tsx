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
      <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3.5 shadow-sm ring-1 ring-black/[0.03] backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <HardDrive className="size-3.5 text-primary" />
          Disk used
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900">
          {formatBytes(data?.usageBytes ?? 0)}
        </p>
        <p className="mt-1 text-xs text-zinc-600">Tracked under the storage root</p>
      </div>
      <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3.5 shadow-sm ring-1 ring-black/[0.03] backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <Database className="size-3.5 text-primary" />
          Objects
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900">
          {(data?.objectCount ?? 0).toLocaleString()}
        </p>
        <p className="mt-1 text-xs text-zinc-600">Rows in storage_objects</p>
      </div>
      <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3.5 shadow-sm ring-1 ring-black/[0.03] backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <Gauge className="size-3.5 text-primary" />
          Free space
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900">
          {data?.availableBytes != null ? formatBytes(data.availableBytes) : "—"}
        </p>
        <p className="mt-1 text-xs text-zinc-600">From host filesystem (statfs)</p>
      </div>
      <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3.5 shadow-sm ring-1 ring-black/[0.03] backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <Lock className="size-3.5 text-primary" />
          Writable
        </div>
        <p className="mt-2 text-2xl font-semibold text-zinc-900">{data?.writable ? "Yes" : "No"}</p>
        <p className="mt-1 text-xs text-zinc-600">Arciin can create files under root</p>
      </div>
    </div>
  )
}
