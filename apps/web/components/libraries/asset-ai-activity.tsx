"use client"

import { AlertTriangle, Globe, Loader2 } from "lucide-react"

import { estimateRemaining } from "@arciin/types"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AssetAiSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * What a card says about AI work, on the thumbnail and under the title.
 *
 * Two different things, deliberately kept apart.
 *
 * The thumbnail carries the *transient* state: something is running, or
 * something failed. It is small and in the corner because a grid of a hundred
 * videos should not become a wall of spinners, and it must never cover the
 * picture or the title.
 *
 * The metadata line carries the *permanent* state: how many languages this file
 * has, and whether any of them can be heard. That belongs under the title with
 * the size and the date, in the same grey, because it is a property of the file
 * rather than an event — and it stays visible while another language generates,
 * since a running job is no reason to hide what already exists.
 *
 * Every value comes from the listing response. Nothing here fetches.
 */

/** Statuses are per asset, so several cards can each show their own. */
export function AssetAiIndicator({
  ai,
  onOpen,
  filename,
}: {
  ai: AssetAiSummary | undefined
  /** Opens the panel at the operation this indicator describes. */
  onOpen?: () => void
  filename: string
}) {
  const activity = ai?.activity
  if (!activity) return null

  const running = activity.status === "running"
  const eta = activity.samples?.length ? estimateRemaining(activity.samples) : null
  const label = running
    ? `${activity.label} — ${activity.stage ?? "working"}`
    : `${activity.label} failed`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-no-marquee
          data-testid="asset-ai-indicator"
          data-ai-status={activity.status}
          data-ai-kind={activity.kind}
          aria-label={`${label}. Open AI details for ${filename}`}
          onClick={(event) => {
            // The card beneath would select or open the previewer instead.
            event.preventDefault()
            event.stopPropagation()
            onOpen?.()
          }}
          className={cn(
            "absolute right-1.5 top-1.5 z-20 flex size-6 items-center justify-center rounded-full",
            "backdrop-blur-sm transition-transform duration-150 hover:scale-110",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
            running
              ? "bg-[rgba(255,79,18,0.92)] text-white"
              : "bg-[rgba(220,38,38,0.92)] text-white",
          )}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <AlertTriangle className="size-3.5" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      {/* Below and end-aligned: a card at the right edge of the grid pushed a
          side tooltip into a two-word-per-line column. */}
      <TooltipContent side="bottom" align="end" className="w-[210px]">
        <p className="text-[12px] font-medium">{activity.label}</p>
        {running ? (
          <>
            <p className="text-[11.5px] opacity-90" data-testid="asset-ai-indicator-stage">
              {activity.stage ?? "Working…"}
            </p>
            {activity.current !== null && activity.total !== null ? (
              <p className="text-[11.5px] tabular-nums opacity-90" data-testid="asset-ai-indicator-progress">
                {activity.current} / {activity.total}
                {activity.percent !== null ? ` · ${activity.percent}%` : ""}
              </p>
            ) : null}
            {/* Only where it is defensible: the same samples the panel uses, and
                nothing at all until enough of them exist. */}
            {eta ? (
              <p className="text-[11.5px] opacity-90" data-testid="asset-ai-indicator-eta">
                {eta.label}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[11.5px] opacity-90">Open AI for details</p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * "3 languages" on the right of the metadata row.
 *
 * Always rendered for media that could have languages, even when the answer is
 * one. That is not padding: a card whose language line disappears is a card
 * whose footer sits a few pixels higher than the ones beside it, and in a grid
 * that reads as misalignment rather than as absence. "1 language" is also true
 * and mildly useful, which is a better trade than a hole.
 *
 * Dubs are deliberately not counted here. The thumbnail already carries the
 * transient state and the panel carries the detail; adding a second figure to a
 * row this narrow made it noisy without answering a question anyone had.
 */
export function AssetAiMetadata({
  ai,
  mediaType,
}: {
  ai: AssetAiSummary | undefined
  mediaType?: string
}) {
  // A photo has no spoken language, so the row would be answering nothing.
  const canHaveLanguages = mediaType === "VIDEO" || mediaType === "AUDIO"
  if (!canHaveLanguages) return null

  const count = Math.max(1, ai?.languageCount ?? 1)

  return (
    <p
      className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-400"
      data-testid="asset-ai-metadata"
      title={
        count > 1
          ? "The original plus its translations"
          : "No translations yet"
      }
    >
      <Globe className="size-3 shrink-0" aria-hidden />
      <span data-testid="asset-ai-languages">
        {count} {count === 1 ? "language" : "languages"}
      </span>
    </p>
  )
}
