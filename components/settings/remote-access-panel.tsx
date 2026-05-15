"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Router, Server } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getRemoteAccessSettings, updateRemoteAccessSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-start gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors"
      style={{
        background: checked ? "rgba(255,75,51,0.06)" : "transparent",
        borderColor: checked ? "rgba(255,75,51,0.25)" : "var(--border)",
      }}
    >
      <div
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors"
        style={{
          borderColor: checked ? "#FF4F12" : "#d4d4d8",
          background: checked ? "#FF4F12" : "transparent",
        }}
      >
        {checked && (
          <svg viewBox="0 0 10 8" className="size-2.5" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        )}
      </div>
      <div>
        <p className="text-[13px] font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
      </div>
    </button>
  )
}

export function RemoteAccessPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: queryKeys.remoteAccessSettings,
    queryFn: ({ signal }) => getRemoteAccessSettings(signal),
  })
  const updateMutation = useMutation({
    mutationFn: updateRemoteAccessSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.remoteAccessSettings })
    },
    onError: (e: Error) => toast.error(e.message || "Could not update remote access settings."),
  })

  const [reverseProxy, setReverseProxy] = useState<boolean | null>(null)
  const [cloudflareTunnel, setCloudflareTunnel] = useState<boolean | null>(null)

  const data = settingsQuery.data
  const effectiveReverseProxy = reverseProxy ?? data?.reverseProxyEnabled ?? false
  const effectiveCloudflareTunnel = cloudflareTunnel ?? data?.cloudflareTunnelEnabled ?? false

  return (
    <Card className="border-border bg-card">
      <CardHeader className="space-y-0 text-left">
        <div className="flex items-start gap-3 pr-2">
          <Router className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1.5">
            <CardTitle className="text-left text-foreground">WebSockets</CardTitle>
            <CardDescription className="text-left text-zinc-600">
              Tunnels and reverse proxies so browsers (and WebSocket upgrades) can reach this instance. Arciin does not
              install <code className="text-foreground">cloudflared</code>—you run it on the server. Put the URL
              Cloudflare prints (or your own hostname) under{" "}
              <Link href="/settings?tab=domain" className="font-medium text-primary underline-offset-4 hover:underline">
                Settings → Domain → Public base URL
              </Link>
              .
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Install snippets and nginx samples are in{" "}
          <Link href="/docs#remote-access" className="font-medium text-primary underline-offset-4 hover:underline">
            Documentation → WebSockets &amp; public URL
          </Link>
          . Set the advertised HTTPS origin under{" "}
          <Link href="/settings?tab=domain" className="font-medium text-primary underline-offset-4 hover:underline">
            Settings → Domain
          </Link>
          .
        </p>

        {data && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
              <Server className="size-3.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-[11px] text-zinc-500">Local URL</p>
                <p className="truncate font-mono text-[12px] text-foreground">{data.localUrl}</p>
              </div>
            </div>
            <div className="flex flex-1 flex-col justify-center rounded-xl border border-border bg-muted/40 px-4 py-3 text-[12px] text-muted-foreground">
              <p className="text-[11px] font-medium text-zinc-500">Public URL</p>
              <p>
                Edit under{" "}
                <Link href="/settings?tab=domain" className="font-medium text-primary underline-offset-4 hover:underline">
                  Settings → Domain
                </Link>
                {data.publicUrl ? (
                  <>
                    {" "}
                    <span className="text-zinc-600">· current</span>{" "}
                    <span className="font-mono text-foreground">{data.publicUrl}</span>
                  </>
                ) : (
                  <span className="text-zinc-600"> — not set yet</span>
                )}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Access mode</p>
          <ToggleRow
            label="Cloudflare Tunnel mode"
            description="Use when cloudflared forwards HTTPS (and WebSockets) to this machine. Enables the free trycloudflare.com flow above; Arciin still does not bundle the Cloudflare agent."
            checked={effectiveCloudflareTunnel}
            onChange={(v) => { setCloudflareTunnel(v); if (v) setReverseProxy(false) }}
          />
          <ToggleRow
            label="Reverse proxy mode"
            description="Use Caddy, Nginx, or any upstream proxy. Arciin trusts that TLS is terminated before it."
            checked={effectiveReverseProxy}
            onChange={(v) => { setReverseProxy(v); if (v) setCloudflareTunnel(false) }}
          />
        </div>

        <Button
          className="bg-primary text-white hover:bg-primary/90"
          disabled={updateMutation.isPending}
          onClick={async () => {
            try {
              await updateMutation.mutateAsync({
                mode: effectiveCloudflareTunnel ? "cloudflare-tunnel" : effectiveReverseProxy ? "reverse-proxy" : "local",
                reverseProxyEnabled: effectiveReverseProxy,
                cloudflareTunnelEnabled: effectiveCloudflareTunnel,
              })
              toast.success("WebSockets settings updated.")
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not update remote access.")
            }
          }}
        >
          {updateMutation.isPending ? "Saving…" : "Save WebSockets settings"}
        </Button>
      </CardContent>
    </Card>
  )
}
