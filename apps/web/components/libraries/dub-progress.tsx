"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ChevronRight, Loader2, RefreshCw, Server } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { isDubRunning, type MediaDub } from "@/lib/api/transcripts"
import { cn } from "@/lib/utils"

/**
 * What a dub in progress is allowed to say about itself.
 *
 * Everything here comes from the row the worker writes. Nothing is timed,
 * animated towards a guess, or extrapolated: a stage that has no counter shows
 * an indeterminate bar, not a number someone might act on. That rules out the
 * obvious temptation of `setInterval(() => percent++)`, which would look better
 * and mean nothing.
 *
 * There is deliberately no estimated finish. On this hardware a chunk takes
 * somewhere between thirty-five and sixty seconds and the variance is the whole
 * problem — an ETA built on that would be wrong by many minutes, and being told
 * "about 12 minutes left" for forty minutes is worse than being told nothing.
 * What is shown instead is the fact that it is moving, and when it last moved.
 */

/** After this much silence, say so rather than implying smooth progress. */
const STALL_NOTICE_MS = 5 * 60 * 1000

/** How often the "last updated" line recomputes. Display only. */
const TICK_MS = 15_000

/**
 * The unit each stage is counting.
 *
 * "39 of 122" is not self-explanatory, and the honest label differs by stage:
 * the separator works in audio chunks, synthesis in spoken segments.
 */
function counterLabel(status: MediaDub["status"], current: number, total: number): string {
  switch (status) {
    case "SEPARATING":
      return `${current} of ${total} audio chunks`
    case "SYNTHESIZING":
      return `${current} of ${total} segments`
    case "MIXING":
      return `${current} of ${total} steps`
    default:
      return `${current} of ${total}`
  }
}

function sinceLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.round(minutes / 60)} hr ago`
}

/**
 * A clock only for the "last updated" text.
 *
 * Not progress. The number it renders is a comparison against a persisted
 * timestamp, so it can only ever say how long ago something real happened.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

export function DubProgress({ dub }: { dub: MediaDub }) {
  const running = isDubRunning(dub.status)
  const now = useNow(running)

  const percent = dub.progressPercent
  const hasCounter =
    dub.progressCurrent !== null && dub.progressTotal !== null && dub.progressTotal > 0

  const updatedAgo = dub.progressUpdatedAt ? now - new Date(dub.progressUpdatedAt).getTime() : null
  const stalled = updatedAgo !== null && updatedAgo >= STALL_NOTICE_MS

  if (!running) return null

  return (
    <div className="space-y-2" data-testid="dub-progress">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-primary">
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
        <span data-testid="dub-progress-stage">{dub.stage ?? "Working…"}</span>
      </p>

      {/* Indeterminate when the stage genuinely cannot count, never faked. */}
      <Progress
        value={percent}
        className="h-2"
        data-testid="dub-progress-bar"
        aria-label={dub.stage ?? "Dub progress"}
      />

      <div className="flex items-baseline justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span data-testid="dub-progress-counter">
          {hasCounter
            ? counterLabel(dub.status, dub.progressCurrent!, dub.progressTotal!)
            : "Starting…"}
        </span>
        {percent !== null ? (
          <span className="font-medium tabular-nums text-foreground" data-testid="dub-progress-percent">
            {percent}%
          </span>
        ) : null}
      </div>

      {/*
        Long is normal here, and saying so is the difference between a slow
        feature and a broken one. Demucs on a CPU without AVX runs at roughly
        13x realtime, so a twelve-minute video is over an hour of work.
      */}
      <div
        className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2"
        data-testid="dub-progress-notice"
      >
        <Server className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-0.5 text-[11.5px] leading-relaxed">
          <p className="font-medium text-foreground">Running locally</p>
          <p className="text-muted-foreground">
            Audio separation on this server can take a while for long videos. You can close this
            panel or leave the page — the job keeps going.
          </p>
        </div>
      </div>

      {/*
        Not a failure claim. A chunk can legitimately take a minute, so this only
        reports that nothing has been heard lately and lets the reader judge.
      */}
      {stalled ? (
        <p className="text-[11.5px] text-amber-700" data-testid="dub-progress-stalled">
          Still processing. Last progress update {sinceLabel(updatedAgo)}.
        </p>
      ) : updatedAgo !== null ? (
        <p className="text-[11px] text-muted-foreground" data-testid="dub-progress-updated">
          Updated {sinceLabel(updatedAgo)}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A failure a person can read.
 *
 * What used to be here was `error.message` straight from the worker, which for a
 * separator crash meant "Command failed: /srv/…" followed by four kilobytes of
 * Python logging and tqdm bars. The reader learned nothing and the server's
 * directory layout ended up on screen.
 *
 * So the sentence comes first, the retry is immediately available, and the
 * technical text sits behind a disclosure — bounded and sanitised before it ever
 * reached the browser.
 */
export function DubFailure({
  dub,
  onRetry,
  retrying = false,
}: {
  dub: MediaDub
  onRetry?: () => void
  retrying?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-2" data-testid="dub-failure">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-[12.5px] font-medium text-foreground">
            {headlineFor(dub.error)}
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            {explanationFor(dub.error)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={retrying}
            onClick={onRetry}
            data-testid="dub-retry"
          >
            {retrying ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Try again
          </Button>
        ) : null}
      </div>

      {dub.errorDetail ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
              data-testid="dub-error-details-toggle"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
                aria-hidden
              />
              Technical details
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-border bg-muted/50 p-2 text-[10.5px] leading-relaxed text-muted-foreground"
              data-testid="dub-error-details"
            >
              {dub.errorDetail}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

/**
 * The first line: which part broke.
 *
 * Matched on what the worker writes, with a plain fallback — a heading invented
 * from an unrecognised message would be a guess presented as a diagnosis.
 */
function headlineFor(error: string | null): string {
  if (!error) return "The dub could not be generated"
  if (/separation/i.test(error)) return "Audio separation failed"
  if (/mixing/i.test(error)) return "Mixing the dubbed audio failed"
  if (/translation/i.test(error)) return "The translation is not ready"
  if (/voice settings/i.test(error)) return "No voice settings were saved"
  if (/separator/i.test(error)) return "No audio separator is available"
  return "The dub could not be generated"
}

function explanationFor(error: string | null): string {
  if (!error) return "Try generating it again."
  if (/ran out of memory/i.test(error)) {
    return "The separator was stopped by the system, most likely for memory. Trying again may work, and a shorter video will need less."
  }
  if (/stopped reporting progress/i.test(error)) {
    return "The separator stopped responding and was ended. Trying again usually works."
  }
  if (/separation/i.test(error)) {
    return "The local separator could not finish processing this video. Nothing was sent anywhere."
  }
  // A short, already-human message is better than a paraphrase of it.
  return error.length <= 200 ? error : "Open technical details for the full output."
}
