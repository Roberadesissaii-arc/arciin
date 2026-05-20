"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, FolderTree, Save, Server } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { getStorageSettings, updateStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"

const LAYOUT_HINTS = [
  { label: "objects", hint: "Binary blobs keyed by storage object id" },
  { label: "libraries", hint: "Library-scoped file trees" },
  { label: "thumbnails", hint: "Generated previews" },
  { label: "temp", hint: "Upload and job scratch space" },
  { label: "logs", hint: "Optional local logs" },
] as const

export function StorageSettingsForm() {
  const queryClient = useQueryClient()
  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })
  const [storageRoot, setStorageRoot] = useState("")
  const updateMutation = useMutation({
    mutationFn: updateStorageSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.storageSettings })
      toast.success("Storage settings updated.")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not update storage.")
    },
  })

  const d = storageQuery.data
  const effectiveValue = storageRoot || d?.storageRoot || ""
  const usagePct =
    d?.totalBytes && d.totalBytes > 0 && d.usageBytes >= 0
      ? Math.min(100, Math.round((d.usageBytes / d.totalBytes) * 100))
      : null

  return (
    <div className="space-y-6">

      {d && d.totalBytes != null && d.totalBytes > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <CardTitle className="text-base text-foreground">Volume usage</CardTitle>
                <CardDescription className="text-zinc-600">
                  {formatBytes(d.usageBytes)} of {formatBytes(d.totalBytes)} on the filesystem hosting the root
                </CardDescription>
              </div>
              {usagePct != null && (
                <span className="text-sm font-semibold tabular-nums text-primary">{usagePct}%</span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Progress value={usagePct ?? 0} className="h-2.5" />
            <p className="mt-2 text-xs text-muted-foreground">
              Database metadata stays in PostgreSQL; binaries never live inside the DB.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="border-border bg-card">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <Server className="size-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-foreground">Storage root</CardTitle>
                <CardDescription className="text-zinc-600">
                  Absolute path on this host where Arciin writes objects, libraries, temp files, and thumbnails. The
                  default install uses <span className="font-mono text-foreground/90">./data/arciin</span>; Docker
                  must use <span className="font-mono text-foreground/90">/data/arciin</span> (bind mount from{" "}
                  <span className="font-mono text-foreground/90">ARCIIN_HOST_DATA_DIR</span> on the host).
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {d?.instanceName && (
              <p className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                Instance <span className="font-medium text-foreground">{d.instanceName}</span>
                {d.defaultLocationId ? (
                  <span className="text-zinc-500"> · default location synced</span>
                ) : null}
              </p>
            )}
            <Field>
              <FieldLabel htmlFor="storageRoot">Root path</FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="storageRoot"
                  value={effectiveValue}
                  onChange={(e) => setStorageRoot(e.target.value)}
                  className="font-mono text-[13px] sm:flex-1"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button
                  className="shrink-0 gap-1.5 bg-primary text-white hover:bg-primary/90 sm:w-auto"
                  disabled={updateMutation.isPending || !effectiveValue}
                  onClick={() => updateMutation.mutate(effectiveValue)}
                >
                  <Save className="size-3.5" />
                  {updateMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </Field>
            <div
              className={cn(
                "flex gap-3 rounded-xl border px-3 py-3 text-sm",
                d?.writable ? "border-amber-500/25 bg-amber-500/[0.06]" : "border-destructive/30 bg-destructive/5",
              )}
            >
              <AlertTriangle
                className={cn("mt-0.5 size-4 shrink-0", d?.writable ? "text-amber-600" : "text-destructive")}
              />
              <p className="text-muted-foreground">
                {d?.writable
                  ? "Changing the root does not move existing files. Migrate data or update libraries before pointing production traffic at a new path."
                  : "This path is not writable from the API process. Fix permissions or choose a directory the service user owns."}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <FolderTree className="size-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-foreground">Recommended layout</CardTitle>
                <CardDescription className="text-zinc-600">
                  Keep structure predictable for backups and future workers.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {LAYOUT_HINTS.map(({ label, hint }) => (
                <li
                  key={label}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border/80 bg-muted/25 px-3 py-2.5"
                >
                  <code className="shrink-0 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[12px] text-foreground">
                    {label}
                  </code>
                  <span className="text-right text-[12px] leading-snug text-muted-foreground">{hint}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
