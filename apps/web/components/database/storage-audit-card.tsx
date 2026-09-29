"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { HardDrive, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getLatestStorageAudit, startStorageAudit, type StorageAudit } from "@/lib/api/admin"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatRelativeDate } from "@/lib/utils/format-date"

/**
 * Where the disk went, counted — never cleaned from here.
 *
 * Runs on the server in the background (a walk of the storage root and the
 * backup tree can take a while) and shows the latest result. There is
 * deliberately no delete button: an "orphan" is only a candidate until a
 * person has looked.
 */
export function StorageAuditCard() {
  const queryClient = useQueryClient()
  const latest = useQuery({
    queryKey: queryKeys.storageAudit,
    queryFn: ({ signal }) => getLatestStorageAudit(signal),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2_000 : false),
  })
  const start = useMutation({
    mutationFn: () => startStorageAudit(),
    onSuccess: (run) => queryClient.setQueryData(queryKeys.storageAudit, run),
  })

  const run = latest.data
  const running = run?.status === "running" || start.isPending
  const a = run?.status === "done" ? run.result : null

  return (
    <section
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      aria-label="Storage audit"
      data-testid="storage-audit-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Storage audit</h2>
            <p className="text-[12px] text-muted-foreground">
              Read-only audit — counts where the disk is going. Nothing is deleted or moved.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={running} onClick={() => start.mutate()} data-testid="storage-audit-run">
          {running ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : null}
          {running ? "Auditing…" : a ? "Run again" : "Run audit"}
        </Button>
      </div>

      {run?.status === "failed" ? (
        <p className="mt-3 text-[12px] text-red-600">The audit did not finish ({run.error ?? "error"}). Try again.</p>
      ) : null}
      {a ? <AuditNumbers audit={a} finishedAt={run!.finishedAt} /> : null}
    </section>
  )
}

function AuditNumbers({ audit: a, finishedAt }: { audit: StorageAudit; finishedAt: string | null }) {
  const tiles: Array<{ label: string; value: string; note?: string }> = [
    {
      label: "Used",
      value: a.filesystem ? formatBytes(a.filesystem.usedBytes) : "—",
      note: a.filesystem ? `of ${formatBytes(a.filesystem.totalBytes)}` : undefined,
    },
    { label: "Free", value: a.filesystem ? formatBytes(a.filesystem.freeBytes) : "—" },
    {
      label: "Managed files",
      value: formatBytes(a.database.byState.active.bytes + a.database.byState.archived.bytes),
      note: `${(a.database.byState.active.count + a.database.byState.archived.count).toLocaleString()} objects`,
    },
    { label: "Trash", value: formatBytes(a.database.byState.trash.bytes), note: `${a.database.byState.trash.count.toLocaleString()} objects` },
    {
      label: "Backups",
      value: a.backups?.available ? formatBytes(a.backups.uniqueBytes) : "—",
      note: a.backups?.available ? `${a.backups.snapshots} snapshots, links counted once` : "not found on this server",
    },
    {
      label: "Potential orphan candidates",
      value: `${(a.database.orphanCandidates.count + a.physical.objects.orphanCandidates.count).toLocaleString()}`,
      note: `${formatBytes(a.database.orphanCandidates.bytes + a.physical.objects.orphanCandidates.bytes)} · review before removing anything`,
    },
  ]
  return (
    <div className="mt-3 space-y-2">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="storage-audit-numbers">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border/80 bg-muted/20 px-3 py-2">
            <dt className="text-[11px] font-medium text-muted-foreground">{t.label}</dt>
            <dd className="text-sm font-semibold tabular-nums text-foreground">{t.value}</dd>
            {t.note ? <dd className="text-[11px] text-muted-foreground">{t.note}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-muted-foreground">
        Also: thumbnails {formatBytes(a.physical.thumbnails.uniqueBytes)} · temporary files{" "}
        {formatBytes(a.physical.temp.uniqueBytes + a.physical.resumablePartials.uniqueBytes)} (
        {a.physical.resumablePartials.files} partial uploads, {a.physical.resumablePartials.stale} not in progress) · logs{" "}
        {formatBytes(a.physical.storageLogs.uniqueBytes + a.physical.appLogs.uniqueBytes)} · database{" "}
        {a.database.sizeBytes == null ? "—" : formatBytes(a.database.sizeBytes)}
        {a.database.byState.failed.count > 0
          ? ` · ${a.database.byState.failed.count.toLocaleString()} failed uploads (${a.database.missingFiles.toLocaleString()} rows with no file on disk)`
          : ""}
        {a.ollamaModels?.available ? ` · local AI models ${formatBytes(a.ollamaModels.uniqueBytes)}` : ""}
        {finishedAt ? ` · audited ${formatRelativeDate(finishedAt)}` : ""}
        {a.truncated ? " · stopped at its time limit; numbers are a lower bound" : ""}
      </p>
    </div>
  )
}
