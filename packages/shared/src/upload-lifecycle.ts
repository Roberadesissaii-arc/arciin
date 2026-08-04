/**
 * The upload session lifecycle, in one place.
 *
 * The bug this exists to prevent: the API used to stamp `completedAt` when the
 * bytes landed, while the worker refused to finish any upload that already had
 * a `completedAt`. The two meanings of "complete" collided and every image and
 * video upload stalled at CLASSIFIED.
 *
 * The rule now:
 *   `createdAt`   — request accepted
 *   `updatedAt`   — last transition
 *   `completedAt` — background processing finished; written by the worker only
 *
 * Uploads that need no worker are complete the moment they are stored, so the
 * API writes `completedAt` for those and for nothing else.
 */

export type UploadLifecycleStatus =
  | "QUEUED"
  | "UPLOADING"
  | "UPLOADED"
  | "ANALYZING"
  | "CLASSIFIED"
  | "PROCESSING"
  | "READY"
  | "FAILED"

/**
 * Progress reported once bytes are stored but worker jobs are outstanding.
 * Must stay below 100: the web client treats `progress >= 100` as READY.
 */
export const UPLOAD_ACCEPTED_PROGRESS = 88

/** Progress reported once metadata extraction has run but thumbnails have not. */
export const UPLOAD_CLASSIFIED_PROGRESS = 90

/**
 * Media types that need a worker before the upload can be called finished.
 *
 * AUDIO is included: it gets a metadata job (which is what promotes it), just
 * not a thumbnail job.
 */
export function requiresWorkerProcessing(mediaType: string): boolean {
  return mediaType === "VIDEO" || mediaType === "IMAGE" || mediaType === "AUDIO"
}

export type UploadSessionLifecycleState = {
  status: UploadLifecycleStatus
  progress: number
  completedAt: Date | null
}

/**
 * State an upload session is created with, once its bytes are safely stored.
 */
export function initialUploadSessionState(
  mediaType: string,
  now: Date = new Date(),
): UploadSessionLifecycleState {
  if (requiresWorkerProcessing(mediaType)) {
    return {
      status: "PROCESSING",
      progress: UPLOAD_ACCEPTED_PROGRESS,
      completedAt: null,
    }
  }

  return { status: "READY", progress: 100, completedAt: now }
}

/** Terminal success state, written by the worker when processing finishes. */
export function completedUploadSessionState(
  now: Date = new Date(),
): UploadSessionLifecycleState {
  return { status: "READY", progress: 100, completedAt: now }
}

/**
 * Whether the API should emit the final `upload.completed` event itself.
 *
 * Exactly one such event must reach the client per upload. When a worker job
 * is pending the worker owns that event; emitting here too produced a second
 * completion toast whenever the two were more than the client's 20s toast
 * dedupe window apart.
 */
export function apiOwnsCompletionEvent(mediaType: string): boolean {
  return !requiresWorkerProcessing(mediaType)
}
