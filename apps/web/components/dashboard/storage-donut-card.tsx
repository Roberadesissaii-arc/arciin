"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, HardDrive } from "lucide-react"

import { getStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { useLibraries } from "@/hooks/use-libraries"
import { formatBytes } from "@/lib/utils/format-bytes"
import { resolveStorageUsagePercent } from "@/lib/utils/storage-usage"
import { Badge } from "@/components/ui/badge"
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

/** Full-width storage overview: donut + library breakdown. */
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
    return <Skeleton className={cn("h-[13.5rem] w-full rounded-3xl", className)} />
  }

  if (storageQuery.isError || !storage) {
    return (
      <div
        className={cn(
          "rounded-3xl border border-red-500/20 bg-red-500/5 px-5 py-6",
          className,
        )}
      >
        <p className="text-sm font-semibold text-red-900">Storage is unavailable</p>
        <p className="mt-1 text-sm text-red-800">
          {storageQuery.error instanceof Error
            ? storageQuery.error.message
            : "Could not load storage status."}
        </p>
      </div>
    )
  }

  const percent = Math.max(0, Math.min(100, usagePercent ?? 0))
  const r = 15.5
  const circumference = 2 * Math.PI * r

  const capacityLabel =
    storage.totalBytes && storage.totalBytes > 0
      ? `of ${formatBytes(storage.totalBytes)}`
      : "on disk"

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-gradient-to-br from-white via-zinc-50/50 to-[#fff8f5]/70",
        "shadow-sm ring-1 ring-inset ring-zinc-200/50",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-primary/[0.06] blur-2xl"
        aria-hidden
      />

      <div className="relative flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-center lg:gap-8 lg:px-7">
        <div className="flex min-w-0 flex-1 items-center gap-5 sm:gap-6">
          <div className="relative shrink-0">
            <svg
              viewBox="0 0 40 40"
              className="size-[7.25rem] sm:size-[8rem]"
              role="img"
              aria-label={`Storage ${percent}% used`}
            >
              <circle cx="20" cy="20" r={r} fill="none" stroke="#eeeef0" strokeWidth="4.25" />
              <circle
                cx="20"
                cy="20"
                r={r}
                fill="none"
                stroke="var(--arciin-accent, #ff4f12)"
                strokeWidth="4.25"
                strokeLinecap="round"
                strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
                transform="rotate(-90 20 20)"
              />
              <text
                x="20"
                y="18.2"
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#111111"
                fontSize="7.2"
                fontWeight="700"
              >
                {percent}%
              </text>
              <text x="20" y="25.5" textAnchor="middle" fill="#a1a1aa" fontSize="2.7">
                used
              </text>
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-primary shadow-sm">
                <HardDrive className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="font-heading text-base font-semibold tracking-tight text-zinc-900">
                  Storage
                </h3>
                <p className="text-[12px] text-zinc-500">Local object storage on this server</p>
              </div>
              <Badge
                className={
                  storage.writable
                    ? "ml-auto shrink-0 border-0 bg-emerald-600 px-2.5 text-[10px] font-semibold text-white shadow-none hover:bg-emerald-600 sm:ml-2"
                    : "ml-auto shrink-0 border-0 bg-red-600 px-2.5 text-[10px] font-semibold text-white shadow-none hover:bg-red-600 sm:ml-2"
                }
              >
                {storage.writable ? "Writable" : "Read only"}
              </Badge>
            </div>

            <p className="mt-3 text-sm font-medium text-zinc-800">
              {formatBytes(storage.usageBytes)}{" "}
              <span className="font-normal text-zinc-500">{capacityLabel}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-zinc-500">
              {storage.objectCount.toLocaleString()} objects on disk
            </p>
          </div>
        </div>

        <div className="min-w-0 flex-1 border-t border-zinc-200/80 pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          {librariesQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {libraries.map((lib) => {
                const href = LIBRARY_ROUTES[lib.slug] ?? "/files"
                return (
                  <li key={lib.id}>
                    <Link
                      href={href}
                      className={cn(
                        "flex h-full flex-col justify-center rounded-xl border border-zinc-200/90 bg-white/80 px-3 py-2.5",
                        "shadow-sm transition-colors hover:border-primary/30 hover:bg-[#fff8f5]",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                        <span className="truncate text-[12px] font-semibold text-zinc-800">
                          {lib.name}
                        </span>
                      </span>
                      <span className="mt-1 pl-3 tabular-nums text-[13px] font-medium text-zinc-500">
                        {(lib.assetCount ?? 0).toLocaleString()}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-3 flex justify-end">
            <Link
              href="/settings/storage"
              className="inline-flex items-center gap-0.5 text-[13px] font-medium text-primary hover:text-primary/80"
            >
              Storage settings
              <ChevronRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
