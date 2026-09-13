"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, Monitor } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { AssetGrid } from "@/components/libraries/asset-grid"
import { Skeleton } from "@/components/ui/skeleton"
import { browseComputer } from "@/lib/api/computers"
import { queryKeys } from "@/lib/api/query-keys"
import { Folder } from "lucide-react"

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
  const pathSegments = folder.pathCache.split("/").filter(Boolean)
  const crumbs = [
    computer.name,
    ...pathSegments.slice(pathSegments[0]?.startsWith("device-") ? 1 : 0),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={computer.name}
        description="Browse the preserved source hierarchy. This view is read-only in V1 — changes here do not rename or delete files on the computer."
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
        Server copy · browse, preview, and download
      </p>

      {folders.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Folders</h2>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {folders.map((item) => (
              <Link
                key={item.id}
                href={`/computers/${deviceId}?folder=${item.id}`}
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-[13px] text-foreground transition-colors hover:bg-muted/40"
              >
                <Folder className="size-4 text-muted-foreground" />
                <span className="truncate">{item.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Files</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files in this folder.</p>
        ) : (
          <AssetGrid assets={assets} readOnly />
        )}
      </section>
    </div>
  )
}
