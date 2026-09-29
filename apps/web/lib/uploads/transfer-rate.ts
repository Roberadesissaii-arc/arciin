/**
 * Upload speed and time-remaining that do not lie.
 *
 * The File Request page used to smooth an "instant" speed computed whenever
 * the browser reported progress. Browser upload progress counts bytes handed
 * to the socket, not bytes delivered: a 16 MiB chunk "goes" in a moment, then
 * nothing is reported while a slow uplink or a tunnel drains it. Sampled that
 * way the speed swung between several times too fast and several times too
 * slow — through a quick tunnel at a steady ~3 MB/s one file's estimate
 * wandered from 3 to 26 minutes, and a 3.9 GB upload over a ~5 Mbps uplink
 * showed about 8 hours when it had under two left.
 *
 * Here speed comes only from bytes the server has *confirmed*, measured
 * between confirmation boundaries (the start of the attempt and each
 * acknowledged chunk), so the burst of socket buffering never enters it. A
 * chunk that is overdue stretches the measured time as it waits, so a stall
 * slows the estimate down steadily rather than freezing it or collapsing it.
 * Nothing is shown until the first chunk is confirmed, and the time-remaining
 * only moves when it has genuinely changed.
 *
 * Pure: the caller supplies timestamps, so every rule is unit-testable.
 */

/** Confirmations older than this are dropped… */
export const RATE_WINDOW_MS = 60_000
/** …but at least this many recent intervals are always kept, so a slow link averages over several chunks. */
const MIN_INTERVALS = 3
/** No estimate before this much time, whatever has been confirmed. */
export const WARMUP_MS = 3_000
/** A chunk this much later than usual (and at least STALL_MIN_MS late) means nothing is moving. */
const STALL_FACTOR = 3
const STALL_MIN_MS = 30_000
/** A new ETA replaces the shown one only if it differs by more than this fraction… */
const ETA_HYSTERESIS = 0.15
/** …or the shown one is older than this. */
const ETA_MAX_AGE_MS = 10_000

type Boundary = { at: number; bytes: number }

export class TransferRate {
  private boundaries: Boundary[] = []
  private startedAt: number | null = null
  private shownEta: { seconds: number; at: number } | null = null

  /** Start measuring: bytes are counted from here. Call when an attempt starts or resumes. */
  begin(at: number): void {
    this.boundaries = [{ at, bytes: 0 }]
    this.startedAt = at
    this.shownEta = null
  }

  /**
   * The server has confirmed `bytes` since begin() (cumulative). Going
   * backwards means the measurement no longer describes reality: start over.
   */
  record(bytes: number, at: number): void {
    if (this.startedAt == null) this.begin(at)
    const last = this.boundaries[this.boundaries.length - 1]!
    if (bytes < last.bytes) {
      this.begin(at)
      return
    }
    if (bytes === last.bytes) return
    this.boundaries.push({ at: Math.max(at, last.at), bytes })
    const cutoff = at - RATE_WINDOW_MS
    while (this.boundaries.length > MIN_INTERVALS + 1 && this.boundaries[0]!.at < cutoff) this.boundaries.shift()
  }

  /** Forget everything: after a pause, a reconnect, or a new batch. */
  reset(): void {
    this.boundaries = []
    this.startedAt = null
    this.shownEta = null
  }

  /** Bytes per second; 0 when stalled; null while measuring. */
  bytesPerSecond(at: number): number | null {
    const first = this.boundaries[0]
    const last = this.boundaries[this.boundaries.length - 1]
    if (!first || !last || this.startedAt == null) return null
    if (this.boundaries.length < 2 || at - this.startedAt < WARMUP_MS) return null
    const measured = last.at - first.at
    if (measured <= 0) return null
    const intervals = this.boundaries.length - 1
    const usualGap = measured / intervals
    const sinceLast = Math.max(0, at - last.at)
    if (sinceLast > Math.max(STALL_MIN_MS, usualGap * STALL_FACTOR)) return 0
    // Time the next confirmation is overdue counts as time with no bytes.
    const overdue = Math.max(0, sinceLast - usualGap)
    return ((last.bytes - first.bytes) * 1000) / (measured + overdue)
  }

  /** Seconds left for `remainingBytes`, held steady against small wobbles; null when unknown. */
  secondsRemaining(remainingBytes: number, at: number): number | null {
    const rate = this.bytesPerSecond(at)
    if (rate == null || rate <= 0) {
      this.shownEta = null
      return null
    }
    const raw = Math.max(0, remainingBytes) / rate
    const shown = this.shownEta
    if (shown) {
      // What was shown, counted down by the time since.
      const projected = Math.max(0, shown.seconds - (at - shown.at) / 1000)
      const drift = Math.abs(raw - projected) / Math.max(projected, 1)
      if (drift <= ETA_HYSTERESIS && at - shown.at < ETA_MAX_AGE_MS) return projected
    }
    this.shownEta = { seconds: raw, at }
    return raw
  }
}

/**
 * "about 2 min left". Rounded coarsely on purpose: a precise-looking number
 * from an estimate is false precision.
 */
export function formatTimeRemaining(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null
  if (seconds < 10) return "a few seconds left"
  if (seconds < 60) return `about ${Math.ceil(seconds / 10) * 10} s left`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min left`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round((minutes % 60) / 5) * 5
  if (rest === 0 || hours >= 10) return `about ${hours} h left`
  if (rest === 60) return `about ${hours + 1} h left`
  return `about ${hours} h ${rest} min left`
}
