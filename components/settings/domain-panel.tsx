"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Cloud, Copy, ExternalLink, Globe, Link2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getCloudflareTunnelStatus,
  getRemoteAccessSettings,
  startCloudflareTunnel,
  stopCloudflareTunnel,
  updateRemoteAccessSettings,
} from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"

function copyText(value: string, label: string) {
  void navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied.`),
    () => toast.error("Could not copy."),
  )
}

function UrlChip({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/15 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-[12px] text-foreground">{value}</p>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={onCopy}>
        <Copy className="size-3.5" />
        <span className="sr-only">Copy {label}</span>
      </Button>
    </div>
  )
}

function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "off"
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone === "ok" && "bg-emerald-500/10 text-emerald-600",
        tone === "warn" && "bg-amber-500/10 text-amber-700",
        tone === "off" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

export function DomainPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: queryKeys.remoteAccessSettings,
    queryFn: ({ signal }) => getRemoteAccessSettings(signal),
  })
  const tunnelQuery = useQuery({
    queryKey: queryKeys.cloudflareTunnel,
    queryFn: ({ signal }) => getCloudflareTunnelStatus(signal),
    refetchInterval: (q) => (q.state.data?.running || q.state.data?.stale ? 15_000 : false),
  })

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateRemoteAccessSettings>[0]) =>
      updateRemoteAccessSettings(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.remoteAccessSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnel }),
      ])
    },
    onError: (e: Error) => toast.error(e.message || "Could not save."),
  })

  const startTunnelMutation = useMutation({
    mutationFn: startCloudflareTunnel,
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.remoteAccessSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnel }),
      ])
      if (data.url) {
        setDraft(data.url)
        setInitializingUrl(data.url)
        toast.success("Public URL ready.")
      }
    },
    onError: (e: Error) => toast.error(e.message || "Could not start tunnel."),
  })

  const stopTunnelMutation = useMutation({
    mutationFn: stopCloudflareTunnel,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnel })
      toast.success("Tunnel stopped.")
    },
    onError: (e: Error) => toast.error(e.message || "Could not stop tunnel."),
  })

  const [draft, setDraft] = useState("")
  const [autoStartOverride, setAutoStartOverride] = useState<boolean | undefined>(undefined)
  const [initializingUrl, setInitializingUrl] = useState<string | null>(null)
  const initPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const data = settingsQuery.data
  const tunnel = tunnelQuery.data
  const effective = (draft || data?.publicUrl || "").trim()
  const publicHref = /^https?:\/\//i.test(effective) ? effective : null
  const tunnelBusy = startTunnelMutation.isPending || stopTunnelMutation.isPending
  const isInitializing = Boolean(initializingUrl && initializingUrl === publicHref)
  const effectiveAutoStart = autoStartOverride ?? data?.cloudflareTunnelAutoStart ?? true

  const lanUrls =
    data?.lanUrls?.length
      ? data.lanUrls
      : [data?.primaryLanUrl, data?.localUrl].filter((u): u is string => Boolean(u))

  const tunnelTone: "ok" | "warn" | "off" = tunnel?.running
    ? tunnel.stale
      ? "warn"
      : "ok"
    : tunnel?.stale
      ? "warn"
      : "off"

  useEffect(() => {
    if (!initializingUrl) return
    const deadline = Date.now() + 120_000
    let cancelled = false

    async function poll() {
      if (cancelled) return
      if (Date.now() > deadline) {
        if (!cancelled) setInitializingUrl(null)
        return
      }
      try {
        const t = await getCloudflareTunnelStatus()
        if (t.running && t.url === initializingUrl) {
          if (!cancelled) setInitializingUrl(null)
          return
        }
      } catch {
        /* retry */
      }
      if (!cancelled) initPollRef.current = setTimeout(poll, 5000)
    }

    initPollRef.current = setTimeout(poll, 4000)
    return () => {
      cancelled = true
      if (initPollRef.current) clearTimeout(initPollRef.current)
    }
  }, [initializingUrl])

  async function saveAutoStart(enabled: boolean) {
    setAutoStartOverride(enabled)
    await updateMutation.mutateAsync({
      cloudflareTunnelEnabled: true,
      cloudflareTunnelAutoStart: enabled,
      mode: "cloudflare-tunnel",
    })
    toast.success(enabled ? "Tunnel will start with Arciin." : "Boot auto-start off.")
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/25">
            <Globe className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">Addresses</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              LAN for devices on your network · public URL for phones away from home
            </p>
          </div>
        </div>

        <div className="space-y-2 px-4 py-4 sm:px-5">
          {data?.loopbackUrl ? (
            <UrlChip
              label="This machine"
              value={data.loopbackUrl}
              onCopy={() => copyText(data.loopbackUrl!, "Loopback URL")}
            />
          ) : null}
          {lanUrls.map((url, i) => (
            <UrlChip
              key={url}
              label={lanUrls.length > 1 ? `LAN ${i + 1}` : "LAN"}
              value={url}
              onCopy={() => copyText(url, "LAN URL")}
            />
          ))}
        </div>

        <div className="border-t border-border px-4 py-4 sm:px-5">
          <label htmlFor="domain-public-url" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Public URL
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              id="domain-public-url"
              value={effective}
              placeholder="https://….trycloudflare.com"
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 font-mono text-[13px]"
            />
            {publicHref && !isInitializing ? (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => window.open(publicHref, "_blank", "noopener,noreferrer")}
              >
                Open
                <ExternalLink className="size-3.5 opacity-70" />
              </Button>
            ) : null}
            {isInitializing ? (
              <Button variant="outline" disabled className="shrink-0">
                <Loader2 className="size-3.5 animate-spin" />
                Starting…
              </Button>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={updateMutation.isPending}
              onClick={async () => {
                await updateMutation.mutateAsync({
                  publicUrl: effective === "" ? null : effective,
                })
                setDraft("")
                toast.success("Saved.")
              }}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/developer/web-sockets">WebSockets</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/25">
              <Cloud className="size-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Quick tunnel</h2>
              <p className="text-[12px] text-muted-foreground">trycloudflare.com · new URL each start</p>
            </div>
          </div>
          <StatusPill tone={tunnelTone}>
            {tunnel?.running ? (tunnel.stale ? "Starting" : "Live") : tunnel?.stale ? "Expired" : "Off"}
          </StatusPill>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {tunnel?.error && (tunnel.stale || !tunnel.running) ? (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
              {tunnel.error}
            </p>
          ) : null}

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-muted/15">
            <Checkbox
              checked={effectiveAutoStart}
              onCheckedChange={(v) => void saveAutoStart(v === true)}
              disabled={updateMutation.isPending}
            />
            <span className="text-[13px] text-foreground">Start tunnel when Arciin starts</span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={tunnelBusy}
              onClick={() => startTunnelMutation.mutate()}
            >
              {startTunnelMutation.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <Link2 className="size-3.5" />
                  Generate URL
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={tunnelBusy || !tunnel?.running}
              onClick={() => stopTunnelMutation.mutate()}
            >
              Stop
            </Button>
          </div>

          {data?.cloudflareTunnelEnabled ? (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Check className="size-3 text-emerald-600" />
              Tunnel mode on · paired phones get URL updates automatically
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Enable{" "}
              <Link href="/developer/web-sockets" className="text-primary hover:underline">
                Cloudflare tunnel mode
              </Link>{" "}
              under WebSockets.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
