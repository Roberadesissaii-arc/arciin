"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Check, CircleCheck, Copy, EllipsisVertical, Laptop, Monitor, Smartphone, Tablet } from "lucide-react"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { computerSourceValue, filesSourceHref } from "@/lib/utils/library-asset-pipeline"
import { useAuth } from "@/hooks/use-auth"
import type { DevicePairingCodeResult, PairedDevicePublic } from "@/lib/types/models"
import { ApiError } from "@/lib/api/errors"
import { devicePresenceLabel, isArciinDesktopWebView, requestNativeComputerBackupSetup, resolveDevicePresence } from "@arciin/shared"
import { cn } from "@/lib/utils"
import { copyToClipboard } from "@/lib/utils/clipboard"

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
  const className = "size-5 shrink-0 text-zinc-600"
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

function formatCountdown(expiresAt: string) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now())
  const totalSeconds = Math.floor(remaining / 1000)
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0")
  const seconds = String(totalSeconds % 60).padStart(2, "0")
  return { label: `${minutes}:${seconds}`, expired: remaining <= 0 }
}

function PairingMetaTile({
  label,
  value,
  mono,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  onCopy?: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">{label}</p>
        <p
          className={cn(
            "mt-1 break-all text-[13px] text-zinc-900",
            mono && "font-mono text-[12px] tracking-tight",
          )}
        >
          {value}
        </p>
      </div>
      {onCopy ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-zinc-500 hover:text-zinc-900"
          onClick={onCopy}
        >
          <Copy className="size-3.5" />
          <span className="sr-only">Copy {label}</span>
        </Button>
      ) : null}
    </div>
  )
}

