"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Cloud, Monitor } from "lucide-react"

import { PageHeader } from "@/components/app-shell/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { listComputers, type ComputerCard, type ComputerRoot } from "@/lib/api/computers"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatCardRelativeTime } from "@/lib/utils/format-card-relative-time"

function healthLabel(health: ComputerCard["health"] | ComputerRoot["status"]) {
  switch (health) {
    case "UP_TO_DATE":
    case "PROTECTED":
      return "Up to date"
    case "SYNCING":
      return "Backing up"
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
        <PageHeader title="My Computers" description="Protected folders from Arciin Desktop." />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Computers" description="Protected folders from Arciin Desktop." />
        <p className="text-sm text-muted-foreground">Could not load computers. Refresh and try again.</p>
      </div>
    )
  }

  const computers = query.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Computers"
        description="One-way backup from your computers into Arciin. Files stay on the server even if a computer is disconnected."
      />

      {computers.length === 0 ? (
        <Empty
          className="mx-auto min-h-[28rem] max-w-xl border border-dashed border-border bg-card px-8 py-16"
          data-testid="computers-empty-state"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-12 rounded-xl bg-zinc-900 text-muted-foreground">
              <Cloud className="size-5" />
            </EmptyMedia>
            <EmptyTitle className="text-lg text-foreground">No protected computers yet</EmptyTitle>
            <EmptyDescription>
              Protect Desktop, Documents, Pictures and other important folders with Arciin Desktop.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/settings?tab=devices">Set up computer backup</Link>
            </Button>
            <div className="mt-4 space-y-1 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                How computer backup works
              </p>
              <p className="text-sm text-muted-foreground">
                Open Arciin Desktop to protect folders.
              </p>
            </div>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
          {computers.map((computer) => (
            <Card key={computer.deviceId} className="border-border bg-card" data-testid="computer-card">
              <CardContent className="space-y-5 px-6 py-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Monitor className="size-4 text-muted-foreground" />
                      <h2 className="text-[16px] font-medium text-foreground">{computer.name}</h2>
                      <Badge variant="secondary">{healthLabel(computer.health)}</Badge>
                    </div>
                    <p className="text-[13px] text-muted-foreground">{platformLabel(computer.platform)}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {computer.roots.length} protected {computer.roots.length === 1 ? "folder" : "folders"}
                      {computer.byteCount > 0 ? ` · ${formatBytes(computer.byteCount)}` : ""}
                      {computer.fileCount > 0 ? ` · ${computer.fileCount.toLocaleString()} files` : ""}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      Last backup {computer.lastSyncAt ? formatCardRelativeTime(computer.lastSyncAt) : "never"}
                    </p>
                  </div>
                  <Button asChild>
                    <Link href={`/computers/${computer.deviceId}`}>Open Files</Link>
                  </Button>
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Protected folders
                  </p>
                  {computer.roots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No folders protected yet.</p>
                  ) : (
                    <ul className="divide-y divide-border/70 rounded-xl border border-border">
                      {computer.roots.map((root) => (
                        <li
                          key={root.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px]"
                        >
                          <span className="text-foreground">{root.displayName}</span>
                          <span className="text-muted-foreground">{healthLabel(root.status)}</span>
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
