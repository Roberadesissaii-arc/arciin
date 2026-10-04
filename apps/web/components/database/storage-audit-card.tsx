"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { HardDrive, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getLatestStorageAudit, startStorageAudit, type StorageAudit } from "@/lib/api/admin"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"

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
      className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"
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

function pct(part: number, whole: number): number {
  if (!whole || whole <= 0 || !Number.isFinite(part)) return 0
  return Math.max(0, Math.min(100, (part / whole) * 100))
}

/** A thin bar; `value` is a percentage. Decorative — the number beside it is the content. */
function Bar({ value, tone = "bg-zinc-800" }: { value: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80" aria-hidden>
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(value, value > 0 ? 1.5 : 0)}%` }} />
    </div>
  )
}

function AuditNumbers({ audit: a, finishedAt }: { audit: StorageAudit; finishedAt: string | null }) {
  const fs = a.filesystem
  const managedBytes = a.database.byState.active.bytes + a.database.byState.archived.bytes
  const managedCount = a.database.byState.active.count + a.database.byState.archived.count
  const orphanCount = a.database.orphanCandidates.count + a.physical.objects.orphanCandidates.count
  const orphanBytes = a.database.orphanCandidates.bytes + a.physical.objects.orphanCandidates.bytes
  const usedPct = fs ? pct(fs.usedBytes, fs.totalBytes) : 0

  /** Where the used space goes, as a share of what this server has used. */
  const breakdown: Array<{ label: string; bytes: number; note?: string; tone: string }> = [
    { label: "Managed files", bytes: managedBytes, note: `${managedCount.toLocaleString()} objects`, tone: "bg-[#FF4F12]" },
    ...(a.backups?.available
      ? [{ label: "Backups", bytes: a.backups.uniqueBytes, note: `${a.backups.snapshots} snapshots, links counted once`, tone: "bg-sky-500" }]
      : []),
    ...(a.ollamaModels?.available ? [{ label: "Ollama models", bytes: a.ollamaModels.uniqueBytes, tone: "bg-violet-500" }] : []),
    { label: "Trash", bytes: a.database.byState.trash.bytes, note: `${a.database.byState.trash.count.toLocaleString()} objects`, tone: "bg-zinc-500" },
    { label: "Thumbnails", bytes: a.physical.thumbnails.uniqueBytes, tone: "bg-zinc-400" },
    {
      label: "Temporary files",
      bytes: a.physical.temp.uniqueBytes + a.physical.resumablePartials.uniqueBytes,
      note: `${a.physical.resumablePartials.files} partial uploads, ${a.physical.resumablePartials.stale} not in progress`,
      tone: "bg-zinc-400",
    },
    { label: "Logs", bytes: a.physical.storageLogs.uniqueBytes + a.physical.appLogs.uniqueBytes, tone: "bg-zinc-400" },
  ]
  const breakdownBase = fs?.usedBytes || breakdown.reduce((sum, row) => sum + row.bytes, 0)

  const stats: Array<{ label: string; value: string; note?: string; tone?: "warning" }> = [
    { label: "Used", value: fs ? formatBytes(fs.usedBytes) : "—", note: fs ? `of ${formatBytes(fs.totalBytes)}` : undefined },
    { label: "Free", value: fs ? formatBytes(fs.freeBytes) : "—", note: fs ? `${(100 - usedPct).toFixed(0)}% of the disk` : undefined },
    { label: "Managed files", value: formatBytes(managedBytes), note: `${managedCount.toLocaleString()} objects` },
    { label: "Backups", value: a.backups?.available ? formatBytes(a.backups.uniqueBytes) : "—", note: a.backups?.available ? `${a.backups.snapshots} snapshots` : "not found on this server" },
    { label: "Trash", value: formatBytes(a.database.byState.trash.bytes), note: `${a.database.byState.trash.count.toLocaleString()} objects` },
    {
      label: "Failed uploads",
      value: a.database.byState.failed.count.toLocaleString(),
      note: a.database.missingFiles > 0 ? `${a.database.missingFiles.toLocaleString()} rows with no file on disk` : formatBytes(a.database.byState.failed.bytes),
    },
    {
      label: "Potential orphan candidates",
      value: orphanCount.toLocaleString(),
      note: `${formatBytes(orphanBytes)} · review before removing anything`,
      tone: orphanCount > 0 ? "warning" : undefined,
    },
    { label: "Ollama models", value: a.ollamaModels?.available ? formatBytes(a.ollamaModels.uniqueBytes) : "—", note: a.ollamaModels?.available ? "local AI models" : "none found" },
  ]

  return (
    <div className="mt-4 space-y-4">
      {fs ? (
        <div className="space-y-1.5" data-testid="storage-audit-disk">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
            <span className="font-semibold text-foreground">
              {formatBytes(fs.usedBytes)} used <span className="font-normal text-zinc-600">of {formatBytes(fs.totalBytes)}</span>
            </span>
            <span className={cn("tabular-nums", usedPct >= 90 ? "font-semibold text-amber-700" : "text-zinc-600")}>
              {usedPct.toFixed(0)}% · {formatBytes(fs.freeBytes)} free
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Disk used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usedPct)}
            aria-valuetext={`${usedPct.toFixed(0)}% used, ${formatBytes(fs.freeBytes)} free`}
            className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-200/80"
          >
            <div
              className={cn("h-full rounded-full", usedPct >= 90 ? "bg-amber-500" : "bg-zinc-800")}
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="storage-audit-numbers">
        {stats.map((t) => (
          <div
            key={t.label}
            className={cn(
              "rounded-xl border px-3 py-2.5",
              t.tone === "warning" ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-zinc-200/80 bg-zinc-50/60",
            )}
          >
            <dt className="text-[11px] font-medium text-zinc-600">{t.label}</dt>
            <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-foreground">{t.value}</dd>
            {t.note ? <dd className="text-[11px] leading-snug text-zinc-600">{t.note}</dd> : null}
          </div>
        ))}
      </dl>

      <div className="space-y-2" data-testid="storage-audit-breakdown">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Where the space goes</h3>
        <ul className="space-y-2.5">
          {breakdown.map((row) => (
            <li key={row.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[12px] max-sm:grid-cols-[1fr_auto]">
              <span className="truncate font-medium text-zinc-800" title={row.note}>
                {row.label}
              </span>
              <span className="max-sm:col-span-2 max-sm:row-start-2">
                <Bar value={pct(row.bytes, breakdownBase)} tone={row.tone} />
              </span>
              <span className="text-right tabular-nums text-zinc-700">{formatBytes(row.bytes)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-600">
        Database {a.database.sizeBytes == null ? "—" : formatBytes(a.database.sizeBytes)}
        {finishedAt ? ` · audited ${formatRelativeDate(finishedAt)}` : ""}
        {a.truncated ? " · stopped at its time limit; numbers are a lower bound" : ""}
        {" · "}Read-only: orphan candidates are listed for review, never removed from here.
      </p>
    </div>
  )
}
