/**
 * How much longer, based only on what has actually happened.
 *
 * In the shared types package rather than beside the worker because the browser
 * computes this: the estimate has to move between polls — time spent on the
 * chunk in flight counts — so a value baked at fetch time would freeze for four
 * seconds and then jump. Pure arithmetic over persisted samples, so both sides
 * can run it and neither can invent progress with it.
 *
 * The separator reports completed chunks against a known total, which is the one
 * place in this pipeline where a remaining-time estimate can be honest: the work
 * is uniform, the units are countable, and the rate is observable.
 *
 * Three things make the difference between a useful estimate and a number that
 * erodes trust every time someone looks at it.
 *
 * It waits. At `1/122` the only rate observed includes model loading, and the
 * resulting figure is wrong by a factor of several. Saying "estimating" for the
 * first few chunks costs nothing; being wrong by an hour costs the reader's
 * belief in every subsequent number.
 *
 * It smooths. A single slow chunk should not turn "45 minutes" into "two hours"
 * and back again — measured on this hardware, per-chunk time ranges from 35 to
 * 58 seconds for the same file, so an unsmoothed estimate jumps by a third
 * between adjacent samples for no reason the reader can see.
 *
 * It refuses. If there are not enough samples, or the total is unknown, or the
 * work is not chunked at all, it returns nothing and the UI says what stage it
 * is on instead. A stage name is honest; a fabricated countdown is not.
 */

export type ProgressSample = {
  /** Epoch milliseconds. */
  at: number
  completed: number
  total: number
}

/**
 * How many samples before an estimate is worth showing.
 *
 * Three intervals, which needs four samples. Chosen from the real 122-chunk run:
 * the first interval carries model load and is roughly half again as long as the
 * steady state, so one or two samples systematically overestimate. By the third
 * interval the rate has settled to within about 15%.
 */
export const MIN_SAMPLES_FOR_ETA = 4

/**
 * Weight of the newest interval in the moving average.
 *
 * 0.35 responds to a genuine slowdown within three or four chunks while
 * absorbing a single outlier. Higher was jumpy on the real data; much lower took
 * so long to react that a stalled machine still showed a shrinking estimate.
 */
const EMA_ALPHA = 0.35

/**
 * How far one observation may drag the average.
 *
 * A plain EMA still lurches on a pathological sample: measured, one 180-second
 * chunk against a settled 45-second rate moved the estimate to 92 — it doubled,
 * which is the "40m → 2h" behaviour this is supposed to prevent. Clamping each
 * reading to within a factor of two of the current estimate before folding it in
 * bounds that to about a third, while a *sustained* change still converges in
 * five or six samples because the clamp moves with the estimate.
 */
const MAX_RATE_RATIO = 2

/** Nothing older than this is evidence of the current rate. */
const MAX_SAMPLE_AGE_MS = 30 * 60 * 1000

/** Bounded, because this is persisted on the row and read on every poll. */
export const MAX_SAMPLES = 12

/**
 * Add a sample, keeping the history bounded and monotonic.
 *
 * Out-of-order or duplicate readings are dropped rather than stored: they would
 * produce a zero or negative interval, and one of those poisons the average for
 * several chunks.
 */
export function appendSample(
  history: ProgressSample[],
  sample: ProgressSample,
  maxSamples = MAX_SAMPLES,
): ProgressSample[] {
  const previous = history[history.length - 1]

  // A new phase — a different total — invalidates the old rate entirely.
  if (previous && previous.total !== sample.total) return [sample]

  if (previous && (sample.completed <= previous.completed || sample.at <= previous.at)) {
    return history
  }

  return [...history, sample].slice(-maxSamples)
}

/**
 * Seconds per chunk, weighted towards the recent past, or null.
 *
 * Exported separately from the estimate so the rate can be asserted directly —
 * "the average reacts to a slowdown" is a property of this function, and testing
 * it through a formatted string would be testing two things at once.
 */
export function smoothedSecondsPerChunk(
  history: ProgressSample[],
  now = Date.now(),
): number | null {
  const fresh = history.filter((s) => now - s.at <= MAX_SAMPLE_AGE_MS)
  if (fresh.length < MIN_SAMPLES_FOR_ETA) return null

  let ema: number | null = null
  for (let i = 1; i < fresh.length; i += 1) {
    const previous = fresh[i - 1]!
    const current = fresh[i]!
    const chunks = current.completed - previous.completed
    const seconds = (current.at - previous.at) / 1000
    if (chunks <= 0 || seconds <= 0) continue
    const rate = seconds / chunks
    if (ema === null) {
      ema = rate
      continue
    }
    // Winsorised against the current estimate: one strange chunk is news, but
    // not proof that everything after it will take four times as long.
    const bounded = Math.min(Math.max(rate, ema / MAX_RATE_RATIO), ema * MAX_RATE_RATIO)
    ema = EMA_ALPHA * bounded + (1 - EMA_ALPHA) * ema
  }

  return ema && Number.isFinite(ema) && ema > 0 ? ema : null
}

export type EtaEstimate = {
  secondsRemaining: number
  secondsPerChunk: number
  /** Human, already rounded to a sensible unit. */
  label: string
}

/**
 * The estimate, or nothing.
 *
 * `null` is a normal, frequent answer — early in a run, on a stage that cannot
 * count, or when the samples are too old to mean anything — and callers are
 * expected to show the stage instead rather than to fill the gap.
 */
export function estimateRemaining(
  history: ProgressSample[],
  now = Date.now(),
): EtaEstimate | null {
  const latest = history[history.length - 1]
  if (!latest || latest.total <= 0) return null

  const remaining = latest.total - latest.completed
  if (remaining <= 0) return null

  const secondsPerChunk = smoothedSecondsPerChunk(history, now)
  if (secondsPerChunk === null) return null

  /**
   * Time already spent on the chunk in flight counts.
   *
   * Without this the estimate freezes between samples and then drops by a whole
   * chunk at once, which on a 45-second cadence is visibly jerky.
   */
  const sinceLast = Math.max(0, (now - latest.at) / 1000)
  const secondsRemaining = Math.max(0, remaining * secondsPerChunk - sinceLast)

  return {
    secondsRemaining,
    secondsPerChunk,
    label: formatRemaining(secondsRemaining),
  }
}

/**
 * "About 1 hr 20 min remaining".
 *
 * Rounded to the precision the estimate deserves: seconds under a minute,
 * whole minutes under an hour, hours and minutes above. Reporting "4812.393
 * seconds" claims an accuracy the underlying measurement does not have.
 */
export function formatRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ""
  if (seconds < 45) return "About 30 sec remaining"
  if (seconds < 90) return "About 1 min remaining"

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `About ${minutes} min remaining`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) return `About ${hours} hr remaining`
  return `About ${hours} hr ${rest} min remaining`
}
