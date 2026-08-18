/**
 * Deterministic background-job planning for an accepted upload.
 *
 * The upload path used to write the asset, the upload session and the Job rows
 * with separate awaits and then call `queue.add`. Any failure between those
 * steps left an ambiguous partial upload: bytes on disk with no asset, an asset
 * with no session, or — most commonly — a committed asset whose processing job
 * never reached Redis, which is how uploads ended up stranded forever.
 *
 * The fix is an outbox. The database transaction records *what should be
 * queued* alongside the rows it queues them for, so the intent to process is as
 * durable as the asset itself. Dispatch to Redis happens after the commit and
 * may fail freely — a reconciliation pass drains whatever is still pending.
 *
 * Job ids are derived from the work, not generated: re-dispatching an outbox
 * entry hands BullMQ the same id, and BullMQ ignores a duplicate id. That makes
 * "dispatch twice" harmless rather than a source of duplicate processing, which
 * is what lets the dispatcher be aggressive about retrying.
 *
 * Pure: no Prisma, no Redis, no BullMQ. Every rule here is unit-testable.
 */

export const OUTBOX_QUEUE_MEDIA = "media"

export type OutboxJobKind = "extract-metadata" | "generate-thumbnail"

export type PlannedOutboxJob = {
  /** Deterministic BullMQ job id. Same work → same id → dispatch is idempotent. */
  jobId: string
  queue: string
  jobName: string
  payload: {
    assetId: string
    uploadId: string
    userId: string
    /** Set by the dispatcher once the durable Job row exists. */
    jobRecordId?: string
  }
}

export type UploadOutboxPlanInput = {
  assetId: string
  uploadId: string
  userId: string
  mediaType: string
  /**
   * True when the user's preferences and the file type together call for a
   * document thumbnail. Resolved by the caller — it needs user preferences.
   */
  wantsDocumentThumbnail?: boolean
}

/**
 * A job id is a function of (kind, asset). Two concurrent dispatches of the
 * same outbox row, or a dispatch racing the reconciler, collapse to one job.
 *
 * The separator must not be ":" — BullMQ rejects a custom job id containing a
 * colon, so every dispatch threw "Custom Id cannot contain :" and no media job
 * ever reached Redis. Uploads stayed PROCESSING forever while the reconciler
 * retried the same doomed id hundreds of times. "__" keeps ids just as unique.
 */
export function outboxJobId(kind: OutboxJobKind, assetId: string): string {
  return `${kind}__${assetId}`
}

export function requiresMetadataExtraction(mediaType: string): boolean {
  // Documents (especially PDFs) need page count / author extraction on upload.
  return (
    mediaType === "VIDEO" ||
    mediaType === "IMAGE" ||
    mediaType === "AUDIO" ||
    mediaType === "DOCUMENT"
  )
}

export function requiresVisualThumbnail(mediaType: string): boolean {
  return mediaType === "VIDEO" || mediaType === "IMAGE"
}

/**
 * The complete set of background jobs an accepted upload owes, in dispatch
 * order. Metadata first: a thumbnail generated before probing can be replaced,
 * but metadata is what flips the session out of PROCESSING.
 */
export function planUploadOutbox(
  input: UploadOutboxPlanInput,
  jobNames: { extractMetadata: string; generateThumbnail: string },
): PlannedOutboxJob[] {
  const jobs: PlannedOutboxJob[] = []
  const payload = {
    assetId: input.assetId,
    uploadId: input.uploadId,
    userId: input.userId,
  }

  if (requiresMetadataExtraction(input.mediaType)) {
    jobs.push({
      jobId: outboxJobId("extract-metadata", input.assetId),
      queue: OUTBOX_QUEUE_MEDIA,
      jobName: jobNames.extractMetadata,
      payload,
    })
  }

  // A visual thumbnail is implied by the media type; a document thumbnail is a
  // preference, so the caller decides. Both land on the same queue and would
  // collide on job id if a file were somehow both — hence one push, not two.
  if (requiresVisualThumbnail(input.mediaType) || input.wantsDocumentThumbnail) {
    jobs.push({
      jobId: outboxJobId("generate-thumbnail", input.assetId),
      queue: OUTBOX_QUEUE_MEDIA,
      jobName: jobNames.generateThumbnail,
      payload,
    })
  }

  return jobs
}

/**
 * Backoff for a failing outbox entry. Redis being down for a minute must not
 * burn a thousand dispatch attempts, and an entry that has failed many times
 * must still be retried eventually rather than abandoned.
 */
export function outboxRetryDelayMs(attempts: number): number {
  const base = 5_000
  const capped = Math.min(attempts, 8)
  return Math.min(base * 2 ** capped, 15 * 60_000)
}

/** An outbox entry is only ever considered dispatchable while still pending. */
export function outboxEntryIsDue(
  entry: { status: string; availableAt: Date | null },
  now: number = Date.now(),
): boolean {
  if (entry.status !== "PENDING") return false
  if (!entry.availableAt) return true
  return entry.availableAt.getTime() <= now
}
