"use client"

import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Smartphone,
  Terminal,
  XCircle,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { CopyableShellBlock } from "@/components/settings/copyable-shell-block"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getMobileAppInstallStatus, startMobileAppInstall } from "@/lib/api/mobile-app"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"

function StatusBadge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "off" | "running"
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        tone === "ok" && "bg-emerald-500/10 text-emerald-600",
        tone === "warn" && "bg-amber-500/10 text-amber-700",
        tone === "running" && "bg-primary/10 text-primary",
        tone === "off" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

export function MobileAppInstallPanel({
  variant = "default",
  onSkip,
  showSkip = false,
}: {
  variant?: "default" | "welcome"
  onSkip?: () => void
  showSkip?: boolean
}) {
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: queryKeys.mobileAppInstall,
    queryFn: ({ signal }) => getMobileAppInstallStatus(signal),
    refetchInterval: (q) => {
      const data = q.state.data
      if (data?.installRunning || data?.installState === "running") return 4000
      return false
    },
  })

  const installMutation = useMutation({
    mutationFn: startMobileAppInstall,
    onSuccess: async () => {
      toast.success("Mobile install started.", {
        description: "This may take a few minutes — status updates below.",
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.mobileAppInstall })
    },
    onError: (e: Error) =>
      toast.error("Could not start install", { description: e.message || "Try again in a moment." }),
  })

  const data = statusQuery.data

  if (statusQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    )
  }

  if (statusQuery.isError || !data) {
    return (
      <SettingsPanelError
        message={
          statusQuery.error instanceof Error
            ? statusQuery.error.message
            : "Could not load mobile install status."
        }
        hint="Only the instance owner can install Arciin Mobile from the web UI."
      />
    )
  }

  const tone: "ok" | "warn" | "off" | "running" = data.installed
    ? "ok"
    : data.installRunning
      ? "running"
      : data.clonePresent
        ? "warn"
        : "off"

  const statusLabel = data.installed
    ? "Running"
    : data.installRunning
      ? "Installing…"
      : data.installState === "failed"
        ? "Install failed"
        : data.clonePresent
          ? "Cloned, not running"
          : "Not installed"

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card",
        variant === "welcome" && "border-primary/20 shadow-sm ring-1 ring-primary/10",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/25">
            <Smartphone className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Arciin Mobile</h2>
            <p className="mt-0.5 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
              Phone PWA that connects to this server — upload from your pocket, browse libraries, and
              pair once over LAN. Install it on the same machine after the desktop stack.
            </p>
          </div>
        </div>
        <StatusBadge tone={tone}>
          {data.installed ? (
            <CheckCircle2 className="size-3.5" />
          ) : data.installRunning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <XCircle className="size-3.5 opacity-60" />
          )}
          {statusLabel}
        </StatusBadge>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {variant === "welcome" ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Your instance is claimed. Want the mobile companion on this server too? Arciin can clone{" "}
            <code className="text-foreground">arciin-app</code> next to this install and run its
            installer for you — or copy the commands below and run them over SSH later.
          </p>
        ) : null}

        {data.mobileUrl ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/15 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Mobile URL (LAN)
              </p>
              <p className="truncate font-mono text-[12px] text-foreground">{data.mobileUrl}</p>
            </div>
            {data.installed ? (
              <Button
                type="button"
                size="sm"
                className="h-8 border-0 bg-primary px-3 font-semibold text-white shadow-none hover:bg-primary/90"
                asChild
              >
                <a href={data.mobileUrl} target="_blank" rel="noopener noreferrer">
                  Open
                  <ExternalLink className="size-3.5 opacity-90" />
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {!data.installed ? (
            <Button
              type="button"
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={data.installRunning || installMutation.isPending}
              onClick={() => installMutation.mutate()}
            >
              {data.installRunning || installMutation.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Installing on server…
                </>
              ) : (
                <>
                  <Terminal className="size-3.5" />
                  Install for me
                </>
              )}
            </Button>
          ) : null}
          {showSkip && onSkip ? (
            <Button type="button" size="sm" variant="outline" onClick={onSkip}>
              Maybe later
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" asChild>
            <a href={data.mobileRepoUrl} target="_blank" rel="noopener noreferrer">
              GitHub repo
              <ExternalLink className="size-3.5 opacity-70" />
            </a>
          </Button>
        </div>

        {data.installRunning || data.installLogTail ? (
          <div className="rounded-xl border border-border bg-muted/10 px-3 py-2.5 text-[12px] text-muted-foreground">
            <p className="font-medium text-foreground">
              {data.installRunning ? "Install in progress" : "Last install log"}
            </p>
            {data.installLogTail ? (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-600">
                {data.installLogTail}
              </pre>
            ) : (
              <p className="mt-1">Cloning and building — this can take several minutes.</p>
            )}
          </div>
        ) : null}

        {!data.installed ? (
          <CopyableShellBlock
            title="Manual install (SSH)"
            description="Recommended order: server first, then mobile. Mobile reads ports from the desktop .env."
            script={data.installCommands}
            copyLabel="Copy install commands"
          />
        ) : (
          <p className="text-[12px] text-muted-foreground">
            On your phone (same Wi‑Fi), open the mobile URL, tap <strong>Install Arciin Mobile</strong>,
            then connect to this server. Manage pairing under{" "}
            <Link href="/settings?tab=domain" className="font-medium text-primary hover:underline">
              Settings → Domain
            </Link>
            .
          </p>
        )}

        <p className="text-[11px] text-muted-foreground">
          Server repo:{" "}
          <a href={data.serverRepoUrl} className="text-primary hover:underline" target="_blank" rel="noreferrer">
            arciin
          </a>
          {" · "}
          Mobile repo:{" "}
          <a href={data.mobileRepoUrl} className="text-primary hover:underline" target="_blank" rel="noreferrer">
            arciin-app
          </a>
        </p>
      </div>
    </div>
  )
}
