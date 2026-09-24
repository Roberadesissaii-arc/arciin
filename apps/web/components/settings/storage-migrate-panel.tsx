"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, BadgeCheck, HardDrive, Loader2, RefreshCw } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  getStorageMigrateStatus,
  getStorageVolumes,
  startStorageMigration,
} from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"
import { UnmountedDrivesPanel } from "@/components/storage/unmounted-drives-panel"
import { describeRescan, transferBlockedReason } from "@/lib/storage/storage-device-ux"
import type { StorageVolumeOption, UnmountedBlockDevice, StorageBlockDisk } from "@/lib/types/models"

function diskRoleLabel(role: StorageBlockDisk["role"]) {
  if (role === "system") return "System disk"
  if (role === "attached") return "Attached storage"
  return "Internal storage"
}

function formatFree(option: StorageVolumeOption) {
  if (option.availableBytes == null) return "Unknown free space"
  const total = option.totalBytes != null ? formatBytes(option.totalBytes) : "?"
  return `${formatBytes(option.availableBytes)} free · ${total} on this filesystem`
}

function volumeOnDisk(disk: StorageBlockDisk, volumes: StorageVolumeOption[]) {
  return volumes.find((v) => v.device?.includes(disk.name))
}

const DRIVE_CARD_MIN_H = "min-h-[88px]"

/** Numbered step chip so the mount → move flow reads top to bottom. */
const STEP_CHIP =
  "flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-card text-[10px] font-bold text-muted-foreground"

