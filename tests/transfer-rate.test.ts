import { describe, expect, it } from "vitest"

import { TransferRate, WARMUP_MS, formatTimeRemaining } from "../apps/web/lib/uploads/transfer-rate"

/**
 * The File Request page's speed and time-left estimate, fed only with bytes
 * the server confirmed (one boundary per acknowledged chunk).
 *
 * The replays use the chunk timings measured on real paths: ~5.6 s per 16 MiB
 * chunk through a quick tunnel (~3 MB/s), and 5.7–89 s (p50 16.5 s) per chunk
 * for the production 3.9 GB upload over a ~5 Mbps uplink.
 */

const MiB = 1024 * 1024
const CHUNK = 16 * MiB

/** Acknowledge chunks at the given durations (seconds); evaluate every second. */
function replay(durations: number[], total: number, until = Number.POSITIVE_INFINITY) {
  const rate = new TransferRate()
  rate.begin(0)
  const acks: number[] = []
  let t = 0
  for (const d of durations) acks.push((t += d))
  const out: Array<{ t: number; speed: number | null; eta: number | null; confirmed: number }> = []
  let next = 0
  let confirmed = 0
  for (let s = 1; s <= Math.min(until, Math.ceil(t)); s++) {
    while (next < acks.length && acks[next]! <= s) {
      confirmed = Math.min(total, confirmed + CHUNK)
      rate.record(confirmed, acks[next]! * 1000)
      next++
    }
    out.push({ t: s, speed: rate.bytesPerSecond(s * 1000), eta: rate.secondsRemaining(total - confirmed, s * 1000), confirmed })
  }
  return out
}

/** A deterministic spread around a median, like the production chunk timings. */
function jittered(n: number, median: number, spread: number) {
  return Array.from({ length: n }, (_, i) => median * (1 + spread * Math.sin(i * 2.399)))
}

describe("TransferRate", () => {
  it("shows nothing before the first confirmed chunk, however long that takes", () => {
    const shown = replay([26], 3901 * MiB)
    expect(shown.filter((s) => s.t < 26).every((s) => s.speed == null && s.eta == null)).toBe(true)
  })

  it("shows nothing during warm-up even if a chunk lands immediately", () => {
    const rate = new TransferRate()
    rate.begin(0)
    rate.record(CHUNK, 500)
    expect(rate.bytesPerSecond(WARMUP_MS - 1)).toBeNull()
    expect(rate.bytesPerSecond(WARMUP_MS)).not.toBeNull()
  })

  it("a steady link is measured exactly", () => {
    const shown = replay(Array(40).fill(4), 1024 * MiB)
    const last = shown.at(-1)!
    expect(last.speed! / (CHUNK / 4)).toBeCloseTo(1, 2)
  })

  it("quick tunnel (~3 MB/s): within ±15% of the truth, and never 3–26 min swings", () => {
    const total = 1024 * MiB
    const durations = jittered(64, 5.6, 0.25)
    const truth = (64 * CHUNK) / durations.reduce((a, b) => a + b, 0)
    const shown = replay(durations, total).filter((s) => s.t >= 20 && s.speed)
    for (const s of shown) {
      expect(s.speed! / truth).toBeGreaterThan(0.85)
      expect(s.speed! / truth).toBeLessThan(1.15)
    }
    const etaMinutes = shown.filter((s) => s.t < 60).map((s) => s.eta! / 60)
    expect(Math.max(...etaMinutes) / Math.min(...etaMinutes)).toBeLessThan(1.6)
  })

  it("the 3.9 GB production case shows ~1.5–2 h, not ~8 h", () => {
    const total = 3901 * MiB
    const durations = jittered(60, 26, 0.6) // 10–42 s per chunk, ~0.6 MiB/s
    const shown = replay(durations, total).filter((s) => s.t >= 120 && s.eta != null)
    expect(shown.length).toBeGreaterThan(900)
    for (const s of shown) {
      const hours = s.eta! / 3600
      expect(hours).toBeGreaterThan(0.9)
      expect(hours).toBeLessThan(2.6)
    }
  })

  it("the shown ETA counts down smoothly between confirmations", () => {
    const shown = replay(jittered(40, 5.6, 0.25), 1024 * MiB).filter((s) => s.t >= 20 && s.eta != null)
    for (let i = 1; i < shown.length; i++) {
      const prev = shown[i - 1]!.eta!
      const next = shown[i]!.eta!
      expect(Math.abs(next - (prev - 1)) / prev).toBeLessThan(0.2)
    }
  })

  it("an overdue chunk slows the estimate gradually, then reports a stall", () => {
    const rate = new TransferRate()
    rate.begin(0)
    for (let i = 1; i <= 10; i++) rate.record(i * CHUNK, i * 5000)
    const onTime = rate.bytesPerSecond(52_000)!
    expect(onTime).toBeCloseTo(CHUNK / 5, -3)
    const late = rate.bytesPerSecond(65_000)!
    expect(late).toBeLessThan(onTime)
    expect(late).toBeGreaterThan(onTime * 0.7)
    expect(rate.bytesPerSecond(50_000 + 31_000)).toBe(0)
    expect(rate.secondsRemaining(100 * MiB, 81_000)).toBeNull()
  })

  it("a slow link's stall threshold scales with its own chunk time", () => {
    const rate = new TransferRate()
    rate.begin(0)
    for (let i = 1; i <= 4; i++) rate.record(i * CHUNK, i * 40_000)
    // 60 s since the last chunk is late for a 40 s/chunk link, but not a stall.
    expect(rate.bytesPerSecond(220_000)).toBeGreaterThan(0)
    expect(rate.bytesPerSecond(160_000 + 121_000)).toBe(0)
  })

  it("confirmed bytes going backwards restarts measurement", () => {
    const rate = new TransferRate()
    rate.begin(0)
    for (let i = 1; i <= 5; i++) rate.record(i * CHUNK, i * 2000)
    rate.record(3 * CHUNK, 11_000)
    expect(rate.bytesPerSecond(12_000)).toBeNull()
  })

  it("reset forgets everything", () => {
    const rate = new TransferRate()
    rate.begin(0)
    for (let i = 1; i <= 5; i++) rate.record(i * CHUNK, i * 2000)
    rate.reset()
    expect(rate.bytesPerSecond(20_000)).toBeNull()
  })
})

describe("formatTimeRemaining", () => {
  it.each([
    [null, null],
    [Number.NaN, null],
    [-5, null],
    [3, "a few seconds left"],
    [42, "about 50 s left"],
    [119, "about 2 min left"],
    [45 * 60, "about 45 min left"],
    [95 * 60, "about 1 h 35 min left"],
    [2 * 3600 + 58 * 60, "about 3 h left"],
    [8 * 3600, "about 8 h left"],
    [12.4 * 3600, "about 12 h left"],
  ])("%s → %s", (input, expected) => {
    expect(formatTimeRemaining(input as number | null)).toBe(expected)
  })
})
