import { describe, expect, it, vi } from "vitest"

import {
  UPLOAD_ACCEPTED_PROGRESS,
  apiOwnsCompletionEvent,
  completedUploadSessionState,
  initialUploadSessionState,
  requiresWorkerProcessing,
} from "@arciin/shared"

import {
  completeUploadSession,
  failUploadSession,
  type CompletionDeps,
  type UploadSessionRow,
} from "../apps/worker/src/services/upload-completion"

/**
 * UP-001 — uploads stranded at CLASSIFIED.
 *
 * The API used to stamp `completedAt` at creation while the worker required
 * `completedAt == null` before finishing the upload, so the completion branch
 * was unreachable and 1,278 sessions never reached READY. These cases pin both
 * halves of the contract: the API must leave `completedAt` null while work is
 * outstanding, and the worker must be the only writer of it.
 */

describe("initialUploadSessionState", () => {
  it("leaves completedAt null for media that needs a worker", () => {
    for (const mediaType of ["IMAGE", "VIDEO", "AUDIO"]) {
      const state = initialUploadSessionState(mediaType)
      expect(state.status).toBe("PROCESSING")
      expect(state.completedAt).toBeNull()
      // Below 100 keeps the client queue item in PROCESSING.
      expect(state.progress).toBe(UPLOAD_ACCEPTED_PROGRESS)
      expect(state.progress).toBeLessThan(100)
    }
  })

  it("completes immediately for files with no worker step", () => {
    const now = new Date("2026-08-04T12:00:00Z")
    for (const mediaType of ["DOCUMENT", "CODE", "ARCHIVE", "APPLICATION", "OTHER"]) {
      const state = initialUploadSessionState(mediaType, now)
      expect(state.status).toBe("READY")
      expect(state.progress).toBe(100)
      expect(state.completedAt).toEqual(now)
    }
  })
})

describe("requiresWorkerProcessing", () => {
  it("covers exactly the media types that get worker jobs", () => {
    expect(requiresWorkerProcessing("IMAGE")).toBe(true)
    expect(requiresWorkerProcessing("VIDEO")).toBe(true)
    expect(requiresWorkerProcessing("AUDIO")).toBe(true)
    expect(requiresWorkerProcessing("DOCUMENT")).toBe(false)
    expect(requiresWorkerProcessing("OTHER")).toBe(false)
  })
})

describe("apiOwnsCompletionEvent", () => {
  it("hands the final event to the worker when a job is pending", () => {
    expect(apiOwnsCompletionEvent("IMAGE")).toBe(false)
    expect(apiOwnsCompletionEvent("VIDEO")).toBe(false)
    expect(apiOwnsCompletionEvent("AUDIO")).toBe(false)
  })

  it("emits from the API for immediately-ready files", () => {
    expect(apiOwnsCompletionEvent("DOCUMENT")).toBe(true)
    expect(apiOwnsCompletionEvent("OTHER")).toBe(true)
  })
})

describe("completedUploadSessionState", () => {
  it("is the terminal success state", () => {
    const now = new Date("2026-08-04T12:00:00Z")
    expect(completedUploadSessionState(now)).toEqual({
      status: "READY",
      progress: 100,
      completedAt: now,
    })
  })
})

/** In-memory stand-in whose updateMany honours the conditional status guard. */
function fakeDeps(session: UploadSessionRow | null) {
  const row = session ? { ...session } : null
  const published: Array<{ type: string; uploadId: string }> = []

  const deps: CompletionDeps = {
    findUploadSession: async () => row,
    promoteUploadSession: async ({ unlessStatusIn, data }) => {
      if (!row) return 0
      if (unlessStatusIn.includes(row.status)) return 0
      row.status = String(data.status)
      return 1
    },
    markAssetFailed: async () => {},
    publish: async (event) => {
      published.push({ type: event.type, uploadId: event.uploadId })
    },
  }

  return { deps, published, row }
}

