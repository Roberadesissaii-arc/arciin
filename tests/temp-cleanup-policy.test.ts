import { describe, expect, it } from "vitest"

import {
  DEFAULT_TEMP_MAX_AGE_HOURS,
  decideTempFile,
  planTempCleanup,
} from "@arciin/shared"

/**
 * UP-006 — scheduled temp cleanup.
 *
 * This is the only code in the upload path that deletes user data, so the
 * decision is a pure function and every rule is pinned here. The bias is
 * toward retention: a kept stale file costs disk, a wrongly deleted one costs
 * someone's upload.
 */

const ROOT = "/srv/arciin-storage/arciin/temp"
const NOW = Date.parse("2026-08-04T12:00:00Z")
const HOUR = 60 * 60 * 1000

const file = (over: Partial<Parameters<typeof decideTempFile>[0]> = {}) => ({
  path: `${ROOT}/1783479008163-abc.mp4`,
  mtimeMs: NOW - 48 * HOUR,
  sizeBytes: 1_000,
  ...over,
})

const options = (over: Partial<Parameters<typeof decideTempFile>[1]> = {}) => ({
  tempRoot: ROOT,
  now: NOW,
  ...over,
})

describe("decideTempFile", () => {
  it("deletes a stale unreferenced temp file", () => {
    expect(decideTempFile(file(), options())).toEqual({ deletable: true })
  })

  it("keeps a fresh file", () => {
    const decision = decideTempFile(file({ mtimeMs: NOW - HOUR }), options())
    expect(decision).toEqual({ deletable: false, reason: "newer than the age threshold" })
  })

  it("keeps a file exactly at the threshold boundary", () => {
    // Strictly older than the window, not equal to it.
    const atBoundary = file({ mtimeMs: NOW - DEFAULT_TEMP_MAX_AGE_HOURS * HOUR + 1 })
    expect(decideTempFile(atBoundary, options()).deletable).toBe(false)
  })

  it("keeps a file belonging to an in-flight upload", () => {
    const candidate = file()
    const decision = decideTempFile(
      candidate,
      options({ activePaths: new Set([candidate.path]) }),
    )
    expect(decision).toEqual({
      deletable: false,
      reason: "belongs to an in-flight upload",
    })
  })

  it("refuses anything outside the temp root", () => {
    for (const path of [
      "/srv/arciin-storage/arciin/objects/aa/bb/deadbeef.mp4",
      "/etc/passwd",
      "/srv/arciin-storage/arciin/temp/../objects/x.bin",
    ]) {
      const decision = decideTempFile(file({ path }), options())
      expect(decision.deletable, path).toBe(false)
    }
  })

  it("is not fooled by a sibling directory sharing the root's prefix", () => {
    // "/…/temp-evil" must not count as inside "/…/temp".
    const decision = decideTempFile(file({ path: `${ROOT}-evil/x.bin` }), options())
    expect(decision).toEqual({ deletable: false, reason: "outside temp root" })
  })

  it("refuses a symlink that escapes the temp root", () => {
    const decision = decideTempFile(file({ escapesRoot: true }), options())
    expect(decision).toEqual({ deletable: false, reason: "symlink escapes temp root" })
  })

  it("keeps a file whose mtime is in the future", () => {
    // Clock skew, or a file still being written.
    const decision = decideTempFile(file({ mtimeMs: NOW + 10 * HOUR }), options())
    expect(decision.deletable).toBe(false)
  })

  it("honours a custom retention window", () => {
    const twelveHoursOld = file({ mtimeMs: NOW - 12 * HOUR })
    expect(decideTempFile(twelveHoursOld, options()).deletable).toBe(false)
    expect(decideTempFile(twelveHoursOld, options({ maxAgeHours: 6 })).deletable).toBe(true)
  })
})

describe("planTempCleanup", () => {
  it("partitions candidates and totals recoverable bytes", () => {
    const stale = file({ path: `${ROOT}/old-1.mp4`, sizeBytes: 700_000_000 })
    const alsoStale = file({ path: `${ROOT}/old-2.mp4`, sizeBytes: 880_000_000 })
    const fresh = file({ path: `${ROOT}/new.mp4`, mtimeMs: NOW - HOUR, sizeBytes: 10 })
    const outside = file({ path: "/etc/shadow", sizeBytes: 10 })

    const plan = planTempCleanup([stale, alsoStale, fresh, outside], options())

    expect(plan.deletable.map((f) => f.path)).toEqual([stale.path, alsoStale.path])
    expect(plan.bytesRecoverable).toBe(1_580_000_000)
    expect(plan.retained).toHaveLength(2)
    expect(plan.retained.map((r) => r.reason)).toEqual([
      "newer than the age threshold",
      "outside temp root",
    ])
  })

  it("returns an empty plan for an empty directory", () => {
    const plan = planTempCleanup([], options())
    expect(plan.deletable).toEqual([])
    expect(plan.bytesRecoverable).toBe(0)
  })

  it("is idempotent — a second run over the survivors deletes nothing", () => {
    const stale = file({ path: `${ROOT}/old.mp4` })
    const fresh = file({ path: `${ROOT}/new.mp4`, mtimeMs: NOW - HOUR })

    const first = planTempCleanup([stale, fresh], options())
    const survivors = first.retained.map((r) => r.candidate)
    const second = planTempCleanup(survivors, options())

    expect(first.deletable).toHaveLength(1)
    expect(second.deletable).toHaveLength(0)
  })
})