function backupHealthLabel(health: NonNullable<PairedDevicePublic["backup"]>["health"]) {
  switch (health) {
    case "UP_TO_DATE":
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

function useArciinDesktopWebView() {
  return useSyncExternalStore(
    () => () => {},
    isArciinDesktopWebView,
    () => false,
  )
}

function requestBackupSetup(browserMessage: string) {
  try {
    if (requestNativeComputerBackupSetup()) return
  } catch {
    // Missing WebView must never throw in a browser.
  }
    toast.info(browserMessage)
}

function DeviceOverflowMenu({
  testId,
  children,
}: {
  testId: string
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-zinc-500 hover:text-zinc-900"
          aria-label="More device actions"
          data-testid={testId}
        >
          <EllipsisVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

function DeviceCard({
  device,
  inDesktop,
  onDisableBackup,
  onDisconnect,
  onRevoke,
}: {
  device: PairedDevicePublic
  inDesktop: boolean
  onDisableBackup: (device: PairedDevicePublic) => void
  onDisconnect: (device: PairedDevicePublic) => void
  onRevoke: (device: PairedDevicePublic) => void
}) {
  const isCurrent = device.isCurrentDevice === true
  const presence = resolveDevicePresence({
    isCurrentDevice: isCurrent,
    lastSeenAt: device.lastSeenAt,
  })
  const backup = device.backup
  const backupEnabled = Boolean(backup?.enabled)
  const viewBackupHref = filesSourceHref(computerSourceValue(device.id))

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white p-4"
      data-testid={isCurrent ? "device-card-current" : "device-card-other"}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
          <PlatformIcon platform={device.platform} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[14px] font-medium text-zinc-900">{device.name}</p>
            {isCurrent ? (
              <Badge variant="outline" className="border-[#FF4F12]/30 bg-[#FF4F12]/10 text-[#FF4F12]">
                This device
              </Badge>
            ) : null}
            <Badge variant="secondary">{devicePresenceLabel(presence)}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-zinc-500">
            {platformLabel(device.platform)} · {typeLabel(device.deviceType)}
          </p>
          <p className="text-[13px] text-zinc-500">Last seen {formatRelative(device.lastSeenAt)}</p>

          <div
            className="mt-3 border-t border-zinc-200/80 pt-3 text-[13px] text-zinc-500"
            data-testid="device-backup-summary"
          >
            <p className="font-medium text-zinc-900">Computer Backup</p>
            {backupEnabled && backup ? (
              <div className="mt-1 space-y-0.5">
                <p>{backupHealthLabel(backup.health)}</p>
                <p>
                  {backup.rootCount} {backup.rootCount === 1 ? "folder" : "folders"} protected
                </p>
                {backup.byteCount > 0 ? <p>{formatBytesLabel(backup.byteCount)}</p> : null}
                <p>Last backup {formatRelative(backup.lastSyncAt)}</p>
                {isCurrent && !inDesktop ? (
                  <p>Open Arciin Desktop to manage protected folders.</p>
                ) : null}
              </div>
            ) : (
              <div className="mt-1 space-y-0.5">
                <p>Not enabled</p>
                {isCurrent && !inDesktop ? (
                  <p>Open Arciin Desktop to turn on backup.</p>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-end gap-1">
            {isCurrent && !backupEnabled ? (
              <Button
                type="button"
                size="sm"
                data-testid="turn-on-backup"
                onClick={() => requestBackupSetup("Open Arciin Desktop to turn on backup.")}
              >
                Turn On Backup
              </Button>
            ) : null}

            {isCurrent && backupEnabled ? (
              <Button
                type="button"
                size="sm"
                data-testid="manage-backup"
                onClick={() =>
                  requestBackupSetup("Open Arciin Desktop to manage protected folders.")
                }
              >
                Manage Backup
              </Button>
            ) : null}

            {!isCurrent && backupEnabled ? (
              <Button asChild size="sm">
                <Link href={viewBackupHref} data-testid="view-backup">
                  View Backup
                </Link>
              </Button>
            ) : null}

            {isCurrent ? (
              <DeviceOverflowMenu testId="current-device-menu">
                {backupEnabled ? (
                  <>
                    <DropdownMenuItem
                      data-testid="disable-backup"
                      onSelect={() => onDisableBackup(device)}
                    >
                      Disable Backup
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem
                  variant="destructive"
                  data-testid="disconnect-this-computer"
                  onSelect={() => onDisconnect(device)}
                >
                  Disconnect this computer
                </DropdownMenuItem>
              </DeviceOverflowMenu>
            ) : (
              <DeviceOverflowMenu testId="other-device-menu">
                {backupEnabled ? (
                  <DropdownMenuItem
                    data-testid="disable-backup"
                    onSelect={() => onDisableBackup(device)}
                  >
                    Disable Backup
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  variant="destructive"
                  data-testid="revoke-access"
                  onSelect={() => onRevoke(device)}
                >
                  Revoke access
                </DropdownMenuItem>
              </DeviceOverflowMenu>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function DevicesPanel() {
  const queryClient = useQueryClient()
  const authQuery = useAuth()
  const role = authQuery.data?.user.role
  const canManage = role === "OWNER" || role === "ADMIN"
  const inDesktop = useArciinDesktopWebView()

  const [activeCode, setActiveCode] = useState<DevicePairingCodeResult | null>(null)
  const [pairedSuccess, setPairedSuccess] = useState<PairedDevicePublic | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [revokeTarget, setRevokeTarget] = useState<PairedDevicePublic | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<PairedDevicePublic | null>(null)
  const [disableTarget, setDisableTarget] = useState<PairedDevicePublic | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const knownDeviceIdsRef = useRef<Set<string>>(new Set())

  const devicesQuery = useQuery({
    queryKey: queryKeys.connectedDevices,
    queryFn: ({ signal }) => getConnectedDevices(signal),
    enabled: canManage,
    refetchInterval: activeCode ? 2_000 : false,
  })

  useEffect(() => {
    if (!activeCode) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeCode])

  useEffect(() => {
    if (!codeCopied) return
    const timer = window.setTimeout(() => setCodeCopied(false), 2_000)
    return () => window.clearTimeout(timer)
  }, [codeCopied])

  const countdown = useMemo(() => {
    if (!activeCode) return null
    void now
    return formatCountdown(activeCode.expiresAt)
  }, [activeCode, now])

  useEffect(() => {
    if (!activeCode || !devicesQuery.data) return
    if (knownDeviceIdsRef.current.size === 0) return
    const connected = devicesQuery.data.devices.find(
      (device) => !knownDeviceIdsRef.current.has(device.id),
    )
    if (connected) {
      setPairedSuccess(connected)
      setActiveCode(null)
      setCodeCopied(false)
      toast.success(`${connected.name} is connected`, {
        description: "The pairing code was used and will not work again.",
      })
    }
  }, [activeCode, devicesQuery.data])

  const generateMutation = useMutation({
    mutationFn: generateDevicePairingCode,
    onSuccess: (data) => {
      knownDeviceIdsRef.current = new Set(
        (devicesQuery.data?.devices ?? []).map((device) => device.id),
      )
      setPairedSuccess(null)
      setCodeCopied(false)
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
      setCodeCopied(false)
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
      setDisconnectTarget(null)
      if (pairedSuccess?.id === device.id) setPairedSuccess(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectedDevices })
      void queryClient.invalidateQueries({ queryKey: queryKeys.computers })
      toast.success(
        device.isCurrentDevice ? `${device.name} disconnected` : `Access revoked for ${device.name}`,
      )
    },
    onError: (err) => {
      toast.error("Could not update this device", {
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
  const currentDevices = devices.filter((device) => device.isCurrentDevice)
  const otherDevices = devices.filter((device) => !device.isCurrentDevice)
  const localAddress = snapshot.localUrl ?? "Unavailable"

  async function copyPairingCode() {
    if (!activeCode || expired) return
    const ok = await copyToClipboard(activeCode.code, "Pairing code")
    if (ok) setCodeCopied(true)
  }

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
        <div className="mt-4 space-y-5">
          {devices.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Generate a pairing code below after installing Arciin Desktop.
            </p>
          ) : (
            <>
              {currentDevices.length > 0 ? (
                <section className="space-y-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    This device
                  </h3>
                  {currentDevices.map((device) => (
                    <DeviceCard
                      key={device.id}
                      device={device}
                      inDesktop={inDesktop}
                      onDisableBackup={setDisableTarget}
                      onDisconnect={setDisconnectTarget}
                      onRevoke={setRevokeTarget}
                    />
                  ))}
                </section>
              ) : null}
              {otherDevices.length > 0 ? (
                <section className="space-y-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Other devices
                  </h3>
                  {otherDevices.map((device) => (
                    <DeviceCard
                      key={device.id}
                      device={device}
                      inDesktop={inDesktop}
                      onDisableBackup={setDisableTarget}
                      onDisconnect={setDisconnectTarget}
                      onRevoke={setRevokeTarget}
                    />
                  ))}
                </section>
              ) : null}
            </>
          )}
        </div>
      </SettingsCard>

      <SettingsCard>
        <SectionHeader
          icon={Tablet}
          title="Connect a device"
          description="Use Arciin Desktop to discover this server, then enter a temporary pairing code."
        />

        {pairedSuccess ? (
          <div
            className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-50 px-4 py-5"
            data-testid="device-pairing-success"
          >
            <div className="flex items-start gap-3">
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              <div className="min-w-0 space-y-1">
                <p className="text-[14px] font-medium text-zinc-900">{pairedSuccess.name} is connected</p>
                <p className="text-[13px] leading-relaxed text-zinc-500">
                  {platformLabel(pairedSuccess.platform)} · {typeLabel(pairedSuccess.deviceType)}.
                  The pairing code was used and will not appear again.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              Pair another device
            </Button>
          </div>
        ) : activeCode ? (
          <div className="mt-4 space-y-3" data-testid="device-pairing-code">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Pairing code
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-zinc-200"
                  onClick={() => void copyPairingCode()}
                  disabled={expired}
                >
                  {codeCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {codeCopied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-5 text-center font-mono text-4xl tracking-[0.35em] text-zinc-900">
                {expired ? "—— ——" : activeCode.displayCode}
              </p>
              <p className="mt-3 text-center text-[12px] text-zinc-500">
                Enter this code in Arciin Desktop. It can be used once.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <PairingMetaTile
                label="Expires in"
                value={expired ? "Expired" : countdown?.label ?? "—"}
                mono
              />
              <PairingMetaTile label="Server" value={snapshot.instanceName} />
              <PairingMetaTile
                label="Local address"
                value={localAddress}
                mono
                onCopy={
                  snapshot.localUrl
                    ? () => void copyToClipboard(snapshot.localUrl!, "Local address")
                    : undefined
                }
              />
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
              This stops Computer Backup only. The ArciinSync credential is revoked, but this
              computer stays paired. Files already stored in Arciin remain. Files on the computer
              are not deleted.
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

      <AlertDialog
        open={Boolean(disconnectTarget)}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
      >
        <AlertDialogContent className="border-border bg-card text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnectTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove this computer&apos;s trusted connection to this Arciin server.
              Computer Backup will stop and this computer will need to be paired again before
              reconnecting. Files already backed up to Arciin will remain on the server. Files on
              this computer will NOT be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-disconnect-computer"
              onClick={() => disconnectTarget && revokeMutation.mutate(disconnectTarget)}
            >
              Disconnect Computer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent className="border-border bg-card text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access for {revokeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This device will no longer be able to connect to this Arciin server until it is
              paired again. Computer Backup on that device will stop. Server backups already stored
              in Arciin will remain. Local files will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-revoke-access"
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget)}
            >
              Revoke Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
