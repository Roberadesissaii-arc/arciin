"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Database, FolderOpen, HardDrive, Save } from "lucide-react"
import { toast } from "sonner"

import { StorageMigratePanel } from "@/components/settings/storage-migrate-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { getStorageSettings, updateStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"

const FOLDERS = ["objects", "libraries", "thumbnails", "temp", "logs"] as const

export function StorageSettingsForm() {
  const queryClient = useQueryClient()
  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })
  const [pathDraft, setPathDraft] = useState("")

  const updateMutation = useMutation({
    mutationFn: updateStorageSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.storageSettings })
      setPathDraft("")
      toast.success("Storage path saved.")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not update storage.")
    },
  })

  const d = storageQuery.data
  const displayPath = pathDraft || d?.storageRoot || ""
  const usagePct =
    d?.totalBytes && d.totalBytes > 0 && d.usageBytes >= 0
      ? Math.min(100, Math.round((d.usageBytes / d.totalBytes) * 100))
      : null

  if (storageQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted/30">
                <HardDrive className="size-5 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">Active storage</h2>
                <p className="text-[12px] text-muted-foreground">
                  {d?.writable ? "Writable" : "Not writable"} · metadata in PostgreSQL only
                </p>
              </div>
            </div>
            {usagePct != null ? (
              <span className="text-2xl font-semibold tabular-nums text-foreground">{usagePct}%</span>
            ) : null}
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {d?.totalBytes != null && d.totalBytes > 0 ? (
            <div>
              <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
                <span>{formatBytes(d.usageBytes)} used</span>
                <span>{formatBytes(d.totalBytes)} on volume</span>
              </div>
              <Progress value={usagePct ?? 0} className="h-2 bg-muted" />
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/15 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Root path
              </p>
              <p className="mt-1 break-all font-mono text-[12px] leading-snug text-foreground">
                {d?.storageRoot ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/15 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Inventory
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Database className="size-3.5 text-muted-foreground" />
                {(d?.objectCount ?? 0).toLocaleString()} objects
              </p>
            </div>
          </div>

          {d?.isDockerRuntime && d.hostStorageRoot && d.runtimeStorageRoot ? (
            <p className="rounded-lg border border-border bg-muted/15 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Docker maps <span className="font-mono text-foreground">{d.hostStorageRoot}</span> on the
              host to <span className="font-mono text-foreground">{d.runtimeStorageRoot}</span> in the
              container. Use the transfer tool below or update{" "}
              <span className="font-mono">ARCIIN_HOST_DATA_DIR</span> and re-run{" "}
              <span className="font-mono">docker-setup.sh</span>.
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-center gap-2">
          <FolderOpen className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Folder layout</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {FOLDERS.map((name) => (
            <code
              key={name}
              className="rounded-lg border border-border bg-muted/20 px-2.5 py-1 font-mono text-[11px] text-foreground/90"
            >
              {name}/
            </code>
          ))}
        </div>
      </div>

      <StorageMigratePanel usageBytes={d?.usageBytes ?? 0} />

      <details className="group rounded-2xl border border-border bg-card">
        <summary className="cursor-pointer list-none px-4 py-3.5 text-sm font-medium text-muted-foreground marker:content-none sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="group-open:text-foreground">Advanced — edit path manually</span>
        </summary>
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3 sm:px-5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Only changes the configured path. Does not copy files. Prefer &quot;Move storage&quot; above.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={displayPath}
              onChange={(e) => setPathDraft(e.target.value)}
              className="font-mono text-[12px]"
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              variant="outline"
              className="shrink-0 gap-1.5"
              disabled={updateMutation.isPending || !displayPath}
              onClick={() => updateMutation.mutate(displayPath)}
            >
              <Save className="size-3.5" />
              Save path
            </Button>
          </div>
        </div>
      </details>
    </div>
  )
}