const baseSession: UploadSessionRow = {
  id: "upload-1",
  userId: "user-1",
  status: "PROCESSING",
  originalFilename: "holiday.mp4",
  targetLibrary: { name: "Videos" },
}

const completionInput = {
  uploadId: "upload-1",
  assetId: "asset-1",
  libraryId: "library-1",
  originalFilename: "holiday.mp4",
}

describe("completeUploadSession", () => {
  it("promotes a processing upload to READY and announces it once", async () => {
    const { deps, published, row } = fakeDeps(baseSession)

    const completed = await completeUploadSession(deps, completionInput)

    expect(completed).toBe(true)
    expect(row?.status).toBe("READY")
    expect(published).toEqual([{ type: "upload.completed", uploadId: "upload-1" }])
  })

  it("emits exactly one completion event when two jobs finish the same upload", async () => {
    const { deps, published } = fakeDeps(baseSession)

    // A media upload creates both extract_metadata and generate_thumbnail, and
    // their order is not guaranteed — whichever lands second must stay silent.
    const first = await completeUploadSession(deps, completionInput)
    const second = await completeUploadSession(deps, completionInput)

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(published).toHaveLength(1)
  })

  it("stays silent when the upload is already READY", async () => {
    const { deps, published } = fakeDeps({ ...baseSession, status: "READY" })

    expect(await completeUploadSession(deps, completionInput)).toBe(false)
    expect(published).toHaveLength(0)
  })

  it("promotes an upload that metadata extraction left at CLASSIFIED", async () => {
    // The exact state the 1,278 stranded production rows are in.
    const { deps, published, row } = fakeDeps({ ...baseSession, status: "CLASSIFIED" })

    expect(await completeUploadSession(deps, completionInput)).toBe(true)
    expect(row?.status).toBe("READY")
    expect(published).toHaveLength(1)
  })

  it("does nothing when there is no session for the asset", async () => {
    const { deps, published } = fakeDeps(null)

    expect(await completeUploadSession(deps, completionInput)).toBe(false)
    expect(published).toHaveLength(0)
  })

  it("labels link imports as such", async () => {
    const { deps } = fakeDeps(baseSession)
    const publish = vi.fn(async () => {})

    await completeUploadSession(
      { ...deps, publish },
      { ...completionInput, importSourceUrl: "https://example.test/a.mp4" },
    )

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ origin: "url" }) }),
    )
  })
})

describe("failUploadSession", () => {
  it("moves a stuck upload to a visible FAILED state", async () => {
    const { deps, published, row } = fakeDeps(baseSession)

    const failed = await failUploadSession(
      deps,
      { uploadId: "upload-1", assetId: "asset-1" },
      new Error("Original file missing on disk."),
    )

    expect(failed).toBe(true)
    expect(row?.status).toBe("FAILED")
    expect(published).toEqual([{ type: "upload.failed", uploadId: "upload-1" }])
  })

  it("marks the asset failed so the UI can show why", async () => {
    const { deps } = fakeDeps(baseSession)
    const markAssetFailed = vi.fn(async () => {})

    await failUploadSession(
      { ...deps, markAssetFailed },
      { uploadId: "upload-1", assetId: "asset-1" },
      new Error("ffmpeg exited 1"),
    )

    expect(markAssetFailed).toHaveBeenCalledWith("asset-1", "ffmpeg exited 1")
  })

  it("never overwrites an upload that already succeeded", async () => {
    const { deps, published, row } = fakeDeps({ ...baseSession, status: "READY" })

    expect(
      await failUploadSession(deps, { uploadId: "upload-1" }, new Error("late failure")),
    ).toBe(false)
    expect(row?.status).toBe("READY")
    expect(published).toHaveLength(0)
  })

  it("reports a failure only once", async () => {
    const { deps, published } = fakeDeps(baseSession)
    const error = new Error("boom")

    await failUploadSession(deps, { uploadId: "upload-1" }, error)
    await failUploadSession(deps, { uploadId: "upload-1" }, error)

    expect(published).toHaveLength(1)
  })
})
