import { describe, expect, it } from "vitest"

import {
  canonicalUploadRequest,
  decideIdempotency,
  isValidIdempotencyKey,
  outboxEntryIsDue,
  outboxJobId,
  outboxRetryDelayMs,
  planUploadOutbox,
} from "@arciin/shared"

/**
 * UP-007. The upload path used to write its rows one at a time and then call
 * `queue.add`; a Redis hiccup between the two stranded the asset in PROCESSING
 * forever. These tests pin the two mechanisms that replaced it: an outbox whose
 * dispatch is idempotent, and an Idempotency-Key contract that makes a retry
 * after a lost response safe.
 */

const JOB_NAMES = { extractMetadata: "extract_metadata", generateThumbnail: "generate_thumbnail" }
const NOW = Date.parse("2026-08-05T12:00:00Z")

describe("planUploadOutbox", () => {
  const base = { assetId: "ast_1", uploadId: "upl_1", userId: "usr_1" }

  it("plans metadata and a thumbnail for an image", () => {
    const jobs = planUploadOutbox({ ...base, mediaType: "IMAGE" }, JOB_NAMES)
    expect(jobs.map((j) => j.jobName)).toEqual(["extract_metadata", "generate_thumbnail"])
  })

  it("plans metadata and a thumbnail for a video", () => {
    const jobs = planUploadOutbox({ ...base, mediaType: "VIDEO" }, JOB_NAMES)
    expect(jobs.map((j) => j.jobName)).toEqual(["extract_metadata", "generate_thumbnail"])
  })

  it("plans metadata but no thumbnail for audio", () => {
    // Audio has no frame to grab; cover art is handled during extraction.
    const jobs = planUploadOutbox({ ...base, mediaType: "AUDIO" }, JOB_NAMES)
    expect(jobs.map((j) => j.jobName)).toEqual(["extract_metadata"])
  })

  it("plans metadata for a document (PDF page/author extraction)", () => {
    const jobs = planUploadOutbox({ ...base, mediaType: "DOCUMENT" }, JOB_NAMES)
    expect(jobs.map((j) => j.jobName)).toEqual(["extract_metadata"])
  })

  it("plans metadata then a thumbnail when the user wants document previews", () => {
    const jobs = planUploadOutbox(
      { ...base, mediaType: "DOCUMENT", wantsDocumentThumbnail: true },
      JOB_NAMES,
    )
    expect(jobs.map((j) => j.jobName)).toEqual(["extract_metadata", "generate_thumbnail"])
  })

  it("orders metadata before the thumbnail", () => {
    // Metadata is what moves the session out of PROCESSING; a thumbnail
    // generated first can be replaced, a session stuck first cannot.
    const jobs = planUploadOutbox({ ...base, mediaType: "VIDEO" }, JOB_NAMES)
    expect(jobs[0].jobName).toBe("extract_metadata")
  })

  it("derives job ids from the work so re-dispatch collapses in BullMQ", () => {
    const first = planUploadOutbox({ ...base, mediaType: "IMAGE" }, JOB_NAMES)
    const second = planUploadOutbox({ ...base, mediaType: "IMAGE" }, JOB_NAMES)
    expect(first.map((j) => j.jobId)).toEqual(second.map((j) => j.jobId))
    expect(first[0].jobId).toBe(outboxJobId("extract-metadata", "ast_1"))
  })

  it("gives different assets different job ids", () => {
    expect(outboxJobId("extract-metadata", "ast_1")).not.toBe(
      outboxJobId("extract-metadata", "ast_2"),
    )
  })

  it("never plans two jobs with the same id", () => {
    const jobs = planUploadOutbox(
      { ...base, mediaType: "IMAGE", wantsDocumentThumbnail: true },
      JOB_NAMES,
    )
    expect(new Set(jobs.map((j) => j.jobId)).size).toBe(jobs.length)
  })
})

describe("outbox retry scheduling", () => {
  it("backs off exponentially so a Redis outage does not burn attempts", () => {
    expect(outboxRetryDelayMs(1)).toBeLessThan(outboxRetryDelayMs(3))
    expect(outboxRetryDelayMs(3)).toBeLessThan(outboxRetryDelayMs(6))
  })

  it("caps the delay so an old entry is still retried eventually", () => {
    expect(outboxRetryDelayMs(1_000)).toBeLessThanOrEqual(15 * 60_000)
  })

  it("only considers pending entries due", () => {
    expect(outboxEntryIsDue({ status: "PENDING", availableAt: new Date(NOW - 1) }, NOW)).toBe(true)
    expect(outboxEntryIsDue({ status: "PENDING", availableAt: new Date(NOW + 1) }, NOW)).toBe(false)
    expect(outboxEntryIsDue({ status: "DISPATCHED", availableAt: null }, NOW)).toBe(false)
    expect(outboxEntryIsDue({ status: "FAILED", availableAt: new Date(NOW - 1) }, NOW)).toBe(false)
  })
})

