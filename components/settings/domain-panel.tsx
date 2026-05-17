"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Cloud, ExternalLink, Link2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  getCloudflareTunnelStatus,
  getRemoteAccessSettings,
  startCloudflareTunnel,
  stopCloudflareTunnel,
  updateRemoteAccessSettings,
} from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

export function DomainPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: queryKeys.remoteAccessSettings,
    queryFn: ({ signal }) => getRemoteAccessSettings(signal),
  })
  const tunnelQuery = useQuery({
    queryKey: queryKeys.cloudflareTunnel,
    queryFn: ({ signal }) => getCloudflareTunnelStatus(signal),
    refetchInterval: (q) => (q.state.data?.running ? 10_000 : false),
  })

  const updateMutation = useMutation({
    mutationFn: (publicUrl: string | null) =>
      updateRemoteAccessSettings({
        publicUrl,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.remoteAccessSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnel }),
      ])
      toast.success("Public URL updated.")
    },
    onError: (e: Error) => toast.error(e.message || "Could not save domain."),
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
        toast.success("Tunnel started — URL appears above. Initializing, please wait…")
      }
    },
    onError: (e: Error) => toast.error(e.message || "Could not start Cloudflare tunnel."),
  })

  const stopTunnelMutation = useMutation({
    mutationFn: stopCloudflareTunnel,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.cloudflareTunnel })
      toast.success("Cloudflare tunnel stopped.")
    },
    onError: (e: Error) => toast.error(e.message || "Could not stop tunnel."),
  })

  const [draft, setDraft] = useState("")
  const [initializingUrl, setInitializingUrl] = useState<string | null>(null)
  const initPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const data = settingsQuery.data
  const tunnel = tunnelQuery.data
  const effective = (draft || data?.publicUrl || "").trim()
  const publicHref = /^https?:\/\//i.test(effective) ? effective : null
  const tunnelBusy = startTunnelMutation.isPending || stopTunnelMutation.isPending
  const isInitializing = Boolean(initializingUrl && initializingUrl === publicHref)

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
        await fetch(initializingUrl!, { method: "HEAD", mode: "no-cors", signal: AbortSignal.timeout(5000) })
        if (!cancelled) setInitializingUrl(null)
      } catch {
        if (!cancelled) initPollRef.current = setTimeout(poll, 5000)
      }
    }

    initPollRef.current = setTimeout(poll, 4000)

    return () => {
      cancelled = true
      if (initPollRef.current) clearTimeout(initPollRef.current)
    }
  }, [initializingUrl])

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardHeader className="space-y-0 text-left">
          <div className="flex items-start gap-3 pr-2">
            <Link2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1.5">
              <CardTitle className="text-left text-foreground">Domain</CardTitle>
              <CardDescription className="text-left text-zinc-600">
                <strong className="text-foreground">Local</strong> is this machine or LAN only.{" "}
                <strong className="text-foreground">Public</strong> is the HTTPS URL Arciin uses for links and
                callbacks—your own hostname or a Cloudflare quick tunnel (
                <code className="text-foreground">trycloudflare.com</code>).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {data && (
            <Field>
              <FieldLabel htmlFor="domain-local-url">Local base URL</FieldLabel>
              <FieldDescription>Used on this host until a public URL is set.</FieldDescription>
              <Input
                id="domain-local-url"
                readOnly
                value={data.localUrl ?? ""}
                className="font-mono text-muted-foreground"
                tabIndex={-1}
              />
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="domain-public-url">Public base URL</FieldLabel>
            <FieldDescription>
              Paste a URL manually or generate one with Cloudflare below. WebSocket ingress options are in{" "}
              <Link href="/developer/web-sockets" className="font-medium text-primary hover:underline">
                Developer → WebSockets
              </Link>
              .
            </FieldDescription>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                id="domain-public-url"
                value={effective}
                placeholder="https://xxxx.trycloudflare.com or https://arciin.example.com"
                onChange={(e) => setDraft(e.target.value)}
                disabled={settingsQuery.isLoading}
                className="min-w-0 flex-1 font-mono"
              />
              {publicHref ? (
                isInitializing ? (
                  <Button variant="outline" disabled className="shrink-0 border-border">
                    <Loader2 className="mr-2 size-3.5 animate-spin" aria-hidden />
                    Initializing…
                  </Button>
                ) : (
                  <Button asChild variant="outline" className="shrink-0 border-border">
                    <a href={publicHref} target="_blank" rel="noopener noreferrer">
                      Open
                      <ExternalLink className="ml-2 size-3.5 opacity-80" aria-hidden />
                    </a>
                  </Button>
                )
              ) : null}
            </div>
            {isInitializing && (
              <p className="text-[12px] text-amber-600">
                Tunnel is starting — this takes about 30–60 seconds. The Open button will activate once the URL is reachable.
              </p>
            )}
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-primary text-white hover:bg-primary/90"
              disabled={updateMutation.isPending || settingsQuery.isLoading}
              onClick={async () => {
                const trimmed = effective
                try {
                  await updateMutation.mutateAsync(trimmed === "" ? null : trimmed)
                  setDraft("")
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not save domain.")
                }
              }}
            >
              {updateMutation.isPending ? "Saving…" : "Save public URL"}
            </Button>
            <Button variant="outline" asChild className="border-border">
              <Link href="/developer/web-sockets" className="gap-1">
                WebSockets playbook
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="space-y-0 text-left">
          <div className="flex items-start gap-3 pr-2">
            <Cloud className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1.5">
              <CardTitle className="text-left text-foreground">Cloudflare quick tunnel</CardTitle>
              <CardDescription className="text-left text-zinc-600">
                Runs <code className="text-foreground">cloudflared</code> on this server and publishes a random{" "}
                <code className="text-foreground">trycloudflare.com</code> URL. Requires{" "}
                <code className="text-foreground">cloudflared</code> installed on the host (not bundled with Arciin).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {tunnel?.running ? (
              <>
                <span className="font-medium text-emerald-700">Tunnel running.</span> The URL is in{" "}
                <span className="font-medium text-foreground">Public base URL</span> above—use Open to visit it.
              </>
            ) : (
              <>
                Generate a temporary public URL without opening firewall ports. The URL is written into{" "}
                <span className="font-medium text-foreground">Public base URL</span> and changes each time you start a
                new quick tunnel.
              </>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-primary text-white hover:bg-primary/90"
              disabled={tunnelBusy || settingsQuery.isLoading}
              onClick={() => startTunnelMutation.mutate()}
            >
              {startTunnelMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Starting tunnel…
                </>
              ) : (
                "Generate public URL"
              )}
            </Button>
            <Button
              variant="outline"
              className="border-border"
              disabled={tunnelBusy || !tunnel?.running}
              onClick={() => stopTunnelMutation.mutate()}
            >
              {stopTunnelMutation.isPending ? "Stopping…" : "Stop tunnel"}
            </Button>
          </div>

          {data?.cloudflareTunnelEnabled ? (
            <p className="text-xs text-muted-foreground">Cloudflare tunnel mode is enabled for this instance.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
