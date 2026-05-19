"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Loader2, LogOut, RefreshCw, Smartphone, Tablet, X } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  createMobilePairingCode,
  getMobileConnectionSettings,
  revokeMobileDevice,
  revokeMobilePairingCode,
} from "@/lib/api/mobile"
import { queryKeys } from "@/lib/api/query-keys"
import type { MobileConnectedDevice } from "@/lib/types/models"
import { formatDateTime, formatRelativeDate } from "@/lib/utils/format-date"
import { formatSessionIp } from "@/lib/utils/session-ip"
import { cn } from "@/lib/utils"

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

  const revokeDeviceMutation = useMutation({
    mutationFn: revokeMobileDevice,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.mobileConnection })
      toast.success("Mobile device disconnected.")
    },
    onError: (e: Error) => toast.error(e.message || "Could not disconnect device."),
  })

  const active = settingsQuery.data?.activeCode
  const expiresAt = active?.expiresAt ?? null
  const displayCode = revealedCode
  const server = settingsQuery.data?.server
  const devices = settingsQuery.data?.devices ?? []
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

  const codeExpired = countdown === "Expired"
  const hasActiveCode = Boolean(active && !codeExpired)

  const loadErrorMessage =
    settingsQuery.error instanceof Error ? settingsQuery.error.message : null
  const migrationRequired =
    loadErrorMessage?.includes("migrate deploy") ||
    loadErrorMessage?.includes("DATABASE_MIGRATION_REQUIRED")

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
          {settingsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>
                {migrationRequired ? "Database update required" : "Could not load mobile connection"}
              </AlertTitle>
              <AlertDescription className="text-[13px] leading-relaxed">
                {migrationRequired ? (
                  <>
                    Mobile pairing needs a newer database schema. On the server run:{" "}
                    <code className="rounded bg-black/20 px-1 py-0.5 font-mono text-[12px]">
                      pnpm exec prisma migrate deploy
                    </code>
                    , then restart the API and refresh this page.
                  </>
                ) : (
                  loadErrorMessage ?? "An unexpected error occurred."
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending || settingsQuery.isError}
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

      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Connected devices</CardTitle>
          <CardDescription>
            Phones and tablets signed in with the Arciin mobile app. Each device keeps its own session;
            disconnect one to sign it out without affecting others.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settingsQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : devices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-[13px] text-muted-foreground">
              No mobile devices connected yet. Generate a code above and pair the Arciin app on your phone.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {devices.map((device) => (
                <MobileDeviceRow
                  key={device.id}
                  device={device}
                  revoking={revokeDeviceMutation.isPending && revokeDeviceMutation.variables === device.id}
                  onRevoke={() => revokeDeviceMutation.mutate(device.id)}
                />
              ))}
            </ul>
          )}
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

function MobileDeviceRow({
  device,
  revoking,
  onRevoke,
}: {
  device: MobileConnectedDevice
  revoking: boolean
  onRevoke: () => void
}) {
  const isTablet =
    /ipad|tablet/i.test(device.deviceName) || /tablet/i.test(device.userAgent ?? "")

  return (
    <li className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground",
          )}
        >
          {isTablet ? <Tablet className="size-5" /> : <Smartphone className="size-5" />}
        </div>
        <div className="min-w-0 space-y-2">
          <div>
            <p className="truncate text-sm font-medium text-foreground">{device.deviceName}</p>
            <p className="truncate text-[12px] text-muted-foreground">
              {device.userName} · {device.userEmail}
            </p>
          </div>
          <dl className="grid gap-1.5 text-[12px] sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">IP address</dt>
              <dd className="font-mono text-foreground">{formatSessionIp(device.ipAddress)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Session</dt>
              <dd className="font-mono text-[11px] text-foreground/80">{device.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Connected</dt>
              <dd className="text-foreground" title={formatDateTime(device.createdAt)}>
                {formatRelativeDate(device.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Expires</dt>
              <dd className="text-foreground" title={formatDateTime(device.expiresAt)}>
                {formatRelativeDate(device.expiresAt)}
              </dd>
            </div>
            {device.userAgent ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">User agent</dt>
                <dd className="break-all font-mono text-[11px] text-foreground/80">
                  {device.userAgent}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={revoking}
        onClick={onRevoke}
      >
        {revoking ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
        Disconnect
      </Button>
    </li>
  )
}
