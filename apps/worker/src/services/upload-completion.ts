import { completedUploadSessionState } from "@arciin/shared"

/**
 * Upload completion and failure transitions, with their dependencies injected.
 *
 * Split out of `worker-handlers` so the exactly-once guarantee can be asserted
 * in unit tests without a database or Redis: pass fakes, call twice, assert one
 * event. The module deliberately imports no `@/` alias for the same reason.
 */

export type UploadSessionRow = {
  id: string
  userId: string
  status: string
  originalFilename: string
  targetLibrary?: { name: string | null } | null
}

export type CompletionDeps = {
  /** Find the session by its id, or by the asset it produced. */
  findUploadSession: (input: {
    uploadId?: string
    assetId?: string
  }) => Promise<UploadSessionRow | null>
  /**
   * Conditional promote. Must apply only when the row is not already in one of
   * `unlessStatusIn`, and must return how many rows it changed — that count is
   * the exactly-once latch.
   */
  promoteUploadSession: (input: {
    id: string
    unlessStatusIn: string[]
    data: Record<string, unknown>
  }) => Promise<number>
  markAssetFailed?: (assetId: string, message: string) => Promise<void>
  publish: (event: {
    type: "upload.completed" | "upload.failed"
    userId: string
    uploadId: string
    assetId?: string
    libraryId?: string
    progress?: number
    message: string
    data: Record<string, unknown>
  }) => Promise<void>
  now?: () => Date
}

export type CompleteUploadInput = {
  uploadId?: string
  assetId: string
  libraryId: string
  originalFilename: string
  importSourceUrl?: string | null
}

/**
 * Promote an upload session to READY and emit the one final
 * `upload.completed` event.
 *
 * Idempotent by construction: whichever required job finishes last wins the
 * conditional update, and every later call changes zero rows and stays silent.
 * That is what keeps a two-job media upload down to a single completion toast.
 *
 * Returns true when this call was the one that completed the upload.
 */
export async function completeUploadSession(
  deps: CompletionDeps,
  input: CompleteUploadInput,
): Promise<boolean> {
  const upload = await deps.findUploadSession({
    uploadId: input.uploadId,
    assetId: input.assetId,
  })

  if (!upload) return false

  const state = completedUploadSessionState(deps.now?.() ?? new Date())

  const promoted = await deps.promoteUploadSession({
    id: upload.id,
    unlessStatusIn: ["READY"],
    data: {
      status: state.status,
      progress: state.progress,
      completedAt: state.completedAt,
    },
  })

  // Another job already announced this upload.
  if (promoted === 0) return false

  const origin = input.importSourceUrl ? "url" : "upload"

  await deps.publish({
    type: "upload.completed",
    userId: upload.userId,
    uploadId: upload.id,
    assetId: input.assetId,
    libraryId: input.libraryId,
    progress: state.progress,
    message:
      origin === "url"
        ? `${input.originalFilename} imported from link.`
        : `${input.originalFilename} uploaded.`,
    data: {
      fileName: input.originalFilename,
      destination: upload.targetLibrary?.name ?? undefined,
      origin,
    },
  })

  return true
}

/**
 * Move an upload to a visible FAILED state.
 *
 * Without this a job that dies leaves the queue item on "Processing" forever
 * with the error only in the worker log, which is indistinguishable from slow.
 */
export async function failUploadSession(
  deps: CompletionDeps,
  input: { uploadId?: string; assetId?: string },
  error: unknown,
): Promise<boolean> {
  const message = error instanceof Error ? error.message : "Processing failed."

  const upload = await deps.findUploadSession(input)
  if (!upload) return false

  const failed = await deps.promoteUploadSession({
    id: upload.id,
    unlessStatusIn: ["READY", "FAILED"],
    data: { status: "FAILED", progress: 100, error: message },
  })

  if (failed === 0) return false

  if (input.assetId && deps.markAssetFailed) {
    await deps.markAssetFailed(input.assetId, message).catch(() => {})
  }

  await deps.publish({
    type: "upload.failed",
    userId: upload.userId,
    uploadId: upload.id,
    assetId: input.assetId,
    message,
    data: {
      fileName: upload.originalFilename,
      origin: "upload",
    },
  })

  return true
}
