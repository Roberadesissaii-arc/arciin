/**
 * Deciding when a progress reading is worth writing down.
 *
 * The separator reports 123 times over ninety minutes, and synthesis reports
 * once per segment; both are cheap to observe and not cheap to persist. Writing
 * every reading turns a dub into a stream of database updates, and on a machine
 * whose CPU is already the bottleneck that is work taken directly from the job
 * the user is waiting for.
 *
 * Writing too rarely is the opposite failure, and the more important one: the
 * whole point of persisting progress is that a person can see the number move.
 * A dub that shows 32% for eleven minutes is indistinguishable from a dead
 * worker.
 *
 * So: write when the number has moved enough to be visible, or when enough time
 * has passed that silence would start to look like a stall — whichever comes
 * first. Deterministic and clock-injectable, because "it writes about the right
 * amount" is not something to establish by watching logs.
 */

export type ProgressThrottleOptions = {
  /** Percentage points of movement that justify a write. */
  minPercentDelta?: number
  /** Write anyway after this long, so the timestamp keeps proving liveness. */
  minIntervalMs?: number
  /** Injectable for tests. */
  now?: () => number
}

export class ProgressThrottle {
  private readonly minPercentDelta: number
  private readonly minIntervalMs: number
  private readonly now: () => number

  private lastPercent: number | null = null
  private lastWriteAt = 0

  constructor(options: ProgressThrottleOptions = {}) {
    this.minPercentDelta = options.minPercentDelta ?? 1
    this.minIntervalMs = options.minIntervalMs ?? 10_000
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Whether to persist this reading.
   *
   * Calling it records the decision, so it must be called once per reading and
   * its answer acted on — asking twice about the same reading would report the
   * second as already written.
   */
  shouldWrite(percent: number): boolean {
    const at = this.now()

    // The first reading of a stage always lands: it is what replaces "unknown".
    if (this.lastPercent === null) {
      this.lastPercent = percent
      this.lastWriteAt = at
      return true
    }

    const moved = Math.abs(percent - this.lastPercent) >= this.minPercentDelta
    const waited = at - this.lastWriteAt >= this.minIntervalMs
    // Completion is always worth recording, however little it moved.
    const finished = percent >= 100 && this.lastPercent < 100

    if (!moved && !waited && !finished) return false

    this.lastPercent = percent
    this.lastWriteAt = at
    return true
  }

  /** A new stage starts from nothing, so the next reading is a first reading. */
  reset(): void {
    this.lastPercent = null
    this.lastWriteAt = 0
  }
}

/**
 * Whether a running job has gone quiet for long enough to say so.
 *
 * Not a failure judgement. Separation on this hardware genuinely produces
 * nothing for tens of seconds at a time, and calling that dead would be wrong
 * far more often than right — so this only decides whether the UI should stop
 * claiming smooth progress and admit it has not heard anything lately.
 */
export const STALL_NOTICE_MS = 5 * 60 * 1000

export function isProgressStale(
  progressUpdatedAt: Date | string | null | undefined,
  nowMs = Date.now(),
  thresholdMs = STALL_NOTICE_MS,
): boolean {
  if (!progressUpdatedAt) return false
  const at = new Date(progressUpdatedAt).getTime()
  if (!Number.isFinite(at)) return false
  return nowMs - at >= thresholdMs
}
