"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Loader2, RefreshCw, Smartphone, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  createMobilePairingCode,
  getMobileConnectionSettings,
  revokeMobilePairingCode,
} from "@/lib/api/mobile"
import { queryKeys } from "@/lib/api/query-keys"
import { formatRelativeDate } from "@/lib/utils/format-date"

function formatCountdown(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return "Expired"
  const min = Math.floor(ms / 60_000)
  const sec = Math.floor((ms % 60_000) / 1000)
  return `${min}:${String(sec).padStart(2, "0")} left`
}

export function MobileConnectionPanel() {
  const queryClient = useQueryClient()
  const [revealedCode, setRevealedCode] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const settingsQuery = useQuery({
    queryKey: queryKeys.mobileConnection,
    queryFn: ({ signal }) => getMobileConnectionSettings(signal),
    refetchInterval: 30_000,
  })

  const generateMutation = useMutation({
    mutationFn: createMobilePairingCode,
    onSuccess: async (data) => {
      setRevealedCode(data.code)
      await queryClient.invalidateQueries({ queryKey: queryKeys.mobileConnection })
      toast.success("Connection code generated.")
    },
    onError: (e: Error) => toast.error(e.message || "Could not generate code."),
  })

  const revokeMutation = useMutation({
    mutationFn: revokeMobilePairingCode,
    onSuccess: async () => {
      setRevealedCode(null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.mobileConnection })
      toast.success("Connection code revoked.")
    },
    onError: (e: Error) => toast.error(e.message || "Could not revoke code."),
  })

  const active = settingsQuery.data?.activeCode
  const expiresAt = active?.expiresAt ?? null
  const displayCode = revealedCode
  const server = settingsQuery.data?.server
  const ttl = settingsQuery.data?.ttlMinutes ?? 10

  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  const countdown = useMemo(() => {
    void tick
    return expiresAt ? formatCountdown(expiresAt) : null
  }, [expiresAt, tick])

  const codeExpired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false
  const hasActiveCode = Boolean(active && !codeExpired)

  async function copyCode() {
    if (!displayCode) return
    try {
      await navigator.clipboard.writeText(displayCode)
      toast.success("Code copied.")
    } catch {
      toast.error("Could not copy to clipboard.")
    }
  }

  async function copyDiscoverUrl() {
    if (!server?.apiBaseUrl) return
    const url = `${server.apiBaseUrl.replace(/\/api$/, "")}/api/mobile/discover`
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Discover URL copied.")
    } catch {
      toast.error("Could not copy.")
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Smartphone className="size-5 text-primary" />
            Mobile connection
          </CardTitle>
          <CardDescription className="text-zinc-600">
            Generate a short-lived code so the Arciin mobile app can find this server and sign in.
            Codes expire after {ttl} minutes and work once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {hasActiveCode ? "Generate new code" : "Generate connection code"}
            </Button>
            {hasActiveCode ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => revokeMutation.mutate()}
                disabled={revokeMutation.isPending}
              >
                <X className="size-4" />
                Revoke code
              </Button>
            ) : null}
          </div>

          {displayCode ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Connection code
              </p>
              <p className="mt-2 font-mono text-4xl font-bold tracking-[0.35em] text-foreground">
                {displayCode}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                {countdown ? <span>{countdown}</span> : null}
                {active?.createdAt ? (
                  <span suppressHydrationWarning>
                    Created {formatRelativeDate(active.createdAt)}
                  </span>
                ) : null}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={copyCode}>
                <Copy className="size-4" />
                Copy code
              </Button>
            </div>
          ) : hasActiveCode ? (
            <p className="text-[13px] text-muted-foreground">
              A code is active but hidden on this screen. Generate a new code to display it again.
            </p>
          ) : null}

          <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-muted-foreground">
            <li>Open the Arciin mobile app on the same Wi‑Fi as this server.</li>
            <li>Choose <span className="font-medium text-foreground">Find server</span> or enter this server URL manually.</li>
            <li>Enter the connection code, then sign in with your Arciin email and password.</li>
          </ol>
        </CardContent>
      </Card>

      {server ? (
        <Card className="border-border bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Server endpoints</CardTitle>
            <CardDescription>
              The mobile app stores these after pairing. Use your LAN IP if you connect from phones on the same network.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel>Web app URL</FieldLabel>
              <Input readOnly value={server.webUrl} className="font-mono text-[12px]" />
            </Field>
            <Field>
              <FieldLabel>API base URL</FieldLabel>
              <Input readOnly value={server.apiBaseUrl} className="font-mono text-[12px]" />
              <FieldDescription>
                Discovery: <span className="font-mono">{server.apiBaseUrl}/mobile/discover</span>
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Socket URL</FieldLabel>
              <Input readOnly value={server.socketUrl} className="font-mono text-[12px]" />
            </Field>
            {server.requestOrigin ? (
              <Field>
                <FieldLabel>Detected from this browser</FieldLabel>
                <Input readOnly value={server.requestOrigin} className="font-mono text-[12px]" />
                <FieldDescription>
                  If Web URL shows localhost, the mobile app should try this host on your LAN instead.
                </FieldDescription>
              </Field>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={copyDiscoverUrl}>
              <Copy className="size-4" />
              Copy discover API URL
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
