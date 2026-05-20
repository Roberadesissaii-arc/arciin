"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, BadgeCheck, HardDrive, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

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
import type { StorageVolumeOption } from "@/lib/types/models"

function formatFree(option: StorageVolumeOption) {
  if (option.availableBytes == null) return "Unknown free space"
  const total = option.totalBytes != null ? formatBytes(option.totalBytes) : "?"
  return `${formatBytes(option.availableBytes)} free · ${total} total`
}

export function StorageMigratePanel({ usageBytes }: { usageBytes: number }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<StorageVolumeOption | null>(null)

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
      toast.success("Transfer started. Keep Arciin running until it finishes.")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not start transfer.")
    },
  })

  const active = migrateStatusQuery.data?.active ?? false
  const job = migrateStatusQuery.data?.job
  const volumes = volumesQuery.data?.volumes ?? []
  const migrationTargets = volumesQuery.data?.migrationTargets ?? []
  const currentVolume = volumes.find((v) => v.isCurrent)

  useEffect(() => {
    if (!active && job?.status === "COMPLETED") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.storageSettings })
      void queryClient.invalidateQueries({ queryKey: queryKeys.storageVolumes })
    }
  }, [active, job?.status, queryClient])

  const transferTarget =
    selected && !selected.isCurrent ? selected : null

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ArrowRightLeft className="size-4 text-muted-foreground" />
            Move storage to another disk
          </h3>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
            Attached an SSD or USB drive? Copy everything to a new location in one step. Your old
            folder stays untouched until you delete it yourself.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={volumesQuery.isFetching || active}
          onClick={() => void volumesQuery.refetch()}
        >
          <RefreshCw className={cn("size-3.5", volumesQuery.isFetching && "animate-spin")} />
          Rescan
        </Button>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {currentVolume ? (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">In use:</span>{" "}
            <span className="font-mono">{currentVolume.arciinPath}</span>
            <span className="text-muted-foreground">
              {" "}
              · about {formatBytes(usageBytes)} in libraries
            </span>
          </p>
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
        ) : volumes.length === 0 ? (
          <p className="py-4 text-[12px] text-muted-foreground">
            No volumes detected. Mount your drive on the server, then rescan.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {volumes.map((option) => {
              const isCurrent = Boolean(option.isCurrent)
              const isSelected = !isCurrent && transferTarget?.id === option.id
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    disabled={active || migrateMutation.isPending || isCurrent}
                    onClick={() => !isCurrent && setSelected(option)}
                    className={cn(
                      "flex h-full w-full flex-col gap-2 rounded-xl border px-3.5 py-3 text-left transition-colors",
                      isCurrent
                        ? "cursor-default border-border bg-muted/25"
                        : isSelected
                          ? "border-primary/40 bg-muted/30 ring-1 ring-primary/25"
                          : "border-border bg-card hover:bg-muted/20",
                      (active || migrateMutation.isPending) && !isCurrent && "opacity-60",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {isCurrent ? (
                        <BadgeCheck
                          className="mt-0.5 size-4 shrink-0 text-primary"
                          aria-hidden
                        />
                      ) : (
                        <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[12px] font-medium text-foreground">{option.label}</p>
                          {isCurrent ? (
                            <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                              In use
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {option.arciinPath}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{formatFree(option)}</p>
                      </div>
                    </div>
                    {option.largeExternal && !isCurrent ? (
                      <span className="w-fit rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        More space than OS disk
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {migrationTargets.length === 0 && !volumesQuery.isLoading && volumes.length > 0 ? (
          <p className="text-[12px] text-muted-foreground">
            No other writable volumes found. Mount another drive and rescan to transfer here.
          </p>
        ) : null}

        <Button
          type="button"
          className="w-full gap-2 sm:w-auto"
          disabled={
            !transferTarget ||
            active ||
            migrateMutation.isPending ||
            !transferTarget.writable
          }
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
          Copies objects, libraries, thumbnails, avatars, and logs. Updates database paths automatically.
          Original data is never deleted.
        </p>
      </div>
    </section>
  )
}
