/**
 * Transactional upload commit (UP-007).
 *
 * The previous path wrote the StorageObject, the Asset, the UploadSession and
 * each Job row with separate awaits, then called `queue.add`. Every gap between
 * those awaits was a way to end up in a state nobody could interpret:
 *
 *   - crash after the object, before the asset  -> bytes nobody owns
 *   - crash after the asset, before the session -> a file with no upload history
 *   - `queue.add` throws                        -> an asset stuck in PROCESSING forever
 *
 * The last one is not hypothetical: it is how 1,278 upload sessions were
 * stranded. Redis being briefly unreachable permanently broke uploads that had
 * already been fully written to disk.
 *
 * This commits all the database rows in one transaction, including an outbox
 * row per background job. After the transaction returns, the caller tries to
 * dispatch to Redis. If that fails, nothing is lost — the outbox row is
 * committed, and reconciliation drains it. The upload is *durably accepted* the
 * moment the transaction commits, and the HTTP response says so honestly.
 *
 * Redis is deliberately never touched inside the transaction: a slow Redis
 * would otherwise hold a Postgres write transaction open, and under load that
 * exhausts the connection pool long before it exhausts Redis.
 */

import type { Prisma, PrismaClient } from "@prisma/client"

import {
  initialUploadSessionState,
  planUploadOutbox,
  requiresWorkerProcessing,
  type PlannedOutboxJob,
} from "@arciin/shared"

export type CommitUploadInput = {
  /** Bytes are already at their final content-addressed path. */
  storage: {
    /** Set when an identical object already existed and was reused. */
    existingStorageObjectId: string | null
    storageLocationId: string
    objectKey: string
    physicalPath: string
    sizeBytes: number
    checksumSha256: string
    mimeType: string
  }
  asset: {
    libraryId: string
    folderId: string | null
    ownerId: string
    filename: string
    originalFilename: string
    mimeType: string
    mediaType: string
    extension: string
    durationSeconds?: number | null
    width?: number | null
    height?: number | null
    codec?: string | null
    uploadClient?: string | null
    /** Provenance when the upload arrived through a File Request. */
    fileRequestId?: string | null
    fileRequestSubmissionId?: string | null
  }
  uploadSession: {
    userId: string
    originalFilename: string
    targetLibraryId: string
    targetFolderId: string | null
  }
  jobNames: { extractMetadata: string; generateThumbnail: string }
  wantsDocumentThumbnail?: boolean
  /** Recorded atomically with the rows it describes, when a key was supplied. */
  idempotency?: {
    scope: string
    key: string
    requestHash: string
    expiresAt: Date
  } | null
}

export type CommitUploadResult = {
  assetId: string
  uploadSessionId: string
  storageObjectId: string
  requiresProcessing: boolean
  /** Outbox rows to hand to Redis. Already durable; dispatch may fail freely. */
  pendingJobs: (PlannedOutboxJob & { outboxId: string; jobRecordId: string })[]
}

/**
 * Write everything, or write nothing.
 *
 * Note the ordering constraint that forces two passes over the job plan: the
 * outbox payload has to carry the durable `Job` row id so the worker can report
 * progress, but the Job row and the outbox row are both created here, inside
 * the transaction, so the ids are available before anything leaves the process.
 */
export async function commitUpload(
  prisma: PrismaClient,
  input: CommitUploadInput,
): Promise<CommitUploadResult> {
  const requiresProcessing = requiresWorkerProcessing(input.asset.mediaType)
  const lifecycle = initialUploadSessionState(input.asset.mediaType)

  return prisma.$transaction(async (tx) => {
    const storageObjectId =
      input.storage.existingStorageObjectId ??
      (
        await tx.storageObject.create({
          data: {
            storageLocationId: input.storage.storageLocationId,
            objectKey: input.storage.objectKey,
            physicalPath: input.storage.physicalPath,
            sizeBytes: BigInt(input.storage.sizeBytes),
            checksumSha256: input.storage.checksumSha256,
            mimeType: input.storage.mimeType,
          },
          select: { id: true },
        })
      ).id

    const asset = await tx.asset.create({
      data: {
        libraryId: input.asset.libraryId,
        folderId: input.asset.folderId,
        storageObjectId,
        ownerId: input.asset.ownerId,
        filename: input.asset.filename,
        originalFilename: input.asset.originalFilename,
        mimeType: input.asset.mimeType,
        mediaType: input.asset.mediaType as Prisma.AssetCreateInput["mediaType"],
        extension: input.asset.extension,
        sizeBytes: BigInt(input.storage.sizeBytes),
        checksumSha256: input.storage.checksumSha256,
        durationSeconds: input.asset.durationSeconds ?? null,
        width: input.asset.width ?? null,
        height: input.asset.height ?? null,
        codec: input.asset.codec ?? null,
        status: requiresProcessing ? "PROCESSING" : "READY",
        uploadClient: input.asset.uploadClient ?? null,
        fileRequestId: input.asset.fileRequestId ?? null,
        fileRequestSubmissionId: input.asset.fileRequestSubmissionId ?? null,
      },
      select: { id: true },
    })

    const uploadSession = await tx.uploadSession.create({
      data: {
        userId: input.uploadSession.userId,
        originalFilename: input.uploadSession.originalFilename,
        mimeType: input.asset.mimeType,
        sizeBytes: BigInt(input.storage.sizeBytes),
        status: lifecycle.status as Prisma.UploadSessionCreateInput["status"],
        progress: lifecycle.progress,
        completedAt: lifecycle.completedAt,
        targetLibraryId: input.uploadSession.targetLibraryId,
        targetFolderId: input.uploadSession.targetFolderId,
        detectedMediaType: input.asset.mediaType as Prisma.UploadSessionCreateInput["detectedMediaType"],
        assetId: asset.id,
      },
      select: { id: true },
    })

    const planned = planUploadOutbox(
      {
        assetId: asset.id,
        uploadId: uploadSession.id,
        userId: input.uploadSession.userId,
        mediaType: input.asset.mediaType,
        wantsDocumentThumbnail: input.wantsDocumentThumbnail,
      },
      input.jobNames,
    )

    const pendingJobs: CommitUploadResult["pendingJobs"] = []

    for (const job of planned) {
      const jobRecord = await tx.job.create({
        data: {
          type: job.jobName,
          status: "QUEUED",
          progress: 0,
          payload: { ...job.payload },
        },
        select: { id: true },
      })

      const payload = { ...job.payload, jobRecordId: jobRecord.id }

      const outbox = await tx.uploadOutbox.create({
        data: {
          jobId: job.jobId,
          queue: job.queue,
          jobName: job.jobName,
          payload,
        },
        select: { id: true },
      })

      pendingJobs.push({ ...job, payload, outboxId: outbox.id, jobRecordId: jobRecord.id })
    }

    if (input.idempotency) {
      // Same transaction as the asset: a committed asset always has its key
      // recorded, so a retry can never miss the record and duplicate the file.
      await tx.idempotencyRecord.upsert({
        where: {
          scope_key: { scope: input.idempotency.scope, key: input.idempotency.key },
        },
        create: {
          scope: input.idempotency.scope,
          key: input.idempotency.key,
          requestHash: input.idempotency.requestHash,
          status: "IN_FLIGHT",
          expiresAt: input.idempotency.expiresAt,
        },
        update: {
          requestHash: input.idempotency.requestHash,
          status: "IN_FLIGHT",
          expiresAt: input.idempotency.expiresAt,
        },
      })
    }

    return {
      assetId: asset.id,
      uploadSessionId: uploadSession.id,
      storageObjectId,
      requiresProcessing,
      pendingJobs,
    }
  })
}
