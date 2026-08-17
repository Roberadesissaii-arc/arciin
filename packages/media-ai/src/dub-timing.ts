/**
 * Fitting generated speech back onto the original timeline.
 *
 * The original recording owns the clock. A translated line is very often longer
 * than what it replaces — Spanish runs perhaps 20% longer than English — so
 * something has to give, and the order it gives in matters:
 *
 *   1. ask for the right duration when generating (see `paceInstruction`),
 *   2. nudge with a small, inaudible time-stretch,
 *   3. admit defeat and flag the segment.
 *
 * Step 3 is the important one. Squeezing 6 seconds of speech into 3 by playing
 * it at 2× produces a chipmunk that no one can follow, and shipping that is
 * worse than saying "this segment needs review".
 */

/**
 * How far speech may be stretched or compressed before it stops sounding human.
 *
 * Chosen conservatively. Beyond roughly ±15% the artefacts of rate change become
 * audible even with a good algorithm, and the point of the ceiling is to stop
 * the pipeline producing something embarrassing rather than to maximise how many
 * segments it can force to fit.
 */
export const MIN_RATE = 0.85
export const MAX_RATE = 1.15

/** Under this, a mismatch is not worth correcting at all. */
export const TOLERANCE_MS = 120

export type FitInput = {
  startMs: number
  endMs?: number
  /** How long the generated audio actually came out. */
  actualMs: number
  speaker?: string
}

export type FitResult = {
  startMs: number
  /** The slot on the original timeline. */
  targetMs: number
  actualMs: number
  /** 1 = untouched. Applied with an atempo-style filter. */
  rate: number
  /** True when even the bounded rate could not make it fit. */
  needsReview: boolean
  /** Why, in words a person can act on. */
  reason?: string
  speaker?: string
}

/**
 * Work out what to do with one generated segment.
 *
 * A segment that came out *shorter* than its slot is left alone rather than
 * stretched: the gap simply plays original background, which is what a pause
 * sounds like anyway.
 */
export function fitSegment(input: FitInput): FitResult {
  const targetMs = Math.max(0, (input.endMs ?? input.startMs) - input.startMs)
  const base = {
    startMs: input.startMs,
    targetMs,
    actualMs: input.actualMs,
    ...(input.speaker ? { speaker: input.speaker } : {}),
  }

  // No slot to fit into — the caller will place it and let it run.
  if (targetMs <= 0) return { ...base, rate: 1, needsReview: false }

  const difference = input.actualMs - targetMs
  if (Math.abs(difference) <= TOLERANCE_MS) {
    return { ...base, rate: 1, needsReview: false }
  }

  // Shorter than the slot: leave it, and let the background fill the rest.
  if (difference < 0) return { ...base, rate: 1, needsReview: false }

  const required = input.actualMs / targetMs
  if (required <= MAX_RATE) {
    return { ...base, rate: round(required), needsReview: false }
  }

  // Compress as far as is decent, and say plainly that it still does not fit.
  return {
    ...base,
    rate: MAX_RATE,
    needsReview: true,
    reason: `Translated speech runs ${(input.actualMs / 1000).toFixed(1)}s in a ${(targetMs / 1000).toFixed(1)}s slot — ${required.toFixed(2)}× is past the ${MAX_RATE}× limit for natural speech.`,
  }
}

export function fitSegments(inputs: FitInput[]): FitResult[] {
  return inputs.map(fitSegment)
}

/** Everything a person would want to know about how well the fit went. */
export function summariseFit(results: FitResult[]): {
  total: number
  adjusted: number
  needsReview: number
  maxRate: number
} {
  return {
    total: results.length,
    adjusted: results.filter((r) => r.rate !== 1).length,
    needsReview: results.filter((r) => r.needsReview).length,
    maxRate: results.reduce((max, r) => Math.max(max, r.rate), 1),
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export type PlacedSegment = {
  startMs: number
  playMs: number
  rate: number
  shiftedBy: number
  /** Trimmed because it would otherwise have run past the end of the picture. */
  clamped: boolean
}

/**
 * Where each segment sits, in order, without overlapping its neighbour — and
 * without running past the end of the video.
 *
 * Avoiding overlap means pushing a late-running segment back, because two
 * voices from one mono track talking over each other is unlistenable. But
 * pushing alone is not a solution: on the real ten-second fixture it produced a
 * 12.77-second dub, and speech that begins after the picture has finished is
 * speech nobody will ever hear.
 *
 * So the shifting is bounded by the media. A segment that cannot fit inside
 * what remains is trimmed to the remaining time and flagged; a segment with no
 * time left at all is reported rather than appended past the end. The honest
 * outcome for an impossible timeline is a dub marked for review, not one that
 * outlives its video.
 */
export function layoutTimeline(
  results: FitResult[],
  /** The picture's length. Omit only when it is genuinely unknown. */
  mediaDurationMs?: number,
): PlacedSegment[] {
  const ordered = [...results].sort((a, b) => a.startMs - b.startMs)
  const placed: PlacedSegment[] = []
  let cursor = 0

  for (const result of ordered) {
    const wanted = Math.round(result.actualMs / result.rate)
    const startMs = Math.max(result.startMs, cursor)

    let playMs = wanted
    let clamped = false
    if (mediaDurationMs !== undefined && mediaDurationMs > 0) {
      const remaining = mediaDurationMs - startMs
      if (remaining <= 0) {
        // No room left. Recorded as clamped to nothing rather than placed
        // beyond the picture, so the caller can mark the dub for review.
        placed.push({ startMs: Math.min(startMs, mediaDurationMs), playMs: 0, rate: result.rate, shiftedBy: startMs - result.startMs, clamped: true })
        cursor = mediaDurationMs
        continue
      }
      if (wanted > remaining) {
        playMs = remaining
        clamped = true
      }
    }

    placed.push({
      startMs,
      playMs,
      rate: result.rate,
      shiftedBy: startMs - result.startMs,
      clamped,
    })
    cursor = startMs + playMs
  }
  return placed
}

/**
 * How far past the picture the dub would run if nothing were clamped.
 *
 * Used to decide whether a line needs rewriting for speech before any of it is
 * generated a second time.
 */
export function timelineOverrunMs(results: FitResult[], mediaDurationMs: number): number {
  const laid = layoutTimeline(results)
  const end = laid.reduce((max, p) => Math.max(max, p.startMs + p.playMs), 0)
  return Math.max(0, end - mediaDurationMs)
}

/**
 * How much shorter a line needs to be, as a fraction of what it is now.
 *
 * Expressed as a ratio because that is what a rewrite instruction can act on:
 * "about two thirds as long" is followable, "1,400 ms shorter" is not.
 */
export function adaptationRatio(targetMs: number, actualMs: number): number {
  if (targetMs <= 0 || actualMs <= 0) return 1
  // Aim at the slot times the rate we are willing to apply, so the rewrite and
  // the stretch share the work rather than the rewrite doing all of it.
  const reachable = targetMs * MAX_RATE
  if (actualMs <= reachable) return 1
  return Math.max(0.35, reachable / actualMs)
}
