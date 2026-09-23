"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  Cloud,
  Copy,
  ExternalLink,
  Globe,
  Link2,
  Loader2,
  TriangleAlert,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

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
import { copyToClipboard } from "@/lib/utils/clipboard"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"

function copyText(value: string, label: string) {
  void copyToClipboard(value, label)
}

function UrlChip({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  /** Omitted when there is nothing to copy — an unset address renders inert. */
  onCopy?: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/15 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-[12px] text-foreground">{value}</p>
      </div>
      {onCopy ? (
        <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={onCopy}>
          <Copy className="size-3.5" />
          <span className="sr-only">Copy {label}</span>
        </Button>
      ) : null}
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
    onError: (e: Error) =>
      toast.error("Could not save", { description: e.message || "Try again in a moment." }),
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
        toast.success("Public URL ready.", {
          description: "Your Cloudflare Tunnel is live and reachable from the internet.",
        })
      }
    },
    onError: (e: Error) =>
      toast.error("Could not start tunnel", {
        description: e.message || "Check your network and try again.",
      }),
  })

  const stopTunnelMutation = useMutation({
    mutationFn: stopCloudflareTunnel,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnel })
      toast.success("Tunnel stopped.", {
        description: "This instance is no longer reachable through the public URL.",
      })
    },
    onError: (e: Error) =>
      toast.error("Could not stop tunnel", { description: e.message || "Try again in a moment." }),
  })

  const [draft, setDraft] = useState("")
  const [autoStartOverride, setAutoStartOverride] = useState<boolean | undefined>(undefined)
  const [initializingUrl, setInitializingUrl] = useState<string | null>(null)
  const initPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const data = settingsQuery.data
  const tunnel = tunnelQuery.data
  const effective = (draft || data?.publicUrl || "").trim()

  /**
   * The two advertised entry points.
   *
   * `mobilePublicUrl` is stored separately from `publicUrl` for historical
   * reasons — there used to be a second, mobile-only tunnel. Only one tunnel
   * can exist, so these should now always agree; showing both is what makes a
   * disagreement (a stale value left over from the old behaviour) visible
   * instead of silent.
   */
  const desktopPublicUrl = data?.publicUrl?.trim() || null
  const mobilePublicUrl = data?.mobilePublicUrl?.trim() || null
  const addressesMatch =
    !mobilePublicUrl ||
    !desktopPublicUrl ||
    mobilePublicUrl.replace(/\/+$/, "") === desktopPublicUrl.replace(/\/+$/, "")
  const publicHref = /^https?:\/\//i.test(effective) ? effective : null
  const tunnelBusy = startTunnelMutation.isPending || stopTunnelMutation.isPending
  const isInitializing = Boolean(initializingUrl && initializingUrl === publicHref)
  const effectiveAutoStart = autoStartOverride ?? data?.cloudflareTunnelAutoStart ?? true

  const lanUrls =
    data?.lanUrls?.length
      ? data.lanUrls
      : [data?.primaryLanUrl, data?.localUrl].filter((u): u is string => Boolean(u))

  /**
   * The mobile PWA's own addresses, shown only when they add something.
   *
   * On a host where both apps answer on the same interface these differ only
   * by port, which is worth saying; an address already listed above is not.
   */
  const mobileLanUrls = (data?.mobileLocal?.lanUrls ?? []).filter(
    (url) => !lanUrls.includes(url),
  )

  /** Whether there is a mobile surface for the proxy to route phones to. */
  const mobileSurfaceAvailable = Boolean(
    data?.mobileLocal?.primaryLanUrl || data?.mobileLocal?.loopbackUrl,
  )

  /**
   * What the tunnel is actually doing, not whether a process exists.
   *
   * "Live" used to mean a cloudflared process was alive. A quick tunnel can
   * hold a live process and a registered hostname while Cloudflare's edge
   * returns 404 for that hostname, and the panel called that Live while the
   * address did nothing. Live now requires the public URL to have answered.
   */
  const tunnelStatus: {
    label: "Live" | "Starting" | "Unavailable" | "Expired" | "Off"
    tone: "ok" | "warn" | "off"
  } = (() => {
    if (!tunnel?.running) {
      if (tunnel?.stale) return { label: "Expired", tone: "warn" }
      return { label: "Off", tone: "off" }
    }
    if (tunnel.reachable === true) return { label: "Live", tone: "ok" }
    if (tunnel.reachable === false) return { label: "Unavailable", tone: "warn" }
    // Not determined yet — a fresh tunnel takes 30–60s to answer.
    return { label: "Starting", tone: "warn" }
  })()
  const tunnelTone = tunnelStatus.tone

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
    toast.success(enabled ? "Tunnel will start with Arciin." : "Boot auto-start off.", {
      description: enabled
        ? "The Cloudflare Tunnel launches automatically the next time Arciin starts."
        : "You'll need to start the tunnel manually next time.",
    })
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <SettingsPanelError
        message={
          settingsQuery.error instanceof Error
            ? settingsQuery.error.message
            : "Could not load domain settings."
        }
        hint="Check that the API is running, then refresh this page."
      />
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

        {/*
          Desktop and mobile listen on different ports, and these rows used to
          be built entirely from the mobile resolver — so every address here,
          including "This machine", showed the mobile port and presented it as
          the server's address. Each row now says which app it reaches.
        */}
        <div className="space-y-2 px-4 py-4 sm:px-5">
          {data?.loopbackUrl ? (
            <UrlChip
              label="This machine"
              value={data.loopbackUrl}
              onCopy={() => copyText(data.loopbackUrl!, "Loopback URL")}
            />
          ) : null}
          {lanUrls.map((url) => (
            <UrlChip
              key={url}
              label={lanUrls.length > 1 ? "Desktop · LAN" : "Desktop"}
              value={url}
              onCopy={() => copyText(url, "Desktop LAN URL")}
            />
          ))}
          {mobileLanUrls.map((url) => (
            <UrlChip
              key={url}
              label={mobileLanUrls.length > 1 ? "Mobile · LAN" : "Mobile"}
              value={url}
              onCopy={() => copyText(url, "Mobile LAN URL")}
            />
          ))}
        </div>

        {/* Desktop and mobile are two named entry points, so the panel says so
            explicitly. One tunnel serves both — apps/web/proxy.ts picks the app
            per device — so these normally match, and saying "same link" out
            loud is more reassuring than showing one address and leaving the
            reader to wonder what the phone is supposed to use. */}
        <div className="border-t border-border px-4 py-4 sm:px-5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Public addresses
          </p>

          {desktopPublicUrl || mobilePublicUrl ? (
            <div className="mt-2 space-y-2">
              <UrlChip
                label="Desktop"
                value={desktopPublicUrl ?? "Not set"}
                onCopy={
                  desktopPublicUrl
                    ? () => copyText(desktopPublicUrl, "Desktop URL")
                    : undefined
                }
              />
              <UrlChip
                label="Mobile"
                value={mobilePublicUrl ?? desktopPublicUrl ?? "Not set"}
                onCopy={
                  (mobilePublicUrl ?? desktopPublicUrl)
                    ? () => copyText((mobilePublicUrl ?? desktopPublicUrl)!, "Mobile URL")
                    : undefined
                }
              />

              <div
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed",
                  addressesMatch
                    ? "border-border bg-muted/25 text-muted-foreground"
                    : "border-amber-500/40 bg-amber-500/10 text-foreground",
                )}
              >
                {addressesMatch ? (
                  <>
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    {/*
                      Only claimed when a mobile surface actually exists to route
                      to. The tunnel forwards to the desktop app and proxy.ts
                      rewrites phone user agents to the mobile app; without a
                      resolvable mobile origin that rewrite never happens and a
                      phone simply gets the desktop app, so promising otherwise
                      would be a guess dressed as a fact.
                    */}
                    <span>
                      <span className="font-medium text-foreground">Same link for both.</span>{" "}
                      {mobileSurfaceAvailable
                        ? "Open it on a phone and you get the mobile app; on a computer you get the full desktop app. There is nothing separate to remember."
                        : "The mobile app is not reachable on this server right now, so this link opens the desktop app on every device."}
                    </span>
                  </>
                ) : (
                  <>
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                    <span>
                      <span className="font-medium">These differ.</span> Only one tunnel can run
                      at a time, so one of these is stale and will not load. Generate a new URL
                      to put both back on the same address.
                    </span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground">
              No public address yet. Generate one below to reach this server from outside your
              network.
            </p>
          )}
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
                toast.success("Saved.", {
                  description: "Your public URL is updated for this instance.",
                })
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
            {tunnelStatus.label}
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
