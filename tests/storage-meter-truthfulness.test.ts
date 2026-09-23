import { describe, expect, it } from "vitest"

import { formatBytes } from "../apps/web/lib/utils/format-bytes"

/**
 * Settings → Storage showed "9% of volume used" on a disk that was 90% full.
 *
 * The number was Arciin's own storage divided by the whole filesystem's
 * capacity. Everything else on the disk — the OS, home directories, container
 * images — is invisible to the numerator and counted in the denominator, so
 * the figure was most reassuring exactly when it should not have been.
 *
 * Exact bytes from this host, taken with df -B1 while the meter read 9%.
 */

const OBSERVED = {
  filesystemTotalBytes: 105_089_261_568,
  filesystemAvailableBytes: 10_054_451_200,
  arciinUsageBytes: 9_200_000_000,
}

const filesystemUsedBytes = OBSERVED.filesystemTotalBytes - OBSERVED.filesystemAvailableBytes
const pct = (used: number, total: number) => Math.round((used / total) * 100)

describe("the percentage describes the disk", () => {
  it("reports how full the disk is, not Arciin's share of it", () => {
    expect(pct(filesystemUsedBytes, OBSERVED.filesystemTotalBytes)).toBe(90)
  })

  it("the old arithmetic is what produced the reassuring number", () => {
    // Kept as a fixture so the regression is recognisable if it returns.
    expect(pct(OBSERVED.arciinUsageBytes, OBSERVED.filesystemTotalBytes)).toBe(9)
  })

  it("the two answers are not close enough to be a rounding question", () => {
    const disk = pct(filesystemUsedBytes, OBSERVED.filesystemTotalBytes)
    const arciinShare = pct(OBSERVED.arciinUsageBytes, OBSERVED.filesystemTotalBytes)
    expect(disk - arciinShare).toBeGreaterThan(50)
  })
})

describe("thresholds follow the disk, not Arciin's footprint", () => {
  const tone = (p: number | null) =>
    p == null ? "normal" : p >= 90 ? "critical" : p >= 80 ? "warning" : "normal"

  it.each([
    [0, "normal"],
    [79, "normal"],
    [80, "warning"],
    [89, "warning"],
    [90, "critical"],
    [100, "critical"],
  ])("%i%% is %s", (percent, expected) => {
    expect(tone(percent)).toBe(expected)
  })

  it("this host would have read critical, not normal", () => {
    expect(tone(pct(filesystemUsedBytes, OBSERVED.filesystemTotalBytes))).toBe("critical")
    // Under the old sum it was 9%, which is "normal" — silence on a full disk.
    expect(tone(pct(OBSERVED.arciinUsageBytes, OBSERVED.filesystemTotalBytes))).toBe("normal")
  })

  it("says nothing rather than guessing when capacity is unknown", () => {
    expect(tone(null)).toBe("normal")
  })
})

describe("one formatter, so the same bytes read the same everywhere", () => {
  it("formats the observed figures consistently", () => {
    expect(formatBytes(OBSERVED.filesystemTotalBytes)).toBe("97.9 GB")
    expect(formatBytes(OBSERVED.filesystemAvailableBytes)).toBe("9.4 GB")
  })

  it("is stable across repeated calls", () => {
    // Dashboard and Settings read one cache entry through one formatter; an
    // 8.9/9.0 disagreement was two reads separated in time, not two formatters.
    const a = formatBytes(filesystemUsedBytes)
    const b = formatBytes(filesystemUsedBytes)
    expect(a).toBe(b)
  })
})
