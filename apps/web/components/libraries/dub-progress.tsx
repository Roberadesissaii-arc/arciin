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
import { estimateRemaining } from "@arciin/types"
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
 * The remaining time is real, and it waits. It comes from persisted samples of
 * the separator's own chunk counter, smoothed, and withheld until enough
 * intervals have been observed — at 1 of 122 the only rate seen includes model
 * loading and the figure would be wrong by a factor of several. A stage that
 * cannot count gets its name and an indeterminate bar instead, because one
 * honest stage name beats one fabricated countdown.
 */

/** After this much silence, say so rather than implying smooth progress. */
const STALL_NOTICE_MS = 5 * 60 * 1000

/**
 * How often the estimate and the "last updated" line recompute.
 *
 * Display only — it recomputes from persisted samples and never invents
 * progress. Five seconds so the remaining time visibly counts down between the
 * four-second polls rather than stepping in whole chunks.
 */
const TICK_MS = 5_000

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

export function DubProgress({
  dub,
  processingLabel,
}: {
  dub: MediaDub
  /** "Running locally", or the cloud provider's name. */
  processingLabel?: string
}) {
  const running = isDubRunning(dub.status)
  const now = useNow(running)

  const percent = dub.progressPercent
  const hasCounter =
    dub.progressCurrent !== null && dub.progressTotal !== null && dub.progressTotal > 0

  /**
   * The estimate, computed in the browser from persisted samples.
   *
   * Here rather than on the server because it has to move between polls — the
   * time spent on the chunk in flight counts, and a value baked at fetch time
   * would freeze for four seconds and then jump.
   */
  const eta = dub.progressSamples?.length ? estimateRemaining(dub.progressSamples, now) : null

  /**
   * The counted work is done, but the stage is not.
   *
   * This is the gap that made a working job look broken. The separator's counter
   * measures its *chunk loop*, and when that loop ends Demucs still has to
   * overlap-add every chunk back into four full-length stems and write them —
   * observed on a 12-minute video, thirty-plus minutes holding a gigabyte of
   * float arrays, emitting nothing at all.
   *
   * So the bar sat at 100%, the ETA fell back to "Estimating time…", and the
   * stall notice announced that nothing had been heard for half an hour. Every
   * one of those was locally true and collectively a lie: the job was fine and
   * working hard.
   *
   * Inferred here rather than reported by the worker because nothing can report
   * it — the separator is mid-run and silent, so there is no event to hang a
   * stage change on. Counter complete plus stage still SEPARATING is exactly
   * that window.
   */
  const finalising =
    dub.status === "SEPARATING" &&
    hasCounter &&
    (dub.progressCurrent ?? 0) >= (dub.progressTotal ?? 0)

  const updatedAgo = dub.progressUpdatedAt ? now - new Date(dub.progressUpdatedAt).getTime() : null
  // Silence during finalising is expected, not evidence of a stall.
  const stalled = !finalising && updatedAgo !== null && updatedAgo >= STALL_NOTICE_MS

  if (!running) return null

  return (
    <div className="space-y-2" data-testid="dub-progress">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-primary">
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
        <span data-testid="dub-progress-stage">
          {finalising ? "Finalising separated audio" : (dub.stage ?? "Working…")}
        </span>
      </p>

      {/*
        Indeterminate when the stage genuinely cannot count, never faked — and
        that includes finalising, where a full bar would claim the stage is over.
      */}
      <Progress
        value={finalising ? null : percent}
        className="h-2"
        data-testid="dub-progress-bar"
        aria-label={finalising ? "Finalising separated audio" : (dub.stage ?? "Dub progress")}
      />

      <div className="flex items-baseline justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span data-testid="dub-progress-counter">
          {finalising
            ? "All audio chunks separated · combining stems"
            : hasCounter
              ? counterLabel(dub.status, dub.progressCurrent!, dub.progressTotal!)
              : "Starting…"}
        </span>
        {/* The percentage belongs to the counted work; showing 100% beside a
            stage that has not finished is the claim that misled. */}
        {percent !== null && !finalising ? (
          <span className="font-medium tabular-nums text-foreground" data-testid="dub-progress-percent">
            {percent}%
          </span>
        ) : null}
      </div>

      {/*
        How much longer, from measured speed only.

        Nothing is shown until enough intervals have been observed: at 1 of 122
        the only rate seen includes model loading, and the resulting figure is
        wrong by a factor of several. "Estimating" costs nothing; being an hour
        out costs belief in every number afterwards.
      */}
      {/*
        No estimate while finalising. There is nothing left to count, and
        "Estimating time…" reappearing after a real figure reads as the estimate
        having given up rather than as the work having moved on.
      */}
      {running && !finalising ? (
        <p className="text-[12px] font-medium text-foreground" data-testid="dub-progress-eta">
          {eta ? eta.label : hasCounter ? "Estimating time…" : ""}
        </p>
      ) : null}

      {finalising ? (
        <p className="text-[12px] text-muted-foreground" data-testid="dub-progress-finalising">
          This last stage reports no progress and can take several minutes on a long video.
        </p>
      ) : null}

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
          <p className="font-medium text-foreground">{processingLabel ?? "Running locally"}</p>
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
