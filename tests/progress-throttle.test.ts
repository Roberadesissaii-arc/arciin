import { describe, expect, it } from "vitest"

import {
  ProgressThrottle,
  STALL_NOTICE_MS,
  isProgressStale,
} from "../packages/media-ai/src/progress-throttle"

/**
 * How often a running job writes down where it has got to.
 *
 * Two failures are possible and they pull in opposite directions. Writing every
 * reading turns one dub into a stream of database updates, on a machine whose
 * CPU is already what the reader is waiting for. Writing too rarely defeats the
 * entire point: a bar stuck at 32% for eleven minutes is indistinguishable from
 * a dead worker.
 *
 * The clock is injected so both are provable rather than plausible.
 */

/** A clock a test can drive. */
function fakeClock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe("ProgressThrottle", () => {
  it("always writes the first reading, because it replaces 'unknown'", () => {
    const clock = fakeClock()
    const throttle = new ProgressThrottle({ now: clock.now })
    expect(throttle.shouldWrite(0)).toBe(true)
  })

  it("skips a reading that has not moved and has not waited", () => {
    const clock = fakeClock()
    const throttle = new ProgressThrottle({ now: clock.now, minPercentDelta: 1, minIntervalMs: 10_000 })
    throttle.shouldWrite(32)
    clock.advance(200)
    expect(throttle.shouldWrite(32)).toBe(false)
  })

  it("writes once the number has visibly moved", () => {
    const clock = fakeClock()
    const throttle = new ProgressThrottle({ now: clock.now, minPercentDelta: 1, minIntervalMs: 10_000 })
    throttle.shouldWrite(32)
    clock.advance(200)
    expect(throttle.shouldWrite(33)).toBe(true)
  })

  it("writes on time alone, so the timestamp keeps proving liveness", () => {
    const clock = fakeClock()
    const throttle = new ProgressThrottle({ now: clock.now, minPercentDelta: 5, minIntervalMs: 10_000 })
    throttle.shouldWrite(32)
    clock.advance(11_000)
    // Same percentage — but eleven seconds of silence would start to look like
    // a stall, and the whole reason for persisting is to show it is not.
    expect(throttle.shouldWrite(32)).toBe(true)
  })

  it("always records completion", () => {
    const clock = fakeClock()
    const throttle = new ProgressThrottle({ now: clock.now, minPercentDelta: 50, minIntervalMs: 60_000 })
    throttle.shouldWrite(99)
    clock.advance(10)
    expect(throttle.shouldWrite(100)).toBe(true)
  })

  it("writes at a sane rate through a real 122-chunk separation", () => {
    /**
     * The actual shape of the job that prompted this: 122 chunks at roughly 45
     * seconds each, ninety-two minutes end to end.
     *
     * Every reading is persisted here, and that is the right answer — a chunk
     * only arrives every 45 seconds, so each one is genuinely news. What matters
     * is the *rate*: the thing to avoid is 122 writes in a few milliseconds, not
     * 122 writes spread across an hour and a half.
     */
    const clock = fakeClock()
    const start = clock.now()
    const throttle = new ProgressThrottle({ now: clock.now, minPercentDelta: 1, minIntervalMs: 10_000 })
    let writes = 0
    for (let chunk = 0; chunk <= 122; chunk += 1) {
      if (throttle.shouldWrite(Math.round((chunk / 122) * 100))) writes += 1
      clock.advance(45_000)
    }

    const minutes = (clock.now() - start) / 60_000
    expect(writes / minutes, "writes per minute").toBeLessThan(2)
    // And it did keep up: a bar that only moved ten times over ninety minutes
    // would be useless.
    expect(writes).toBeGreaterThan(100)
  })

  it("collapses a fast stage into very few writes", () => {
    // Synthesis of a short video reports several times a second; the interval
    // rule must not turn that into a write per report.
    const clock = fakeClock()
    const throttle = new ProgressThrottle({ now: clock.now, minPercentDelta: 5, minIntervalMs: 10_000 })
    let writes = 0
    for (let i = 0; i <= 100; i += 1) {
      if (throttle.shouldWrite(i)) writes += 1
      clock.advance(50)
    }
    expect(writes).toBeLessThanOrEqual(22)
  })

  it("treats the first reading after a stage change as a first reading", () => {
    const clock = fakeClock()
    const throttle = new ProgressThrottle({ now: clock.now, minPercentDelta: 10, minIntervalMs: 60_000 })
    throttle.shouldWrite(100)
    throttle.reset()
    clock.advance(10)
    // Otherwise a new stage starting at 0% would be suppressed as a decrease,
    // and the panel would still show the previous stage finished.
    expect(throttle.shouldWrite(0)).toBe(true)
  })
})

describe("isProgressStale", () => {
  it("says nothing about a job that has never reported", () => {
    expect(isProgressStale(null)).toBe(false)
  })

  it("is quiet while the number is moving", () => {
    const now = Date.now()
    expect(isProgressStale(new Date(now - 30_000), now)).toBe(false)
  })

  it("notices when nothing has moved for an unusually long time", () => {
    const now = Date.now()
    expect(isProgressStale(new Date(now - STALL_NOTICE_MS - 1000), now)).toBe(true)
  })

  it("tolerates a serialised timestamp, which is what the browser gets", () => {
    const now = Date.now()
    expect(isProgressStale(new Date(now - 10 * 60_000).toISOString(), now)).toBe(true)
  })

  it("refuses to guess from a broken value", () => {
    expect(isProgressStale("not a date")).toBe(false)
  })

  it("does not call a slow separation dead", () => {
    /**
     * Deliberate: this reports "we have not heard anything lately", never
     * "failed". On this CPU a chunk takes up to a minute, and a job that is
     * simply slow must not be presented as broken.
     */
    const now = Date.now()
    expect(isProgressStale(new Date(now - 60_000), now)).toBe(false)
  })
})
