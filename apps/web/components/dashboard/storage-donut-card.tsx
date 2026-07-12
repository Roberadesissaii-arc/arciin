"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"

import { getStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { useLibraries } from "@/hooks/use-libraries"
import { formatBytes } from "@/lib/utils/format-bytes"
import { resolveStorageUsagePercent } from "@/lib/utils/storage-usage"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const LIBRARY_ORDER = ["videos", "images", "music", "documents", "inbox"]

const LIBRARY_ROUTES: Record<string, string> = {
  inbox: "/inbox",
  videos: "/videos",
  images: "/images",
  music: "/music",
  documents: "/documents",
}

/** Storage card: orange donut + library breakdown (orange dot · name · count). */
export function StorageDonutCard({ className }: { className?: string }) {
  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })
  const librariesQuery = useLibraries()

  const storage = storageQuery.data
  const usagePercent = useMemo(
    () => (storage ? resolveStorageUsagePercent(storage) : null),
    [storage],
  )

  const libraries = useMemo(
    () =>
      [...(librariesQuery.data ?? [])]
        .sort((a, b) => LIBRARY_ORDER.indexOf(a.slug) - LIBRARY_ORDER.indexOf(b.slug))
        .slice(0, 5),
    [librariesQuery.data],
  )

  if (storageQuery.isLoading) {
    return <Skeleton className={cn("h-full min-h-[22rem] rounded-3xl", className)} />
  }

  if (storageQuery.isError || !storage) {
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

  const percent = Math.max(0, Math.min(100, usagePercent ?? 0))
  const r = 15.5
  const circumference = 2 * Math.PI * r

  const capacityLabel =
    storage.totalBytes && storage.totalBytes > 0
      ? `of ${formatBytes(storage.totalBytes)} used`
      : "used on disk"

  return (
    <Card className={cn("flex h-full min-h-[18rem] flex-col overflow-hidden border-zinc-200/80 bg-card shadow-sm sm:min-h-[20rem] lg:min-h-0", className)}>
      <CardHeader className="space-y-1 border-b border-zinc-100/80 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5 border-l-2 border-primary pl-3">
            <CardTitle className="font-heading text-base font-semibold tracking-tight text-zinc-900">
              Storage
            </CardTitle>
            <CardDescription className="text-sm text-zinc-600">
              Local object storage on this server.
            </CardDescription>
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
      <CardContent className="flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-5">
        <div className="flex flex-1 items-center gap-5">
          <svg viewBox="0 0 40 40" className="size-32 shrink-0" role="img" aria-label={`Storage ${percent}% used`}>
            <circle cx="20" cy="20" r={r} fill="none" stroke="#f0f0f0" strokeWidth="4.5" />
            <circle
              cx="20"
              cy="20"
              r={r}
              fill="none"
              stroke="var(--arciin-accent, #ff4f12)"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
              transform="rotate(-90 20 20)"
            />
            <text
              x="20"
              y="18.6"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#111111"
              fontSize="7"
              fontWeight="700"
            >
              {percent}%
            </text>
            <text x="20" y="26" textAnchor="middle" fill="#a0a0a0" fontSize="2.9">
              {capacityLabel}
            </text>
          </svg>

          <div className="min-w-0 flex-1">
            {librariesQuery.isLoading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-5 w-full rounded-md" />
                ))}
              </div>
            ) : (
              <ul className="space-y-1">
                {libraries.map((lib) => {
                  const href = LIBRARY_ROUTES[lib.slug] ?? "/files"

                  return (
                    <li key={lib.id}>
                      <Link
                        href={href}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-0.5 py-1",
                          "transition-colors hover:bg-zinc-50",
                        )}
                      >
                        <span
                          className="size-2 shrink-0 rounded-full bg-primary"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800">
                          {lib.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-[13px] font-medium text-zinc-500">
                          {(lib.assetCount ?? 0).toLocaleString()}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3">
          <p className="text-xs text-zinc-600">
            {formatBytes(storage.usageBytes)} · {storage.objectCount.toLocaleString()} objects
          </p>
          <Link
            href="/settings/storage"
            className="inline-flex items-center gap-0.5 text-sm font-medium text-primary hover:text-primary/80"
          >
            Storage settings
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
