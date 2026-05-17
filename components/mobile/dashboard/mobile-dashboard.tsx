"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ArrowRight,
  Boxes,
  ChevronRight,
  Files,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
} from "lucide-react"

import { queryKeys } from "@/lib/api/query-keys"
import { getStorageSettings } from "@/lib/api/settings"
import { getLibraries } from "@/lib/api/libraries"
import { getActivity } from "@/lib/api/activity"
import { formatBytes } from "@/lib/utils/format-bytes"
import { storageProgressBarValue } from "@/lib/utils/storage-progress"
import { cn } from "@/lib/utils"
import { fetchApi } from "@/lib/api/client"
import type { HealthStatus } from "@/lib/types/models"

// ── Storage strip ─────────────────────────────────────────────────────────────

function MobileStorageStrip() {
  const { data: storage, isLoading } = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })

  const usagePercent = useMemo(() => {
    if (!storage) return null
    const total =
      storage.totalBytes ??
      (storage.availableBytes != null
        ? storage.usageBytes + storage.availableBytes
        : null)
    if (total && total > 0) return Math.min(100, Math.round((storage.usageBytes / total) * 100))
    return null
  }, [storage])

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="size-4 text-[var(--arciin-accent)]" />
          <span className="text-[13px] font-semibold text-white">Storage</span>
        </div>
        <Link
          href="/settings/storage"
          className="flex items-center gap-1 text-[11px]"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          Manage <ChevronRight className="size-3" />
        </Link>
      </div>

      {isLoading ? (
        <div
          className="h-2 w-full animate-pulse rounded-full"
          style={{ background: "rgba(255,255,255,0.08)" }}
        />
      ) : (
        <>
          <div
            className="mb-2 h-2 w-full overflow-hidden rounded-full"
            style={{ background: "rgba(255,255,255,0.07)" }}
          >
            {usagePercent != null && (
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${storageProgressBarValue(usagePercent)}%`,
                  background:
                    usagePercent > 85
                      ? "linear-gradient(90deg, #ef4444, #f97316)"
                      : "linear-gradient(90deg, var(--arciin-accent), var(--arciin-accent-hover))",
                }}
              />
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.4)" }}>
              {storage ? formatBytes(storage.usageBytes) : "—"} used
            </span>
            {usagePercent != null && (
              <span
                className={cn(
                  "text-[12px] font-semibold",
                  usagePercent > 85 ? "text-red-400" : "text-[var(--arciin-accent)]",
                )}
              >
                {usagePercent === 0 ? "0%" : `${usagePercent}%`}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Health pills ──────────────────────────────────────────────────────────────

const HEALTH_SERVICES = ["api", "database", "redis", "worker", "storage"] as const

function MobileHealthRow() {
  const { data: health, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchApi<HealthStatus>("/health"),
    refetchInterval: 30_000,
  })

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <p className="mb-3 text-[13px] font-semibold text-white">System health</p>
      <div className="flex flex-wrap gap-2">
        {HEALTH_SERVICES.map((svc) => {
          const status = health?.[svc]
          const online = status === "online"
          const unknown = !status || status === "unknown"
          return (
            <div
              key={svc}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
              style={{
                background: online
                  ? "rgba(34,197,94,0.1)"
                  : unknown
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(239,68,68,0.1)",
                border: online
                  ? "1px solid rgba(34,197,94,0.2)"
                  : unknown
                    ? "1px solid rgba(255,255,255,0.08)"
                    : "1px solid rgba(239,68,68,0.2)",
              }}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isLoading || unknown
                    ? "animate-pulse bg-zinc-600"
                    : online
                      ? "bg-emerald-500"
                      : "bg-red-500",
                )}
              />
              <span
                className="text-[11px] capitalize"
                style={{
                  color: online
                    ? "rgba(134,239,172,0.9)"
                    : unknown
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(252,165,165,0.9)",
                }}
              >
                {svc}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Libraries ─────────────────────────────────────────────────────────────────

function MobileLibrariesRow() {
  const { data: libraries, isLoading } = useQuery({
    queryKey: queryKeys.libraries,
    queryFn: ({ signal }) => getLibraries(signal),
  })

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-1">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="size-20 shrink-0 animate-pulse rounded-2xl"
            style={{ background: "rgba(255,255,255,0.05)" }}
          />
        ))}
      </div>
    )
  }

  if (!libraries?.length) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-2xl py-8"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px dashed rgba(255,255,255,0.08)",
        }}
      >
        <FolderOpen className="size-8" style={{ color: "rgba(255,255,255,0.2)" }} />
        <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
          No libraries yet
        </p>
      </div>
    )
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4">
      {libraries.map((lib) => (
        <Link
          key={lib.id}
          href={`/${lib.kind?.toLowerCase() ?? "files"}`}
          className="flex shrink-0 flex-col items-center gap-2 rounded-2xl p-3 transition-all active:scale-95"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            minWidth: 80,
          }}
        >
          <div
            className="flex size-10 items-center justify-center rounded-xl"
            style={{
              background: "var(--arciin-accent-icon-bg)",
              border: "1px solid var(--arciin-accent-icon-border)",
            }}
          >
            <Files className="size-5 text-[var(--arciin-accent)]" />
          </div>
          <span className="max-w-[72px] truncate text-center text-[11px] font-medium text-white">
            {lib.name}
          </span>
          <span
            className="text-[10px] tabular-nums"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            {lib.assetCount ?? 0} files
          </span>
        </Link>
      ))}

      <Link
        href="/files"
        className="flex shrink-0 flex-col items-center justify-center gap-2 rounded-2xl p-3 transition-all active:scale-95"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px dashed rgba(255,255,255,0.08)",
          minWidth: 80,
        }}
      >
        <ArrowRight
          className="size-5"
          style={{ color: "rgba(255,255,255,0.25)" }}
        />
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
          All files
        </span>
      </Link>
    </div>
  )
}

// ── Recent activity ───────────────────────────────────────────────────────────

function MobileRecentActivity() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.activity({}),
    queryFn: ({ signal }) => getActivity(signal),
  })

  const events = (data ?? []).slice(0, 5)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
          <span className="text-[13px] font-semibold text-white">Recent activity</span>
        </div>
        <Link
          href="/activity"
          className="flex items-center gap-1 text-[11px]"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          View all <ChevronRight className="size-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)" }}
            />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div
          className="flex flex-col items-center gap-2 rounded-2xl py-8"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px dashed rgba(255,255,255,0.08)",
          }}
        >
          <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            No activity yet
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: "color-mix(in srgb, var(--arciin-accent) 70%, transparent)" }}
              />
              <span
                className="min-w-0 flex-1 truncate text-[12px]"
                style={{ color: "rgba(255,255,255,0.6)" }}
              >
                {event.message ?? event.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Quick links ───────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { label: "Overview",  href: "/dashboard", icon: LayoutDashboard },
  { label: "Files",     href: "/files",     icon: Files           },
  { label: "Jobs",      href: "/jobs",      icon: Boxes           },
  { label: "Activity",  href: "/activity",  icon: Activity        },
] as const

function MobileQuickLinks() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {QUICK_LINKS.map(({ label, href, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex flex-col items-center gap-2 rounded-2xl py-4 transition-all active:scale-95"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <Icon className="size-5" style={{ color: "rgba(255,255,255,0.55)" }} />
          <span className="text-[10px] font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>
            {label}
          </span>
        </Link>
      ))}
    </div>
  )
}

// ── Root export ───────────────────────────────────────────────────────────────

export function MobileDashboard() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-heading text-[22px] font-semibold tracking-tight text-white">
          Overview
        </h2>
        <p className="mt-0.5 text-[13px]" style={{ color: "rgba(255,255,255,0.35)" }}>
          Your Arciin instance at a glance.
        </p>
      </div>

      <MobileStorageStrip />
      <MobileHealthRow />

      <div>
        <p className="mb-3 text-[13px] font-semibold text-white">Libraries</p>
        <MobileLibrariesRow />
      </div>

      <MobileQuickLinks />
      <MobileRecentActivity />

      {/* spacer for bottom nav */}
      <div className="h-2" />
    </div>
  )
}
