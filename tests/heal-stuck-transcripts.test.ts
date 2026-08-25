import { describe, expect, it } from "vitest"

import {
  WORKER_GONE_MS,
  decideStuckTranscriptFailure,
  isWorkerGone,
} from "../apps/api/src/services/assets/heal-stuck-transcripts"

describe("isWorkerGone", () => {
  const now = 1_000_000

  it("treats a missing heartbeat as gone", () => {
    expect(isWorkerGone(null, now)).toBe(true)
    expect(isWorkerGone(undefined, now)).toBe(true)
    expect(isWorkerGone(Number.NaN, now)).toBe(true)
  })

  it("stays present inside the five-minute window", () => {
    expect(isWorkerGone(now - 60_000, now)).toBe(false)
    expect(isWorkerGone(now - (WORKER_GONE_MS - 1), now)).toBe(false)
  })

  it("is gone once the heartbeat is older than five minutes", () => {
    expect(isWorkerGone(now - WORKER_GONE_MS - 1, now)).toBe(true)
  })
})

describe("decideStuckTranscriptFailure", () => {
  it("fails when the linked job already FAILED", () => {
    expect(
      decideStuckTranscriptFailure({
        job: { status: "FAILED", error: "write EPIPE" },
        workerGone: false,
      }),
    ).toBe("write EPIPE")
  })

  it("fails when the job completed without a transcript result", () => {
    expect(
      decideStuckTranscriptFailure({
        job: { status: "COMPLETED", error: null },
        workerGone: false,
      }),
    ).toMatch(/without saving/i)
  })

  it("fails a missing job immediately", () => {
    expect(
      decideStuckTranscriptFailure({
        job: null,
        workerGone: false,
      }),
    ).toMatch(/lost/i)
  })

  it("leaves an ACTIVE job alone while the worker is alive", () => {
    expect(
      decideStuckTranscriptFailure({
        job: { status: "ACTIVE", error: null },
        workerGone: false,
      }),
    ).toBeNull()
  })

  it("fails an ACTIVE job once the worker heartbeat is gone", () => {
    expect(
      decideStuckTranscriptFailure({
        job: { status: "ACTIVE", error: null },
        workerGone: true,
      }),
    ).toMatch(/Worker stopped/i)
  })

  it("fails a QUEUED job once the worker heartbeat is gone", () => {
    expect(
      decideStuckTranscriptFailure({
        job: { status: "QUEUED", error: null },
        workerGone: true,
      }),
    ).toMatch(/Worker stopped/i)
  })
})
