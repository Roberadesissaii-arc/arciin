"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpRight,
  FileText,
  Image as ImageIcon,
  Inbox,
  Music2,
  ShieldCheck,
  Video,
  type LucideIcon,
} from "lucide-react"

import { getStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { useLibraries } from "@/hooks/use-libraries"
import { formatBytes } from "@/lib/utils/format-bytes"
import {
  resolveFilesystemTotalBytes,
  resolveFilesystemUsedBytes,
  resolveStorageUsagePercent,
} from "@/lib/utils/storage-usage"
import type { StorageSettings } from "@/lib/types/models"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const LIBRARY_ORDER = ["videos", "images", "music", "documents", "inbox"] as const

const LIBRARY_ROUTES: Record<string, string> = {
  videos: "/videos",
  images: "/images",
  music: "/music",
  documents: "/documents",
  inbox: "/inbox",
}

const LIBRARY_ICONS: Record<string, LucideIcon> = {
  videos: Video,
  images: ImageIcon,
  music: Music2,
  documents: FileText,
  inbox: Inbox,
}

/** Zinc segment tones in order: Videos → Images → Music → Documents → Inbox */
const SEGMENT_TONES = [
  "bg-zinc-900",
  "bg-zinc-700",
  "bg-zinc-500",
  "bg-zinc-400",
  "bg-zinc-300",
] as const

type LibraryRow = {
  id: string
  slug: string
  name: string
  assetCount: number
  sizeBytes: number
  href: string
}

function stripTrailingSlash(path: string) {
  return path.replace(/[/\\]+$/, "")
}

function deriveVolumeMeta(storage: StorageSettings) {
  const root = stripTrailingSlash(storage.hostStorageRoot || storage.storageRoot || "")
  const winMatch = root.match(/^([A-Za-z]:)/)

  if (winMatch) {
    return {
      volumeName: "Windows",
      deviceLabel: "Local Disk",
      mount: winMatch[1]!,
    }
  }

  const leaf = root.split(/[/\\]/).filter(Boolean).pop()
  return {
    volumeName: storage.instanceName?.trim() || leaf || "Primary",
    deviceLabel: storage.isDockerRuntime ? "Container volume" : "Local Disk",
    mount: root || "—",
  }
}

function resolveTotalBytes(storage: StorageSettings): number {
  if (storage.totalBytes != null && storage.totalBytes > 0) {
    return storage.totalBytes
  }
  if (storage.availableBytes != null && storage.availableBytes >= 0) {
    const inferred = storage.usageBytes + storage.availableBytes
    if (inferred > 0) return inferred
  }
  return 0
}

function usedPercent(used: number, total: number) {
  if (!total || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)))
}

/**
 * Primary storage overview card — two columns:
 * left: disk capacity / used bar
 * right: smart library index with segmented distribution
 */
