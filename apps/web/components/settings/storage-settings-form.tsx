"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, Database, FolderOpen, HardDrive, Save } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import {
  SectionHeader,
  SettingsCard,
  SettingsFieldLabel,
  SettingsHint,
} from "@/components/settings/settings-panel-primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { getStorageSettings, updateStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import { cn } from "@/lib/utils"

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
      toast.success("Storage path saved.", {
        description: "This only updates the configured path — files are not copied.",
      })
    },
    onError: (err) => {
      toast.error("Could not update storage", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      })
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
      <div className="space-y-4 p-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (storageQuery.isError || !d) {
    return (
      <SettingsPanelError
        message={
          storageQuery.error instanceof Error
            ? storageQuery.error.message
            : "Could not load storage settings."
        }
        hint="Check that the API is running and that you have permission to view storage settings."
      />
    )
  }

  return (
    <div className="space-y-6 p-1">
      <SectionHeader
        icon={HardDrive}
        title="Storage"
        description="Your media lives on this machine’s disk — not in Arciin’s cloud. Choose a durable root path, watch usage, and move to a larger drive when you need space."
      />

      <SettingsCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SettingsFieldLabel>Active storage</SettingsFieldLabel>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-xl font-semibold tracking-tight text-foreground">
                {d.writable ? "Writable" : "Not writable"}
              </p>
              <span
                className={cn(
                  "size-2 rounded-full",
                  d.writable ? "bg-emerald-500" : "bg-red-500",
                )}
                aria-hidden
              />
            </div>
            <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">
              Metadata stays in PostgreSQL. File bytes live under the root path below.
            </p>
          </div>
          {usagePct != null ? (
            <div className="text-right">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {usagePct}%
              </span>
              <p className="text-[11px] text-muted-foreground">of volume used</p>
            </div>
          ) : null}
        </div>

        <div className="mt-5 space-y-4">
          {d.totalBytes != null && d.totalBytes > 0 ? (
            <Progress value={usagePct ?? 0} className="h-2 bg-muted" />
          ) : null}

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <dt>
                <SettingsFieldLabel>Used</SettingsFieldLabel>
              </dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {formatBytes(d.usageBytes)}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <dt>
                <SettingsFieldLabel>On volume</SettingsFieldLabel>
              </dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {d.totalBytes != null && d.totalBytes > 0 ? formatBytes(d.totalBytes) : "—"}
              </dd>
            </div>
            <div className="col-span-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 sm:col-span-1">
              <dt>
                <SettingsFieldLabel>Inventory</SettingsFieldLabel>
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold tabular-nums text-foreground">
                <Database className="size-3.5 text-zinc-500" />
                {(d.objectCount ?? 0).toLocaleString()} objects
              </dd>
            </div>
          </dl>

          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <SettingsFieldLabel>Root path</SettingsFieldLabel>
            <p className="mt-1 break-all font-mono text-[12px] leading-snug text-foreground">
              {d.storageRoot ?? "—"}
            </p>
          </div>

          {d.isDockerRuntime && d.hostStorageRoot && d.runtimeStorageRoot ? (
            <SettingsHint>
              Docker maps{" "}
              <span className="font-mono text-foreground">{d.hostStorageRoot}</span> on
              the host to{" "}
              <span className="font-mono text-foreground">
                {d.runtimeStorageRoot}
              </span>{" "}
              in the container. Use Attached disks to transfer, or update{" "}
              <span className="font-mono">ARCIIN_HOST_DATA_DIR</span> and re-run{" "}
              <span className="font-mono">docker-setup.sh</span>.
            </SettingsHint>
          ) : null}
        </div>
      </SettingsCard>

      <Link
        href="/settings?tab=attached-disks"
        className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-zinc-300 hover:bg-muted/20 sm:p-5"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground transition-colors group-hover:border-primary/25 group-hover:text-primary">
          <HardDrive className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">Attached disks</span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
            Physical drives, mounting, and moving libraries to another disk.
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
      </Link>

      <SettingsCard>
        <div className="mb-3 flex items-center gap-2">
          <FolderOpen className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Folder layout</h3>
        </div>
        <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
          Standard layout under the storage root. Do not rename these folders by hand while Arciin
          is running.
        </p>
        <div className="flex flex-wrap gap-2">
          {FOLDERS.map((name) => (
            <code
              key={name}
              className="rounded-lg border border-border bg-muted/25 px-2.5 py-1 font-mono text-[11px] text-foreground"
            >
              {name}/
            </code>
          ))}
        </div>
      </SettingsCard>

      <details className="group rounded-xl border border-border bg-card shadow-sm">
        <summary
          className={cn(
            "cursor-pointer list-none px-4 py-3.5 text-sm font-medium text-muted-foreground marker:content-none sm:px-5",
            "[&::-webkit-details-marker]:hidden group-open:text-foreground",
          )}
        >
          Advanced — edit path manually
        </summary>
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3 sm:px-5">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Only changes the configured path. Does not copy files. Prefer &quot;Move storage&quot;
            above when relocating media.
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
