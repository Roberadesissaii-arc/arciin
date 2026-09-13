"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Monitor } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { listComputers, type ComputerCard } from "@/lib/api/computers"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatCardRelativeTime } from "@/lib/utils/format-card-relative-time"

function healthLabel(health: ComputerCard["health"]) {
  switch (health) {
    case "UP_TO_DATE":
      return "Up to date"
    case "SYNCING":
      return "Syncing"
    case "PAUSED":
      return "Paused"
    case "OFFLINE":
      return "Offline"
    case "ERROR":
      return "Error"
    case "DISABLED":
      return "Disabled"
    default:
      return health
  }
}

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

export function MyComputersPage() {
  const query = useQuery({
    queryKey: queryKeys.computers,
    queryFn: ({ signal }) => listComputers(signal),
  })

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Computers" description="Your protected files from Arciin Desktop." />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Computers" description="Your protected files from Arciin Desktop." />
        <p className="text-sm text-muted-foreground">Could not load computers. Refresh and try again.</p>
      </div>
    )
  }

  const computers = query.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Computers"
        description="Your protected files from Arciin Desktop."
      />

      {computers.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-start gap-4 px-6 py-10">
            <Monitor className="size-6 text-muted-foreground" />
            <div className="space-y-2">
              <h2 className="text-lg font-medium text-foreground">Protect important folders from your computers with Arciin Desktop.</h2>
              <p className="max-w-xl text-sm text-muted-foreground">
                No computers are backing up files yet. Pair Arciin Desktop, sign in, then choose folders to protect.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/settings?tab=devices">Learn how to connect a computer</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {computers.map((computer) => (
            <Card key={computer.deviceId} className="border-border bg-card" data-testid="computer-card">
              <CardContent className="space-y-4 px-6 py-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Monitor className="size-4 text-muted-foreground" />
                      <h2 className="text-[15px] font-medium text-foreground">{computer.name}</h2>
                      <Badge variant="secondary">{healthLabel(computer.health)}</Badge>
                    </div>
                    <p className="text-[12px] text-muted-foreground">{platformLabel(computer.platform)}</p>
                    <p className="text-[12px] text-muted-foreground">
                      Last synced {computer.lastSyncAt ? formatCardRelativeTime(computer.lastSyncAt) : "never"}
                    </p>
                  </div>
                  <Button asChild>
                    <Link href={`/computers/${computer.deviceId}`}>Open Computer</Link>
                  </Button>
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Protected folders
                  </p>
                  {computer.roots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No folders protected yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {computer.roots.map((root) => (
                        <li
                          key={root.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-foreground"
                        >
                          <span>{root.displayName}</span>
                          <span className="text-muted-foreground">
                            {root.fileCount.toLocaleString()} files · {formatBytes(root.byteCount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
