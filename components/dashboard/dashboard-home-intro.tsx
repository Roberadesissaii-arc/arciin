"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, Upload } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { useLibraries } from "@/hooks/use-libraries"
import { useUploads } from "@/hooks/use-uploads"
import { useActivity } from "@/hooks/use-activity"
import { fetchApi } from "@/lib/api/client"
import { getGeneralSettings, getStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { resolveStorageUsagePercent } from "@/lib/utils/storage-usage"
import type { HealthStatus } from "@/lib/types/models"

const HEALTH_KEYS: Array<keyof Omit<HealthStatus, "version" | "timestamp">> = [
  "api",
  "database",
  "redis",
  "worker",
  "storage",
]

const ACTIVE_UPLOAD = new Set([
  "QUEUED",
  "UPLOADING",
  "UPLOADED",
  "ANALYZING",
  "CLASSIFIED",
  "PROCESSING",
])

export function DashboardHomeIntro() {
  const authQuery = useAuth()
  const librariesQuery = useLibraries()
  const uploadsQuery = useUploads()
  const activityQuery = useActivity()

  const generalQuery = useQuery({
    queryKey: queryKeys.generalSettings,
    queryFn: ({ signal }) => getGeneralSettings(signal),
  })

  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchApi<HealthStatus>("/health"),
    refetchInterval: 30_000,
  })

  const uploads = uploadsQuery.data ?? []
  const events = activityQuery.data ?? []

  const totalAssets = useMemo(
    () =>
      (librariesQuery.data ?? []).reduce((sum, lib) => sum + (lib.assetCount ?? 0), 0),
    [librariesQuery.data],
  )

  const activeUploads = uploads.filter((u) => ACTIVE_UPLOAD.has(u.status)).length

  const health = healthQuery.data
  const healthOnline = health
    ? HEALTH_KEYS.filter((k) => health[k] === "online").length
    : null

  const storage = storageQuery.data
  const usagePercent = storage ? resolveStorageUsagePercent(storage) : null

  const loading =
    librariesQuery.isLoading ||
    storageQuery.isLoading ||
    healthQuery.isLoading

  const userName = authQuery.data?.user.name?.split(" ")[0] ?? "there"
  const instanceName =
    generalQuery.data?.instanceName ??
    storage?.instanceName ??
    "Your instance"

  const healthLabel =
    healthOnline == null
      ? "…"
      : healthOnline === HEALTH_KEYS.length
        ? "All online"
        : `${healthOnline}/${HEALTH_KEYS.length} online`

  return (
    <DashboardPageIntro
      title="Overview"
      subtitle={`${instanceName} · welcome back, ${userName}`}
      description={
        <>
          Your private command center for files, libraries, and background work on this server.
          Drop files anywhere in the app—Arciin classifies them, stores metadata here, and keeps
          activity visible in real time.
        </>
      }
      badge={
        <span className="inline-flex items-center rounded-full border border-zinc-200/90 bg-white/80 px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm">
          {loading ? "Syncing…" : healthLabel}
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            size="sm"
            className="h-9 gap-1.5 rounded-xl bg-primary px-3.5 text-primary-foreground shadow-none hover:bg-primary/90"
          >
            <Link href="/files">
              <Upload className="size-3.5" />
              Browse files
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-9 gap-1 rounded-xl border-zinc-200 bg-white/80 text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            <Link href="/activity">
              Activity
              <ArrowUpRight className="size-3.5 opacity-60" />
            </Link>
          </Button>
        </div>
      }
      stats={[
        {
          label: "Total assets",
          value: librariesQuery.isLoading ? "…" : totalAssets.toLocaleString(),
        },
        {
          label: "Libraries",
          value: librariesQuery.isLoading
            ? "…"
            : (librariesQuery.data ?? []).length.toLocaleString(),
        },
        {
          label: "Storage used",
          value: storageQuery.isLoading
            ? "…"
            : storage
              ? usagePercent != null
                ? `${formatBytes(storage.usageBytes)} · ${usagePercent}%`
                : formatBytes(storage.usageBytes)
              : "—",
        },
        {
          label: "Active uploads",
          value: uploadsQuery.isLoading ? "…" : activeUploads.toLocaleString(),
        },
        {
          label: "Recent events",
          value: activityQuery.isLoading ? "…" : events.length.toLocaleString(),
        },
        {
          label: "Latest activity",
          value:
            activityQuery.isLoading
              ? "…"
              : events[0]?.createdAt
                ? formatRelativeDate(events[0].createdAt)
                : "—",
        },
      ]}
      statsGridClassName="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    />
  )
}