describe("isValidIdempotencyKey", () => {
  it("accepts a normal client key", () => {
    expect(isValidIdempotencyKey("01J8ZK3M4N5P6Q7R8S9T")).toBe(true)
    expect(isValidIdempotencyKey("upload.2026-08-05:abc-123_x")).toBe(true)
  })

  it("refuses keys that are too short to be unique", () => {
    expect(isValidIdempotencyKey("abc")).toBe(false)
  })

  it("refuses an unbounded key", () => {
    expect(isValidIdempotencyKey("a".repeat(256))).toBe(false)
  })

  it("refuses characters that do not belong in a header", () => {
    expect(isValidIdempotencyKey("key with spaces")).toBe(false)
    expect(isValidIdempotencyKey("key\nInjected: header")).toBe(false)
  })
})

describe("canonicalUploadRequest", () => {
  it("is stable across retries of the same upload", () => {
    const request = {
      scope: "upload",
      filename: "clip.mp4",
      sizeBytes: 1234,
      checksumSha256: "abc",
      targetFolderId: "fld_1",
    }
    expect(canonicalUploadRequest(request)).toBe(canonicalUploadRequest({ ...request }))
  })

  it("changes when the file content changes", () => {
    const a = canonicalUploadRequest({ scope: "u", filename: "f", sizeBytes: 1, checksumSha256: "a" })
    const b = canonicalUploadRequest({ scope: "u", filename: "f", sizeBytes: 1, checksumSha256: "b" })
    expect(a).not.toBe(b)
  })

  it("changes when the destination changes", () => {
    const a = canonicalUploadRequest({ scope: "u", filename: "f", sizeBytes: 1, targetFolderId: "x" })
    const b = canonicalUploadRequest({ scope: "u", filename: "f", sizeBytes: 1, targetFolderId: "y" })
    expect(a).not.toBe(b)
  })

  it("separates scopes so an owner key cannot collide with a file-request key", () => {
    const owner = canonicalUploadRequest({ scope: "upload", filename: "f", sizeBytes: 1 })
    const guest = canonicalUploadRequest({ scope: "file-request:1", filename: "f", sizeBytes: 1 })
    expect(owner).not.toBe(guest)
  })
})

describe("decideIdempotency", () => {
  const hash = "fingerprint-a"

  it("proceeds when the key has never been used", () => {
    expect(decideIdempotency({ existing: null, requestHash: hash })).toEqual({ action: "proceed" })
  })

  it("replays the original response for an identical retry", () => {
    // This is the case that matters: the client never saw the first response.
    const decision = decideIdempotency({
      existing: {
        key: "k",
        requestHash: hash,
        status: "COMPLETED",
        responseCode: 201,
        responseBody: { data: { assetId: "ast_1" } },
      },
      requestHash: hash,
    })
    expect(decision).toEqual({
      action: "replay",
      responseCode: 201,
      responseBody: { data: { assetId: "ast_1" } },
    })
  })

  it("refuses to serve a stored response for a DIFFERENT request", () => {
    // Replaying here would tell the caller about a file they did not upload.
    const decision = decideIdempotency({
      existing: {
        key: "k",
        requestHash: "fingerprint-b",
        status: "COMPLETED",
        responseCode: 201,
        responseBody: { data: { assetId: "someone-elses" } },
      },
      requestHash: hash,
    })
    expect(decision).toMatchObject({ action: "conflict", code: "IDEMPOTENCY_KEY_REUSED" })
    expect(JSON.stringify(decision)).not.toContain("someone-elses")
  })

  it("refuses a concurrent duplicate rather than creating a second upload", () => {
    expect(
      decideIdempotency({
        existing: { key: "k", requestHash: hash, status: "IN_FLIGHT" },
        requestHash: hash,
      }),
    ).toMatchObject({ action: "in_flight" })
  })

  it("lets a retry through after the first attempt failed", () => {
    // A failed attempt left nothing behind, so a duplicate is impossible.
    expect(
      decideIdempotency({
        existing: { key: "k", requestHash: hash, status: "FAILED" },
        requestHash: hash,
      }),
    ).toEqual({ action: "proceed" })
  })

  it("frees the key once the record has expired", () => {
    expect(
      decideIdempotency({
        existing: {
          key: "k",
          requestHash: "anything-else",
          status: "COMPLETED",
          expiresAt: new Date(NOW - 1),
        },
        requestHash: hash,
        now: NOW,
      }),
    ).toEqual({ action: "proceed" })
  })

  it("checks the fingerprint before the expiry, so a live key still conflicts", () => {
    expect(
      decideIdempotency({
        existing: {
          key: "k",
          requestHash: "different",
          status: "COMPLETED",
          expiresAt: new Date(NOW + 1000),
        },
        requestHash: hash,
        now: NOW,
      }),
    ).toMatchObject({ action: "conflict" })
  })
})
