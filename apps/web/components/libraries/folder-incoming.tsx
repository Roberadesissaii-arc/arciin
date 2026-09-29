"use client"

import { ArrowDownToLine, Check } from "lucide-react"

import type { FolderIncomingSummary } from "@arciin/types"

import { useFolderIncoming, useIncomingUploads } from "@/hooks/use-incoming-uploads"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"

/**
 * Live "files are arriving" state for a folder — the card ring and the
 * open-folder banner. Both read the owner-only incoming snapshot, which
 * realtime events keep current; neither invents a file before it is committed.
 */

/** "Receiving", "2 incoming", "Verifying", "Waiting". */
export function incomingLabel(summary: FolderIncomingSummary): string {
  if (summary.state === "VERIFYING") return "Verifying"
  if (summary.state === "WAITING") return "Waiting"
  return summary.activeUploadCount > 1 ? `${summary.activeUploadCount} incoming` : "Receiving"
}

/** "Receiving 1 file · 38%" / "Receiving 3 files · 38% · 1.2 GB of 3.1 GB" */
export function incomingBanner(summary: FolderIncomingSummary): string {
  const files = `${summary.activeUploadCount} file${summary.activeUploadCount === 1 ? "" : "s"}`
  const verb = summary.state === "VERIFYING" ? "Verifying" : summary.state === "WAITING" ? "Waiting on" : "Receiving"
  return `${verb} ${files} · ${summary.progressPercent}% · ${formatBytes(summary.receivedBytes)} of ${formatBytes(summary.totalBytes)}`
}

function ProgressRing({ percent, muted }: { percent: number; muted: boolean }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <span className="relative inline-flex size-[18px] shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 18 18" className="absolute inset-0 -rotate-90">
        <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" className="stroke-zinc-200" />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, Math.max(0, percent)) / 100)}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none",
            muted ? "stroke-zinc-400" : "stroke-primary",
          )}
        />
      </svg>
      <ArrowDownToLine className={cn("size-2.5", muted ? "text-zinc-400" : "text-primary")} />
    </span>
  )
}

/** Replaces the card's "Folder" subtitle while uploads arrive, then briefly shows "Received". */
export function FolderIncomingIndicator({ folderId, folders }: { folderId: string; folders: FolderIncomingSummary[] | undefined }) {
  const { summary, justReceived } = useFolderIncoming(folders, folderId)
  if (justReceived) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary" data-testid="folder-incoming-received">
        <Check className="size-3" aria-hidden />
        Received
      </span>
    )
  }
  if (!summary) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-zinc-600"
      role="progressbar"
      aria-label={`${incomingLabel(summary)}: ${summary.progressPercent}%`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={summary.progressPercent}
      data-testid="folder-incoming"
      data-state={summary.state}
    >
      <ProgressRing percent={summary.progressPercent} muted={summary.state === "WAITING"} />
      <span className={summary.state === "WAITING" ? "text-zinc-500" : "text-zinc-700"}>{incomingLabel(summary)}</span>
      <span className="text-zinc-500">{summary.progressPercent}%</span>
    </span>
  )
}

/** Thin banner at the top of an open folder while it receives uploads. */
export function FolderIncomingBanner({ folderId }: { folderId: string }) {
  const { data } = useIncomingUploads()
  const { summary, justReceived } = useFolderIncoming(data?.folders, folderId)
  if (!summary && !justReceived) return null
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12px] text-zinc-700 shadow-[0_1px_2px_rgba(24,24,27,0.04)]"
      aria-live="polite"
      data-testid="folder-incoming-banner"
    >
      {summary ? (
        <>
          <ProgressRing percent={summary.progressPercent} muted={summary.state === "WAITING"} />
          <span className="tabular-nums">{incomingBanner(summary)}</span>
          {summary.state === "WAITING" ? (
            <span className="text-zinc-500">· no data in the last few minutes; it resumes when the sender reconnects</span>
          ) : null}
        </>
      ) : (
        <>
          <Check className="size-4 text-primary" aria-hidden />
          <span>Received — the new file is below.</span>
        </>
      )}
    </div>
  )
}