export function StorageMigratePanel({ usageBytes }: { usageBytes: number }) {
  const queryClient = useQueryClient()
  const [selectedVolume, setSelectedVolume] = useState<StorageVolumeOption | null>(null)
  const [selectedUnmounted, setSelectedUnmounted] = useState<UnmountedBlockDevice | null>(null)

  const volumesQuery = useQuery({
    queryKey: queryKeys.storageVolumes,
    queryFn: ({ signal }) => getStorageVolumes(signal),
    staleTime: 30_000,
  })

  const migrateStatusQuery = useQuery({
    queryKey: queryKeys.storageMigrateStatus,
    queryFn: ({ signal }) => getStorageMigrateStatus(signal),
    refetchInterval: (q) => (q.state.data?.active ? 2000 : false),
  })

  const migrateMutation = useMutation({
    mutationFn: (targetPath: string) => startStorageMigration(targetPath),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.storageMigrateStatus })
      toast.success("Transfer started.", {
        description: "Keep Arciin running until it finishes.",
      })
    },
    onError: (err) => {
      toast.error("Could not start transfer", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      })
    },
  })

  /**
   * Rescan asks the server to enumerate block devices again (the volumes
   * route runs discovery on every call; nothing is cached), then says what
   * changed. The ref guards against a double-click starting two scans before
   * React has re-rendered the disabled button.
   */
  const [rescanning, setRescanning] = useState(false)
  const rescanInFlight = useRef(false)
  async function rescan() {
    if (rescanInFlight.current) return
    rescanInFlight.current = true
    setRescanning(true)
    const before = volumesQuery.data
    try {
      const result = await volumesQuery.refetch({ throwOnError: true })
      if (result.data) {
        const { title, description } = describeRescan(before, result.data)
        toast.success(title, { description })
      }
    } catch (err) {
      toast.error("Could not scan storage devices", {
        description: err instanceof Error ? err.message : "Check that the API is running, then try again.",
      })
    } finally {
      rescanInFlight.current = false
      setRescanning(false)
    }
  }

  const active = migrateStatusQuery.data?.active ?? false
  const job = migrateStatusQuery.data?.job
  const volumes = volumesQuery.data?.volumes ?? []
  const transferOptions = volumesQuery.data?.migrationTargets ?? volumes.filter((v) => !v.isCurrent)
  const unmountedDevices = volumesQuery.data?.unmountedDevices ?? []
  const blockDisks = volumesQuery.data?.blockDisks ?? []
  const deviceContext = volumesQuery.data?.currentDeviceContext ?? null
  const isDocker = volumesQuery.data?.isDockerRuntime ?? false
  const mountPasswordlessSudo = volumesQuery.data?.mountPasswordlessSudo ?? false
  const currentVolume = volumes.find((v) => v.isCurrent)

  useEffect(() => {
    if (!active && job?.status === "COMPLETED") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.storageSettings })
      void queryClient.invalidateQueries({ queryKey: queryKeys.storageVolumes })
    }
  }, [active, job?.status, queryClient])

  const transferTarget =
    selectedVolume && !selectedVolume.isCurrent ? selectedVolume : null

  const transferBlocked = transferBlockedReason({
    active,
    pending: migrateMutation.isPending,
    hasTarget: Boolean(transferTarget),
    targetWritable: transferTarget?.writable ?? false,
    selectedUnmounted: Boolean(selectedUnmounted),
  })

  async function handleMounted(result: { arciinPath: string; deviceId: string }) {
    setSelectedUnmounted(null)
    const refreshed = await volumesQuery.refetch()
    const nextVolume =
      refreshed.data?.migrationTargets?.find((v) => v.arciinPath === result.arciinPath) ??
      refreshed.data?.volumes.find(
        (v) => v.arciinPath === result.arciinPath && !v.isCurrent,
      ) ??
      refreshed.data?.migrationTargets?.[0]
    if (nextVolume) {
      setSelectedVolume(nextVolume)
    }
  }

  function selectVolume(option: StorageVolumeOption) {
    if (option.isCurrent) return
    setSelectedUnmounted(null)
    setSelectedVolume((prev) => (prev?.id === option.id ? null : option))
  }

  function selectUnmounted(device: UnmountedBlockDevice | null) {
    setSelectedVolume(null)
    setSelectedUnmounted(device)
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ArrowRightLeft className="size-4 text-muted-foreground" />
            Move storage to another disk
          </h3>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
            {isDocker
              ? "Files live on the host folder shown below (not inside the git clone). Mount a larger SSD on the server, rescan, then transfer."
              : "Attached another SSD or USB drive? Select it below, mount it, then transfer your libraries."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={rescanning || volumesQuery.isFetching || active}
          aria-busy={rescanning}
          onClick={() => void rescan()}
          data-testid="storage-rescan"
        >
          <RefreshCw className={cn("size-3.5", (rescanning || volumesQuery.isFetching) && "animate-spin")} />
          {rescanning ? "Scanning…" : "Rescan"}
        </Button>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {currentVolume ? (
          <div className="rounded-xl border border-border bg-muted/15 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <BadgeCheck className="size-4 shrink-0 text-[#FF4F12]" aria-hidden />
              <p className="text-[12px] font-semibold text-foreground">In use now</p>
              <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                {formatBytes(usageBytes)} in libraries
              </span>
            </div>
            <p className="mt-1.5 break-all font-mono text-[11px] text-foreground">
              {currentVolume.arciinPath}
            </p>

            {(currentVolume.device || (deviceContext?.blockDevice && deviceContext.blockDeviceSizeBytes)) ? (
              <dl className="mt-2.5 grid gap-2 sm:grid-cols-2">
                {currentVolume.device ? (
                  <div className="rounded-lg border border-border bg-card px-3 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Filesystem
                    </dt>
                    <dd className="mt-0.5 break-all font-mono text-[11px] text-foreground">
                      {currentVolume.device}
                      {currentVolume.filesystem ? ` (${currentVolume.filesystem})` : ""}
                    </dd>
                    <dd className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatFree(currentVolume)}
                    </dd>
                  </div>
                ) : null}
                {deviceContext?.blockDevice && deviceContext.blockDeviceSizeBytes ? (
                  <div className="rounded-lg border border-border bg-card px-3 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Physical disk
                    </dt>
                    <dd className="mt-0.5 break-all font-mono text-[11px] text-foreground">
                      {deviceContext.blockDevice}
                      {deviceContext.blockDeviceModel ? ` (${deviceContext.blockDeviceModel})` : ""}
                    </dd>
                    <dd className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatBytes(deviceContext.blockDeviceSizeBytes)} total
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}

            {deviceContext?.blockDevice &&
            deviceContext.blockDeviceSizeBytes &&
            deviceContext.filesystemTotalBytes &&
            deviceContext.blockDeviceSizeBytes > deviceContext.filesystemTotalBytes * 1.05 ? (
              <p className="mt-2 rounded-lg border border-[#FF4F12]/25 bg-[#FF4F12]/5 px-3 py-2 text-[11px] leading-relaxed text-foreground">
                Arciin only sees the {formatBytes(deviceContext.filesystemTotalBytes)} filesystem —
                not the full {formatBytes(deviceContext.blockDeviceSizeBytes)} disk. Expand the
                partition on the server to use the rest.
              </p>
            ) : null}
          </div>
        ) : null}

        {blockDisks.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={STEP_CHIP} aria-hidden>
                1
              </span>
              <h4 className="text-[12px] font-semibold text-foreground">Physical disks on this server</h4>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Reference only. To use a disk, mount it in step 2, then pick it under Move files to.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {blockDisks.map((disk) => (
                <li
                  key={disk.id}
                  className={cn(
                    "flex flex-col justify-center gap-1 rounded-xl border border-border bg-muted/10 px-3 py-2.5",
                    DRIVE_CARD_MIN_H,
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-mono text-[11px] font-medium text-foreground">{disk.device}</p>
                    <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {disk.sizeLabel}
                    </span>
                    <span className="rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {diskRoleLabel(disk.role)}
                    </span>
                    <span
                      className="rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success"
                      title="The physical device is attached to this server."
                    >
                      Device: Connected
                    </span>
                    {volumeOnDisk(disk, volumes)?.isCurrent ? (
                      <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#FF4F12]">
                        Arciin here
                      </span>
                    ) : null}
                  </div>
                  {disk.model ? (
                    <p className="text-[10px] text-muted-foreground">{disk.model}</p>
                  ) : null}
                  {disk.unmountedPartitionCount > 0 ? (
                    <p className="text-[10px] text-[#FF4F12]">
                      {disk.unmountedPartitionCount} partition
                      {disk.unmountedPartitionCount === 1 ? "" : "s"} not mounted — mount below to use
                      {disk.unmountedPartitionCount === 1 ? " it" : " them"}
                    </p>
                  ) : disk.role === "system" ? (
                    <p className="text-[10px] text-muted-foreground">
                      System disk — expand or add a partition on the server to use more space
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {active && job ? (
          <div className="space-y-2 rounded-xl border border-border bg-muted/20 px-4 py-3">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="font-medium text-foreground">Transfer in progress</span>
              <span className="tabular-nums text-foreground">{job.progress}%</span>
            </div>
            <Progress value={job.progress} className="h-2 bg-muted" />
            <p className="text-[11px] text-muted-foreground">
              Do not stop the API or worker until this completes.
            </p>
          </div>
        ) : null}

        {job?.status === "FAILED" && job.error ? (
          <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            {job.error}
          </p>
        ) : null}

        {volumesQuery.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Scanning volumes…
          </div>
        ) : volumes.length === 0 && unmountedDevices.length === 0 ? (
          <p className="py-4 text-[12px] text-muted-foreground">
            No volumes detected. Attach a drive on the server, then rescan.
          </p>
        ) : (
          <>
            <UnmountedDrivesPanel
              devices={unmountedDevices}
              selectedId={selectedUnmounted?.id ?? null}
              onSelect={selectUnmounted}
              onMounted={handleMounted}
              disabled={active || migrateMutation.isPending}
              isDocker={isDocker}
              mountPasswordlessSudo={mountPasswordlessSudo}
            />

            {transferOptions.length > 0 || currentVolume ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={STEP_CHIP} aria-hidden>
                    3
                  </span>
                  <h4 className="text-[12px] font-semibold text-foreground">Move files to</h4>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Pick a mounted drive with its own disk space. Same-disk folders and the OS root are hidden.
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {currentVolume ? (
                    <li>
                      <div
                        className={cn(
                          "flex min-h-[88px] w-full flex-col gap-2 rounded-xl border border-border bg-muted/25 px-3.5 py-3",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-[#FF4F12]" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-medium text-foreground">{currentVolume.label}</p>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                              {currentVolume.arciinPath}
                            </p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">{formatFree(currentVolume)}</p>
                          </div>
                        </div>
                        <span className="w-fit rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                          Current location
                        </span>
                      </div>
                    </li>
                  ) : null}
                  {transferOptions.map((option) => {
                    const isSelected = transferTarget?.id === option.id
                    return (
                      <li key={option.id}>
                        <button
                          type="button"
                          disabled={active || migrateMutation.isPending}
                          onClick={() => selectVolume(option)}
                          className={cn(
                            "flex h-full w-full min-h-[88px] flex-col gap-2 rounded-xl border px-3.5 py-3 text-left transition-colors",
                            isSelected
                              ? "border-primary/40 bg-muted/30 ring-1 ring-primary/25"
                              : "border-border bg-card hover:bg-muted/20",
                            (active || migrateMutation.isPending) && "opacity-60",
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-medium text-foreground">{option.label}</p>
                              <p className="truncate font-mono text-[11px] text-muted-foreground">
                                {option.arciinPath}
                              </p>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">{formatFree(option)}</p>
                              {option.device ? (
                                <p className="font-mono text-[10px] text-muted-foreground/80">{option.device}</p>
                              ) : null}
                            </div>
                          </div>
                          {option.largeExternal ? (
                            <span className="w-fit rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Separate drive
                            </span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : volumes.length === 0 && unmountedDevices.length === 0 ? (
              <p className="py-4 text-[12px] text-muted-foreground">
                No volumes detected. Attach a drive on the server, then rescan.
              </p>
            ) : transferOptions.length === 0 ? (
              <p className="py-4 text-[12px] text-muted-foreground">
                No separate disk ready yet. Mount an attached drive above, then rescan.
              </p>
            ) : null}
          </>
        )}

        {transferTarget && !active ? (
          <p className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-[11px] text-foreground">
            Ready to transfer to{" "}
            <span className="font-mono">{transferTarget.arciinPath}</span>
          </p>
        ) : null}

        {selectedUnmounted && !transferTarget ? (
          <p className="text-[11px] text-[#FF4F12]">
            After mounting <span className="font-mono">{selectedUnmounted.device}</span>, Arciin will
            transfer to <span className="font-mono">{selectedUnmounted.suggestedArciinPath}</span>.
          </p>
        ) : null}

        {transferBlocked ? (
          <p id="transfer-blocked-reason" className="text-[11px] font-medium text-muted-foreground" data-testid="transfer-blocked-reason">
            {transferBlocked}
          </p>
        ) : null}

        <Button
          type="button"
          className="w-full gap-2 sm:w-auto"
          disabled={Boolean(transferBlocked)}
          aria-describedby={transferBlocked ? "transfer-blocked-reason" : undefined}
          onClick={() => {
            if (!transferTarget) return
            migrateMutation.mutate(transferTarget.arciinPath)
          }}
        >
          {migrateMutation.isPending || active ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowRightLeft className="size-4" />
          )}
          Transfer all files here
        </Button>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Copies objects, libraries, thumbnails, avatars, and logs. Updates database paths
          automatically. Original data is never deleted.
        </p>
      </div>
    </section>
  )
}
