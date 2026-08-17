import { describe, expect, it } from "vitest"

import {
  MIN_SAMPLES_FOR_ETA,
  appendSample,
  estimateRemaining,
  formatRemaining,
  smoothedSecondsPerChunk,
  type ProgressSample,
} from "../packages/types/src/separation-eta"

/**
 * Estimating how much longer a separation has to run.
 *
 * The numbers below come from the real 122-chunk job on this machine: chunks
 * between 35 and 58 seconds, the first one slower because it carries model
 * loading. That spread is the whole difficulty — an unsmoothed estimate built on
 * it swings by a third between adjacent samples, and one built on the first
 * sample alone is wrong by a factor of several.
 */

const START = 1_700_000_000_000

/** Samples at a fixed rate, the way a healthy run reports. */
function steady(count: number, secondsPerChunk: number, total = 122): ProgressSample[] {
  return Array.from({ length: count }, (_, i) => ({
    at: START + i * secondsPerChunk * 1000,
    completed: i,
    total,
  }))
}

describe("appendSample", () => {
  it("keeps the history bounded", () => {
    let history: ProgressSample[] = []
    for (let i = 0; i < 40; i += 1) {
      history = appendSample(history, { at: START + i * 45_000, completed: i, total: 122 }, 12)
    }
    expect(history).toHaveLength(12)
    // The newest, because old rates are not evidence of the current one.
    expect(history[history.length - 1]!.completed).toBe(39)
  })

  it("drops a repeated or out-of-order reading", () => {
    const history = steady(3, 45)
    // A duplicate would give a zero interval, which poisons the average for
    // several chunks afterwards.
    expect(appendSample(history, { at: START + 90_000, completed: 2, total: 122 })).toHaveLength(3)
    expect(appendSample(history, { at: START + 10_000, completed: 5, total: 122 })).toHaveLength(3)
  })

  it("starts over when the total changes, because that is a new phase", () => {
    const history = steady(6, 45)
    const next = appendSample(history, { at: START + 400_000, completed: 1, total: 8 })
    expect(next).toHaveLength(1)
    expect(next[0]!.total).toBe(8)
  })
})

describe("smoothedSecondsPerChunk", () => {
  it("refuses to guess from too few samples", () => {
    for (let n = 0; n < MIN_SAMPLES_FOR_ETA; n += 1) {
      expect(smoothedSecondsPerChunk(steady(n, 45), START + n * 45_000)).toBeNull()
    }
    expect(smoothedSecondsPerChunk(steady(MIN_SAMPLES_FOR_ETA, 45), START + 200_000)).not.toBeNull()
  })

  it("recovers the rate of a steady run", () => {
    const rate = smoothedSecondsPerChunk(steady(8, 45), START + 400_000)
    expect(rate).toBeGreaterThan(44)
    expect(rate).toBeLessThan(46)
  })

  it("absorbs a single slow chunk instead of lurching", () => {
    /**
     * The failure this prevents: one 3-minute chunk turning a 45-minute estimate
     * into two hours, then back again on the next sample.
     */
    const history = steady(8, 45)
    const outlier = [
      ...history,
      { at: history[7]!.at + 180_000, completed: 8, total: 122 },
    ]
    const rate = smoothedSecondsPerChunk(outlier, outlier[8]!.at)!
    // Moved towards the slow reading, but nowhere near it: a plain EMA put this
    // at 92 — a doubling off one sample, which is exactly the lurching the
    // requirement rules out.
    expect(rate).toBeGreaterThan(45)
    expect(rate).toBeLessThan(70)
  })

  it("does follow a sustained slowdown", () => {
    // Absorbing an outlier must not mean ignoring a real change.
    let history = steady(6, 40)
    let at = history[5]!.at
    for (let i = 6; i < 14; i += 1) {
      at += 80_000
      history = appendSample(history, { at, completed: i, total: 122 })
    }
    const rate = smoothedSecondsPerChunk(history, at)!
    expect(rate).toBeGreaterThan(65)
  })

  it("ignores samples too old to describe the present", () => {
    const stale = steady(8, 45)
    // An hour later, none of it is evidence of the current rate.
    expect(smoothedSecondsPerChunk(stale, START + 60 * 60 * 1000 + 400_000)).toBeNull()
  })
})

