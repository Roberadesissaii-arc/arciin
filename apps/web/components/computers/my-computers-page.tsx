"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import { Monitor } from "lucide-react"
import {
  computerBackupEmptyHint,
  isArciinDesktopWebView,
  requestNativeComputerBackupSetup,
} from "@arciin/shared"

import { ComputersPageIntro } from "@/components/computers/computers-page-intro"
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
import {
  computerHealthLabel,
  computerRootStatusLabel,
} from "@/lib/utils/computer-root-status"
import { listComputers, type ComputerCard } from "@/lib/api/computers"
import { queryKeys } from "@/lib/api/query-keys"
import { computerSourceValue, filesSourceHref } from "@/lib/utils/library-asset-pipeline"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatCardRelativeTime } from "@/lib/utils/format-card-relative-time"

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

function handleSetupComputerBackup(onBrowserFallback: () => void) {
  try {
    if (requestNativeComputerBackupSetup()) return
  } catch {
    // A missing or broken WebView must never throw in a browser.
  }
  onBrowserFallback()
}

function useArciinDesktopWebView() {
  return useSyncExternalStore(
    () => () => {},
    isArciinDesktopWebView,
    () => false,
  )
}

export function MyComputersPage() {
  const router = useRouter()
  const inDesktop = useArciinDesktopWebView()
  const query = useQuery({
    queryKey: queryKeys.computers,
    queryFn: ({ signal }) => listComputers(signal),
  })

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <ComputersPageIntro />
        <Skeleton className="h-56 w-full rounded-3xl" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="space-y-6">
        <ComputersPageIntro />
        <p className="text-sm text-zinc-600">Could not load computers. Refresh and try again.</p>
      </div>
    )
  }

  const computers = query.data ?? []

  return (
    <div className="space-y-6">
      <ComputersPageIntro />

      {computers.length === 0 ? (
        <Empty
          className="w-full min-h-[22rem] rounded-3xl border border-zinc-200/90 bg-gradient-to-br from-zinc-50 via-white to-zinc-50/95 px-6 py-16 shadow-sm ring-1 ring-inset ring-zinc-200/60"
          data-testid="computers-empty-state"
        >
          <EmptyHeader className="max-w-xl">
            <EmptyMedia
              variant="icon"
              className="size-12 rounded-2xl border border-zinc-200/90 bg-white text-primary shadow-sm"
            >
              <Monitor className="size-5" />
            </EmptyMedia>
            <EmptyTitle className="text-lg text-zinc-900">No protected computers yet</EmptyTitle>
            <EmptyDescription className="text-zinc-600">
              Protect Desktop, Documents, Pictures and other important folders with Arciin Desktop.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-xl">
            <Button
              type="button"
              data-testid="setup-computer-backup"
              onClick={() => handleSetupComputerBackup(() => router.push("/settings?tab=devices"))}
            >
              Set up computer backup
            </Button>
            <div className="mt-4 space-y-1 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                How computer backup works
              </p>
              <p className="text-sm text-zinc-600" data-testid="computer-backup-hint">
                {computerBackupEmptyHint(inDesktop)}
              </p>
            </div>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
          {computers.map((computer) => (
            <Card
              key={computer.deviceId}
              className="w-full border-zinc-200/90 bg-white shadow-sm"
              data-testid="computer-card"
            >
              <CardContent className="space-y-5 px-6 py-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Monitor className="size-4 text-zinc-500" />
                      <h2 className="text-[16px] font-medium text-zinc-900">{computer.name}</h2>
                      <Badge variant="secondary">{computerHealthLabel(computer)}</Badge>
                    </div>
                    <p className="text-[13px] text-zinc-600">{platformLabel(computer.platform)}</p>
                    <p className="text-[13px] text-zinc-600">
                      {computer.roots.filter((root) => root.status !== "DISABLED").length} protected{" "}
                      {computer.roots.filter((root) => root.status !== "DISABLED").length === 1
                        ? "folder"
                        : "folders"}
                      {computer.byteCount > 0 ? ` · ${formatBytes(computer.byteCount)}` : ""}
                      {computer.fileCount > 0 ? ` · ${computer.fileCount.toLocaleString()} files` : ""}
                    </p>
                    <p className="text-[12px] text-zinc-500">
                      Last backup {computer.lastSyncAt ? formatCardRelativeTime(computer.lastSyncAt) : "never"}
                    </p>
                  </div>
                  <Button asChild>
                    <Link href={filesSourceHref(computerSourceValue(computer.deviceId))}>Open Files</Link>
                  </Button>
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Protected folders
                  </p>
                  {computer.roots.length === 0 ? (
                    <p className="text-sm text-zinc-600">No folders protected yet.</p>
                  ) : (
                    <ul className="divide-y divide-zinc-200/80 rounded-xl border border-zinc-200/90">
                      {computer.roots.map((root) => (
                        <li
                          key={root.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px]"
                        >
                          <span className="text-zinc-900">{root.displayName}</span>
                          <span className="text-zinc-500">{computerRootStatusLabel(root)}</span>
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
