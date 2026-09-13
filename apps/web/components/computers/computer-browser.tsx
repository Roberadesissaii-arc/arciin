"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, Folder, Monitor } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { AssetGrid } from "@/components/libraries/asset-grid"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { browseComputer, type ComputerCard, type ComputerRoot } from "@/lib/api/computers"
import { queryKeys } from "@/lib/api/query-keys"
import { formatCardRelativeTime } from "@/lib/utils/format-card-relative-time"
import { formatBytes } from "@/lib/utils/format-bytes"

function platformLabel(platform: ComputerCard["platform"]) {
  switch (platform) {
    case "WINDOWS":
      return "Windows"
    case "MACOS":
      return "macOS"
    case "LINUX":
      return "Linux"
    default:
      return "Other"
  }
}

function rootStatusLabel(status: ComputerRoot["status"]) {
  switch (status) {
    case "PROTECTED":
      return "Up to date"
    case "SYNCING":
      return "Backing up"
    case "PAUSED":
      return "Paused"
    case "ERROR":
      return "Error"
    case "DISABLED":
      return "Disabled"
    default:
      return status
  }
}

export function ComputerBrowser({
  deviceId,
  folderId,
}: {
  deviceId: string
  folderId?: string
}) {
  const query = useQuery({
    queryKey: queryKeys.computerBrowse(deviceId, folderId),
    queryFn: ({ signal }) => browseComputer(deviceId, folderId, signal),
  })

  if (query.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />
  }

  if (query.isError || !query.data) {
    return <p className="text-sm text-muted-foreground">Could not open this computer.</p>
  }

  const { computer, folder, folders, assets } = query.data
  const atComputerRoot = !folderId
  const pathSegments = folder.pathCache.split("/").filter(Boolean)
  const crumbs = [
    computer.name,
    ...pathSegments.slice(pathSegments[0]?.startsWith("device-") ? 1 : 0),
  ]
  const rootByFolderId = new Map(computer.roots.map((root) => [root.folderId, root]))

  return (
    <div className="space-y-6">
      <PageHeader
        title={computer.name}
        description={`${platformLabel(computer.platform)} · Last backup ${
          computer.lastSyncAt ? formatCardRelativeTime(computer.lastSyncAt) : "never"
        }`}
      />

      <nav className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground" aria-label="Computer path">
        <Link href="/computers" className="hover:text-foreground">
          My Computers
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/computers/${deviceId}`} className="hover:text-foreground">
          {computer.name}
        </Link>
        {crumbs.slice(1).map((crumb, index) => (
          <span key={`${index}-${crumb}`} className="flex items-center gap-1">
            <ChevronRight className="size-3.5" />
            <span className={crumb === crumbs[crumbs.length - 1] ? "text-foreground" : undefined}>
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Monitor className="size-3.5" />
        Server copy · browse, preview, and download. Changes here do not delete files on the computer.
      </p>

      {folders.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {atComputerRoot ? "Protected folders" : "Folders"}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((item) => {
              const root = rootByFolderId.get(item.id)
              return (
                <Link
                  key={item.id}
                  href={`/computers/${deviceId}?folder=${item.id}`}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-4 text-foreground transition-colors hover:bg-muted/40"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-zinc-950">
                    <Folder className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-[14px] font-medium">{item.name}</p>
                    {root ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{rootStatusLabel(root.status)}</Badge>
                        <span className="text-[12px] text-muted-foreground">
                          {root.fileCount.toLocaleString()} files
                          {root.byteCount > 0 ? ` · ${formatBytes(root.byteCount)}` : ""}
                        </span>
                      </div>
                    ) : (
                      <p className="text-[12px] text-muted-foreground">Open folder</p>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Files</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {atComputerRoot && folders.length > 0
              ? "Choose a protected folder to browse its files."
              : "No files in this folder."}
          </p>
        ) : (
          <AssetGrid assets={assets} readOnly />
        )}
      </section>
    </div>
  )
}