export function StorageDonutCard({ className }: { className?: string }) {
  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })
  const librariesQuery = useLibraries()
  const [highlightedLibrary, setHighlightedLibrary] = useState<string | null>(null)

  const storageView = useMemo(() => {
    if (storageQuery.data) {
      const storage = storageQuery.data
      const meta = deriveVolumeMeta(storage)
      const totalBytes = resolveFilesystemTotalBytes(storage) ?? resolveTotalBytes(storage)
      // The disk's own used figure; Arciin's share is shown separately.
      const usedBytes = resolveFilesystemUsedBytes(storage) ?? storage.usageBytes
      const arciinBytes = storage.arciinUsageBytes ?? storage.usageBytes
      const reportedAvailable = storage.filesystemAvailableBytes ?? storage.availableBytes
      const availableBytes =
        reportedAvailable != null && reportedAvailable >= 0
          ? reportedAvailable
          : totalBytes > 0
            ? Math.max(0, totalBytes - usedBytes)
            : 0
      const percent =
        resolveStorageUsagePercent(storage) ?? usedPercent(usedBytes, totalBytes)

      return {
        ...meta,
        usedBytes,
        arciinBytes,
        totalBytes,
        availableBytes,
        writable: storage.writable,
        percent: Math.max(0, Math.min(100, percent ?? 0)),
      }
    }

    /**
     * No invented disk.
     *
     * This used to fall back to a sample volume — "Windows", "C:", 180 GB of
     * 465 GB, 1842 videos — whenever the storage call had not answered. On a
     * Linux server that is a screenful of confident fiction, and nothing on
     * the card told the reader it was looking at placeholder numbers. A
     * dashboard that cannot get the figure has to say so.
     */
    return null
  }, [storageQuery.data])

  const libraries: LibraryRow[] = useMemo(() => {
    const live = librariesQuery.data
    if (live && live.length > 0) {
      const bySlug = new Map(live.map((lib) => [lib.slug, lib]))
      return LIBRARY_ORDER.map((slug) => {
        const lib = bySlug.get(slug)
        return {
          id: lib?.id ?? slug,
          slug,
          name: lib?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1),
          assetCount: lib?.assetCount ?? 0,
          // API does not yet expose per-library size; keep 0 for live data.
          sizeBytes: 0,
          href: LIBRARY_ROUTES[slug] ?? "/files",
        }
      })
    }

    // No live libraries yet: show none rather than inventing five.
    return []

  }, [librariesQuery.data])

  const indexedTotal = useMemo(
    () => libraries.reduce((sum, lib) => sum + lib.sizeBytes, 0),
    [libraries],
  )
  const indexedCountTotal = useMemo(
    () => libraries.reduce((sum, lib) => sum + lib.assetCount, 0),
    [libraries],
  )
  // Prefer byte weights; fall back to file counts so the bar is never empty.
  const useCountWeights = indexedTotal <= 0

  if (storageQuery.isLoading) {
    return <Skeleton className={cn("h-[14.5rem] w-full rounded-[2rem]", className)} />
  }

  // Say so, rather than drawing a disk that does not exist.
  if (!storageView) {
    return (
      <section
        className={cn(
          "flex min-h-[14.5rem] flex-col items-center justify-center gap-3 rounded-[2rem] border border-zinc-200/90 bg-white px-6 text-center",
          className,
        )}
        aria-label="Primary storage overview"
      >
        <p className="text-[13px] font-medium text-zinc-900">Storage details unavailable</p>
        <p className="max-w-[22rem] text-[12px] leading-relaxed text-zinc-500">
          Arciin could not read this server&apos;s disk usage just now. Your files are not
          affected.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-[12px]"
          onClick={() => void storageQuery.refetch()}
          disabled={storageQuery.isFetching}
        >
          {storageQuery.isFetching ? "Retrying…" : "Retry"}
        </Button>
      </section>
    )
  }

  const lowCapacity = storageView.percent >= 90

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[2rem] border border-zinc-200/90 bg-white",
        className,
      )}
      style={{ boxShadow: "0 18px 55px -38px rgba(24, 24, 27, 0.38)" }}
      aria-label="Primary storage overview"
    >
      <div className="grid min-h-[14.5rem] lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.8fr)]">
        {/* ── Left: Primary storage ── */}
        <div className="flex h-full flex-col px-5 py-5 sm:px-6">
          <div className="flex min-h-[3.6rem] items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Primary storage
              </p>
              <h3 className="mt-1 truncate font-heading text-lg font-semibold tracking-tight text-zinc-950">
                {storageView.volumeName}
              </h3>
              <p className="mt-1 truncate text-[10px] text-zinc-400">
                {storageView.deviceLabel} · {storageView.mount}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                storageView.writable
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700",
              )}
            >
              {storageView.writable ? "Writable" : "Read only"}
            </span>
          </div>

          <div className="mt-4 flex items-end gap-3">
            <p className="font-heading text-[2.55rem] font-semibold leading-[0.85] tracking-[-0.055em] text-zinc-950">
              {storageView.percent}%
            </p>
            <p className="pb-1 text-[11px] leading-tight text-zinc-400">
              disk capacity
              <br />
              currently used
            </p>
          </div>

          <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-inset ring-zinc-200/60">
            <div
              className="h-full rounded-full bg-[#FF4F12] transition-[width] duration-500"
              style={{ width: `${storageView.percent}%` }}
            />
          </div>

          <div className="mt-2.5 flex justify-between text-[10px] tabular-nums">
            <span className="font-medium text-zinc-600" data-testid="storage-disk-used">
              {formatBytes(storageView.usedBytes)} used
              {"arciinBytes" in storageView ? (
                <span className="font-normal text-zinc-400">
                  {" "}· Arciin {formatBytes(storageView.arciinBytes)}
                </span>
              ) : null}
            </span>
            <span className="text-zinc-400">
              {storageView.totalBytes > 0
                ? `${formatBytes(storageView.totalBytes)} total`
                : "capacity unknown"}
            </span>
          </div>

          {/* Grows to match the right column’s library-cells block height */}
          <div
            className={cn(
              "mt-3 flex min-h-[3.2rem] flex-1 items-center gap-3 rounded-xl border px-3 py-2.5",
              lowCapacity
                ? "border-orange-200 bg-orange-50/70"
                : "border-zinc-200 bg-zinc-50/70",
            )}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg",
                lowCapacity
                  ? "bg-orange-100 text-orange-600"
                  : "bg-zinc-200/70 text-zinc-500",
              )}
            >
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-zinc-800">
                {formatBytes(storageView.availableBytes)} available
              </p>
              <p className="mt-0.5 text-[9px] text-zinc-400">Free space on this drive</p>
            </div>
          </div>
        </div>

        {/* ── Right: Smart library index ── */}
        <div
          className={cn(
            "flex h-full flex-col border-t border-zinc-200/80 px-5 py-5 sm:px-6",
            "lg:border-l lg:border-t-0",
          )}
        >
          <div className="flex min-h-[3.6rem] items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Smart library index
              </p>
              <h3 className="mt-1 font-heading text-lg font-semibold tracking-tight text-zinc-950">
                Your files, understood.
              </h3>
              <p className="mt-1 truncate text-[10px] text-zinc-400">
                Automatically organized content across this drive.
              </p>
            </div>
            <Link
              href="/settings/storage"
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2",
                "text-[11px] font-semibold text-zinc-500 transition-colors",
                "hover:border-orange-200 hover:bg-orange-50 hover:text-[#FF4F12]",
                "group",
              )}
            >
              Manage
              <ArrowUpRight
                className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>

          <div className="mt-11 flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.13em] text-zinc-400">
              <span>Indexed distribution</span>
              <span className="tabular-nums text-zinc-500">
                {useCountWeights
                  ? `${indexedCountTotal.toLocaleString()} files`
                  : formatBytes(indexedTotal)}
              </span>
            </div>

            <div
              className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full bg-zinc-100"
              onMouseLeave={() => setHighlightedLibrary(null)}
            >
              {libraries.map((lib, index) => {
                const weight = useCountWeights
                  ? Math.max(
                      lib.assetCount,
                      Math.max(indexedCountTotal, 1) * 0.008,
                    )
                  : Math.max(lib.sizeBytes, indexedTotal * 0.008)
                const isActive = highlightedLibrary === lib.slug

                return (
                  <Link
                    key={lib.slug}
                    href={lib.href}
                    title={lib.name}
                    aria-label={`${lib.name} library`}
                    className={cn(
                      "min-w-px outline-none transition-colors duration-150",
                      // Highlight only the active segment; keep others on zinc
                      isActive ? "bg-[#FF4F12]" : SEGMENT_TONES[index],
                    )}
                    style={{ flexGrow: weight }}
                    onMouseEnter={() => setHighlightedLibrary(lib.slug)}
                    onFocus={() => setHighlightedLibrary(lib.slug)}
                    onBlur={() => setHighlightedLibrary(null)}
                  />
                )
              })}
            </div>

            <div className="mt-2.5 flex justify-between text-[10px] tabular-nums">
              <span className="font-medium text-zinc-600">
                {useCountWeights
                  ? `${indexedCountTotal.toLocaleString()} indexed`
                  : `${formatBytes(indexedTotal)} indexed`}
              </span>
              <span className="text-zinc-400">
                {libraries.length} smart libraries
              </span>
            </div>

            <div className="mt-auto grid grid-cols-2 overflow-hidden rounded-xl border border-zinc-200/90 bg-zinc-50/60 sm:grid-cols-5">
              {libraries.map((lib, index) => {
                const Icon = LIBRARY_ICONS[lib.slug] ?? Inbox
                const isLast = index === libraries.length - 1
                const isHighlighted = highlightedLibrary === lib.slug
                // 2-col mobile: bottom border on all but last row (5 items → last row is index 4)
                const mobileLastRowStart = libraries.length - (libraries.length % 2 === 0 ? 2 : 1)

                return (
                  <Link
                    key={lib.slug}
                    href={lib.href}
                    onMouseEnter={() => setHighlightedLibrary(lib.slug)}
                    onMouseLeave={() => setHighlightedLibrary(null)}
                    onFocus={() => setHighlightedLibrary(lib.slug)}
                    onBlur={() => setHighlightedLibrary(null)}
                    className={cn(
                      "group/cell flex min-h-[3.2rem] flex-col justify-between px-2.5 py-1.5 outline-none transition-colors",
                      "border-zinc-200/80",
                      // mobile: right divider on left column cells
                      index % 2 === 0 && "border-r",
                      // mobile: bottom dividers except last row
                      index < mobileLastRowStart && "border-b",
                      // sm+: no bottom borders; right dividers except last cell
                      "sm:border-b-0",
                      isLast ? "sm:!border-r-0" : "sm:!border-r",
                      isHighlighted && "bg-orange-50/75",
                      "hover:bg-orange-50/75 focus-visible:bg-orange-50/75",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors",
                          isHighlighted
                            ? "bg-orange-100 text-[#FF4F12]"
                            : "bg-zinc-200/65 text-zinc-500 group-hover/cell:bg-orange-100 group-hover/cell:text-[#FF4F12]",
                        )}
                      >
                        <Icon className="size-3" aria-hidden />
                      </span>
                      <span
                        className={cn(
                          "truncate text-[10.5px] font-semibold text-zinc-600 transition-colors",
                          "group-hover/cell:text-zinc-950",
                          isHighlighted && "text-zinc-950",
                        )}
                      >
                        {lib.name}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-1">
                      <span className="min-w-0 truncate">
                        <span className="text-[11px] font-semibold tabular-nums text-zinc-800">
                          {lib.assetCount.toLocaleString()}
                        </span>
                        <span className="ml-1 text-[8px] font-medium uppercase tracking-wider text-zinc-400">
                          {" "}
                          files
                        </span>
                      </span>
                      <span className="shrink-0 text-[9px] tabular-nums text-zinc-400">
                        {useCountWeights && lib.sizeBytes <= 0
                          ? "—"
                          : formatBytes(lib.sizeBytes)}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