describe("estimateRemaining", () => {
  it("produces a defensible figure for the real job", () => {
    /**
     * The actual shape: 122 chunks at about 45 seconds. At chunk 15 there are
     * 107 left, which is roughly 80 minutes.
     */
    const history = steady(16, 45)
    const now = history[15]!.at
    const eta = estimateRemaining(history, now)!

    expect(eta.secondsPerChunk).toBeGreaterThan(43)
    expect(eta.secondsPerChunk).toBeLessThan(47)
    const minutes = eta.secondsRemaining / 60
    expect(minutes).toBeGreaterThan(70)
    expect(minutes).toBeLessThan(90)
    expect(eta.label).toMatch(/^About 1 hr \d+ min remaining$/)
  })

  it("says nothing at the start, where an estimate would be garbage", () => {
    // 1/122 has one interval, and it includes model loading.
    expect(estimateRemaining(steady(2, 90), START + 90_000)).toBeNull()
  })

  it("shrinks as the work proceeds", () => {
    const early = estimateRemaining(steady(10, 45), START + 9 * 45_000)!
    const later = estimateRemaining(steady(60, 45), START + 59 * 45_000)!
    expect(later.secondsRemaining).toBeLessThan(early.secondsRemaining)
  })

  it("counts time spent on the chunk in flight", () => {
    const history = steady(10, 45)
    const atSample = estimateRemaining(history, history[9]!.at)!
    const thirtySecondsLater = estimateRemaining(history, history[9]!.at + 30_000)!
    // Otherwise the number freezes between samples and then drops by a whole
    // chunk at once, which on a 45-second cadence is visibly jerky.
    expect(thirtySecondsLater.secondsRemaining).toBeLessThan(atSample.secondsRemaining)
    expect(atSample.secondsRemaining - thirtySecondsLater.secondsRemaining).toBeCloseTo(30, 0)
  })

  it("says nothing once the work is done", () => {
    const history = steady(122, 45)
    const finished = appendSample(history, {
      at: START + 122 * 45_000,
      completed: 122,
      total: 122,
    })
    expect(estimateRemaining(finished, START + 122 * 45_000)).toBeNull()
  })

  it("says nothing when the stage cannot count", () => {
    expect(estimateRemaining([], START)).toBeNull()
    expect(estimateRemaining([{ at: START, completed: 0, total: 0 }], START)).toBeNull()
  })

  it("does not swing wildly between adjacent samples", () => {
    /**
     * The explicit requirement: no 40m → 2h → 31m → 3h. Walks a run whose chunk
     * times vary the way the real one did and checks every consecutive pair.
     */
    const durations = [45, 38, 52, 41, 58, 35, 47, 44, 50, 39, 55, 42, 46, 40]
    let history: ProgressSample[] = [{ at: START, completed: 0, total: 122 }]
    let at = START
    const seen: number[] = []
    durations.forEach((seconds, index) => {
      at += seconds * 1000
      history = appendSample(history, { at, completed: index + 1, total: 122 })
      const eta = estimateRemaining(history, at)
      if (eta) seen.push(eta.secondsRemaining)
    })

    expect(seen.length).toBeGreaterThan(5)
    for (let i = 1; i < seen.length; i += 1) {
      const change = Math.abs(seen[i]! - seen[i - 1]!) / seen[i - 1]!
      expect(change, `estimate jumped ${(change * 100).toFixed(0)}% at sample ${i}`).toBeLessThan(
        0.2,
      )
    }
  })
})

describe("formatRemaining", () => {
  it("uses the precision the measurement deserves", () => {
    expect(formatRemaining(30)).toBe("About 30 sec remaining")
    expect(formatRemaining(60)).toBe("About 1 min remaining")
    expect(formatRemaining(8 * 60)).toBe("About 8 min remaining")
    expect(formatRemaining(80 * 60)).toBe("About 1 hr 20 min remaining")
    expect(formatRemaining(120 * 60)).toBe("About 2 hr remaining")
  })

  it("never reports a false precision", () => {
    expect(formatRemaining(4812.393)).toBe("About 1 hr 20 min remaining")
    expect(formatRemaining(4812.393)).not.toContain(".")
  })

  it("has nothing to say about nonsense", () => {
    expect(formatRemaining(-5)).toBe("")
    expect(formatRemaining(Number.NaN)).toBe("")
  })
})
