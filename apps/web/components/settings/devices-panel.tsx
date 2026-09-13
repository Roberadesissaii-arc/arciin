"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Laptop, Monitor, Smartphone, Tablet } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  SectionHeader,
  SettingsCard,
  SettingsHint,
} from "@/components/settings/settings-panel-primitives"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import {
  cancelDevicePairing,
  generateDevicePairingCode,
  getConnectedDevices,
  revokeConnectedDevice,
} from "@/lib/api/settings"
import { disableComputerBackup } from "@/lib/api/computers"
import { queryKeys } from "@/lib/api/query-keys"
import { useAuth } from "@/hooks/use-auth"
import type { DevicePairingCodeResult, PairedDevicePublic } from "@/lib/types/models"
import { ApiError } from "@/lib/api/errors"

function platformLabel(platform: PairedDevicePublic["platform"]) {
  switch (platform) {
    case "WINDOWS":
      return "Windows"
    case "MACOS":
      return "macOS"
    case "LINUX":
      return "Linux"
    case "IOS":
      return "iOS"
    case "ANDROID":
      return "Android"
    default:
      return "Other"
  }
}

function typeLabel(type: PairedDevicePublic["deviceType"]) {
  switch (type) {
    case "DESKTOP":
      return "Desktop"
    case "LAPTOP":
      return "Laptop"
    case "PHONE":
      return "Phone"
    case "TABLET":
      return "Tablet"
    default:
      return "Device"
  }
}

function PlatformIcon({ platform }: { platform: PairedDevicePublic["platform"] }) {
  const className = "size-4 shrink-0 text-muted-foreground"
  if (platform === "IOS" || platform === "ANDROID") return <Smartphone className={className} />
  if (platform === "MACOS") return <Laptop className={className} />
  return <Monitor className={className} />
}

function formatBytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatRelative(iso: string | null) {
  if (!iso) return "Never"
  const then = new Date(iso).getTime()
  const delta = Date.now() - then
  if (delta < 45_000) return "just now"
  if (delta < 90_000) return "1 minute ago"
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} minutes ago`
  if (delta < 48 * 3_600_000) return `${Math.round(delta / 3_600_000)} hours ago`
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatPairedDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatCountdown(expiresAt: string) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now())
  const totalSeconds = Math.floor(remaining / 1000)
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0")
  const seconds = String(totalSeconds % 60).padStart(2, "0")
  return { label: `${minutes}:${seconds}`, expired: remaining <= 0 }
}

export function DevicesPanel() {
  const queryClient = useQueryClient()
  const authQuery = useAuth()
  const role = authQuery.data?.user.role
  const canManage = role === "OWNER" || role === "ADMIN"

  const [activeCode, setActiveCode] = useState<DevicePairingCodeResult | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [revokeTarget, setRevokeTarget] = useState<PairedDevicePublic | null>(null)
  const [disableTarget, setDisableTarget] = useState<PairedDevicePublic | null>(null)

  const devicesQuery = useQuery({
    queryKey: queryKeys.connectedDevices,
    queryFn: ({ signal }) => getConnectedDevices(signal),
    enabled: canManage,
  })

  useEffect(() => {
    if (!activeCode) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeCode])

  const countdown = useMemo(() => {
    if (!activeCode) return null
    void now
    return formatCountdown(activeCode.expiresAt)
  }, [activeCode, now])

  const generateMutation = useMutation({
    mutationFn: generateDevicePairingCode,
    onSuccess: (data) => {
      setActiveCode(data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectedDevices })
    },
    onError: (err) => {
      toast.error("Could not generate pairing code", {
        description: err instanceof Error ? err.message : "Try again.",
      })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: cancelDevicePairing,
    onSuccess: () => {
      setActiveCode(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectedDevices })
      toast.success("Pairing cancelled")
    },
    onError: (err) => {
      toast.error("Could not cancel pairing", {
        description: err instanceof Error ? err.message : "Try again.",
      })
    },
  })

  const disableBackupMutation = useMutation({
    mutationFn: async (device: PairedDevicePublic) => {
      if (!device.backup?.profileId) throw new Error("Backup profile not found.")
      return disableComputerBackup(device.backup.profileId)
    },
    onSuccess: (_data, device) => {
      setDisableTarget(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectedDevices })
      void queryClient.invalidateQueries({ queryKey: queryKeys.computers })
      toast.success(`Computer backup disabled for ${device.name}`)
    },
    onError: (err) => {
      toast.error("Could not disable computer backup", {
        description: err instanceof Error ? err.message : "Try again.",
      })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (device: PairedDevicePublic) => revokeConnectedDevice(device.id),
    onSuccess: (_data, device) => {
      setRevokeTarget(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectedDevices })
      toast.success(`${device.name} revoked`)
    },
    onError: (err) => {
      toast.error("Could not revoke device", {
        description: err instanceof Error ? err.message : "Try again.",
      })
    },
  })

  if (!canManage && authQuery.isLoading) {
    return <Skeleton className="h-72 rounded-2xl" />
  }

  if (!canManage) {
    return (
      <SettingsPanelError
        message="Only the owner or an administrator can manage trusted devices."
        hint="A paired device still requires a normal user sign-in before it can open files."
      />
    )
  }

  if (devicesQuery.isLoading) {
    return <Skeleton className="h-72 rounded-2xl" />
  }

  if (devicesQuery.isError || !devicesQuery.data) {
    const forbidden =
      devicesQuery.error instanceof ApiError && devicesQuery.error.status === 403
    return (
      <SettingsPanelError
        message={
          forbidden
            ? "Only the owner or an administrator can manage trusted devices."
            : devicesQuery.error instanceof Error
              ? devicesQuery.error.message
              : "Could not load devices."
        }
        hint="Check that the API is running, then refresh this page."
      />
    )
  }

  const snapshot = devicesQuery.data
  const devices = snapshot.devices
  const expired = countdown?.expired === true

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <SectionHeader
            icon={Monitor}
            title="Devices"
            description="Connect and manage computers and apps that have permission to connect to this Arciin server."
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <SettingsHint>
            Pairing trusts the device only. The person using it still signs in with their own
            Arciin account. Discovery on the local network grants no access by itself.
          </SettingsHint>
        </CardContent>
      </Card>

      <SettingsCard>
        <SectionHeader
          icon={Laptop}
          title="Connected devices"
          description={
            devices.length === 0
              ? "No trusted devices yet."
              : `${devices.length} trusted ${devices.length === 1 ? "device" : "devices"}`
          }
        />
        <div className="mt-4 space-y-3">
          {devices.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Generate a pairing code below after installing Arciin Desktop.
            </p>
          ) : (
            devices.map((device) => (
              <div
                key={device.id}
                className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={device.platform} />
                    <p className="truncate text-[13px] font-medium text-foreground">{device.name}</p>
                    <Badge variant="secondary" className="capitalize">
                      Active
                    </Badge>
                  </div>
                  <p className="text-[12px] text-zinc-500">
                    {platformLabel(device.platform)} · {typeLabel(device.deviceType)}
                  </p>
                  <p className="text-[12px] text-zinc-500">
                    Last seen {formatRelative(device.lastSeenAt)} · Paired {formatPairedDate(device.pairedAt)}
                  </p>
                  {device.backup ? (
                    <div className="pt-1 text-[12px] text-zinc-500" data-testid="device-backup-summary">
                      <p className="font-medium text-foreground">Computer Backup</p>
                      <p>
                        {device.backup.enabled
                          ? `${device.backup.rootCount} folders protected · ${formatBytesLabel(device.backup.byteCount)}`
                          : "Not enabled"}
                      </p>
                      {device.backup.enabled ? (
                        <p>
                          {device.backup.health.replaceAll("_", " ").toLowerCase()} · Last sync{" "}
                          {formatRelative(device.backup.lastSyncAt)}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="pt-1 text-[12px] text-zinc-500">Computer Backup is not enabled on this device.</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {device.backup?.enabled ? (
                    <>
                      <Button asChild variant="outline">
                        <Link href={`/computers/${device.id}`}>Manage Backup</Link>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setDisableTarget(device)}
                      >
                        Disable Backup
                      </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setRevokeTarget(device)}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </SettingsCard>

      <SettingsCard>
        <SectionHeader
          icon={Tablet}
          title="Connect a device"
          description="Use Arciin Desktop to discover this server, then enter a temporary pairing code."
        />

        {activeCode ? (
          <div className="mt-4 space-y-4" data-testid="device-pairing-code">
            <p className="text-[13px] text-muted-foreground">
              Enter this code in Arciin Desktop:
            </p>
            <p className="text-center font-mono text-4xl tracking-[0.35em] text-foreground">
              {expired ? "—— ——" : activeCode.displayCode}
            </p>
            {expired ? (
              <p className="text-center text-sm text-zinc-500">Pairing code expired.</p>
            ) : (
              <p className="text-center text-sm text-zinc-500">
                Expires in <span className="font-mono text-foreground">{countdown?.label}</span>
              </p>
            )}
            <div className="grid gap-2 text-[13px] sm:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Server</p>
                <p className="text-foreground">{snapshot.instanceName}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Local address
                </p>
                <p className="break-all text-foreground">{snapshot.localUrl ?? "Unavailable"}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {expired ? (
                <Button
                  type="button"
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                >
                  Generate New Code
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                >
                  Cancel Pairing
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <Button
              type="button"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              Generate Pairing Code
            </Button>
          </div>
        )}
      </SettingsCard>

      <AlertDialog open={Boolean(disableTarget)} onOpenChange={(open) => !open && setDisableTarget(null)}>
        <AlertDialogContent className="border-border bg-card text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Disable backup on {disableTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This revokes the background-sync credential and stops computer backup.
              The computer stays paired, and files already stored in Arciin are not
              deleted. Local files on the computer are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disableTarget && disableBackupMutation.mutate(disableTarget)}
            >
              Disable Backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent className="border-border bg-card text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revokeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This device will no longer be trusted. Associated sessions and computer-backup
              credentials will be revoked. Local files on the computer are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget)}
            >
              Revoke Device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
