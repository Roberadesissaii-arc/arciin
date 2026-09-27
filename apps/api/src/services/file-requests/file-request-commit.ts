import path from "node:path"

import type { FastifyBaseLogger, FastifyInstance } from "fastify"

import { JOB_TYPES, admitFile } from "@arciin/shared"

import { analyzeStoredFile } from "@/services/classification/media-classification"
import { buildRealtimeEvent } from "@/services/events/publish-event"
import type { ResolvedFileRequest } from "@/services/file-requests/file-request-access"
import { mediaQueue } from "@/services/jobs/queues"
import {
  createObjectStoragePath,
  placeCanonicalOriginal,
  removeTempFile,
} from "@/services/storage/local-storage"
import { commitUpload } from "@/services/uploads/commit-upload"
import { dispatchPendingForUpload } from "@/services/uploads/outbox-dispatch"

const JOB_NAMES = {
  extractMetadata: JOB_TYPES.extractMetadata,
  generateThumbnail: JOB_TYPES.generateThumbnail,
}

export type FileRequestCommitResult =
  | {
      ok: true
      submissionId: string
      assetId: string
      fileName: string
      sizeBytes: number
      status: "PROCESSING" | "READY"
    }
  | { ok: false; status: number; code: string; message: string }

/**
 * Turn a fully received, verified temp file into an asset in the request's
 * folder.
 *
 * Shared by the single-request multipart upload and the resumable chunked
 * upload, so both enforce the same admission rules, quota reservation and
 * commit ordering. The caller owns `tempPath` until this returns: on success
 * the file has been moved into object storage; on failure it has been removed
 * unless `keepTempOnReject` asks otherwise.
 *
 * The destination comes only from the resolved request row.
 */
export async function commitFileRequestFile(
  fastify: FastifyInstance,
  input: {
    fileRequest: ResolvedFileRequest
    storageRoot: string
    tempPath: string
    filename: string
    clientMimeType: string | null
    sizeBytes: number
    checksumSha256: string
    submissionId: string | null
    submitter: { name: string | null; email: string | null }
    abuseHash: string
    log: FastifyBaseLogger
    /** Resumable uploads keep the partial so a rejected finalize can be inspected/retried. */
    keepTempOnReject?: boolean
  },
): Promise<FileRequestCommitResult> {
  const { fileRequest, storageRoot, tempPath, sizeBytes, checksumSha256 } = input
  const reject = async (status: number, code: string, message: string): Promise<FileRequestCommitResult> => {
    if (!input.keepTempOnReject) await removeTempFile(tempPath)
    return { ok: false, status, code, message }
  }

  const analysis = await analyzeStoredFile(tempPath, input.filename, input.clientMimeType ?? "", input.log)

  // Quotas are re-read here rather than trusted from the resolve above:
  // two submitters racing for the last slot must not both win.
  const live = await fastify.prisma.fileRequest.findUnique({
    where: { id: fileRequest.id },
    select: { currentFileCount: true, currentBytes: true, revokedAt: true, status: true },
  })
  if (!live || live.revokedAt || live.status === "REVOKED") {
    return reject(410, "REQUEST_REVOKED", "This upload link has been turned off.")
  }

  const admission = admitFile({
    filename: input.filename,
    sizeBytes,
    detectedMediaType: analysis.mediaType,
    detectedExtension: analysis.extension,
    maxFileSizeBytes: fileRequest.maxFileSizeBytes,
    maxFileCount: fileRequest.maxFileCount,
    maxTotalBytes: fileRequest.maxTotalBytes,
    currentFileCount: live.currentFileCount,
    currentBytes: live.currentBytes,
    allowedExtensions: fileRequest.allowedExtensions,
    allowedMediaTypes: fileRequest.allowedMediaTypes,
  })

  if (!admission.allowed) {
    const status =
      admission.code === "FILE_TOO_LARGE"
        ? 413
        : admission.code === "FILE_COUNT_EXCEEDED" || admission.code === "TOTAL_BYTES_EXCEEDED"
          ? 409
          : 415
    return reject(status, admission.code, admission.message)
  }

  // ---- reserve the quota before writing ---------------------------------
  // A conditional update is what makes two simultaneous last-slot uploads
  // resolve to one winner. Reserving after the write would let both through.
  const reservation = await fastify.prisma.fileRequest.updateMany({
    where: {
      id: fileRequest.id,
      revokedAt: null,
      ...(fileRequest.maxFileCount != null ? { currentFileCount: { lt: fileRequest.maxFileCount } } : {}),
    },
    data: {
      currentFileCount: { increment: 1 },
      currentBytes: { increment: BigInt(sizeBytes) },
    },
  })

  if (reservation.count === 0) {
    return reject(409, "FILE_COUNT_EXCEEDED", "This request has reached its file limit.")
  }

  let reserved = true
  const releaseReservation = async () => {
    if (!reserved) return
    reserved = false
    await fastify.prisma.fileRequest
      .update({
        where: { id: fileRequest.id },
        data: {
          currentFileCount: { decrement: 1 },
          currentBytes: { decrement: BigInt(sizeBytes) },
        },
      })
      .catch(() => {})
  }

  try {
    // Continue an existing submission when the client supplies its id, so a
    // multi-file drop is one submission and therefore one owner notification.
    let submission = input.submissionId
      ? await fastify.prisma.fileRequestSubmission.findFirst({
          where: { id: input.submissionId, fileRequestId: fileRequest.id },
        })
      : null

    if (!submission) {
      submission = await fastify.prisma.fileRequestSubmission.create({
        data: {
          fileRequestId: fileRequest.id,
          status: "UPLOADING",
          submitterName: input.submitter.name,
          submitterEmail: input.submitter.email,
          abuseIdentifierHash: input.abuseHash,
        },
      })
    }

    const existingObject = await fastify.prisma.storageObject.findFirst({
      where: {
        checksumSha256,
        storageLocationId: fileRequest.destinationLibrary.storageLocationId,
      },
      select: { id: true, objectKey: true, physicalPath: true },
    })

    const objectPath = existingObject?.objectKey
      ? {
          objectKey: existingObject.objectKey,
          physicalPath: path.join(storageRoot, existingObject.objectKey),
        }
      : createObjectStoragePath(
          checksumSha256,
          analysis.extension || path.extname(admission.safeFilename),
          storageRoot,
        )

    const placed = await placeCanonicalOriginal({
      tempPath,
      destinationPath: objectPath.physicalPath,
      expectedSizeBytes: sizeBytes,
    })
    const objectKey = objectPath.objectKey
    const physicalPath = objectPath.physicalPath

    if (existingObject && (placed === "written" || existingObject.physicalPath !== physicalPath)) {
      await fastify.prisma.storageObject.update({
        where: { id: existingObject.id },
        data: {
          physicalPath,
          sizeBytes: BigInt(sizeBytes),
          mimeType: analysis.mimeType,
        },
      })
    }

    const committed = await commitUpload(fastify.prisma, {
      storage: {
        existingStorageObjectId: existingObject?.id ?? null,
        storageLocationId: fileRequest.destinationLibrary.storageLocationId,
        objectKey,
        physicalPath,
        sizeBytes,
        checksumSha256,
        mimeType: analysis.mimeType,
      },
      asset: {
        libraryId: fileRequest.destinationLibraryId,
        folderId: fileRequest.destinationFolderId,
        // The asset belongs to the folder's owner: an anonymous submitter
        // has no Arciin identity, and the files are the owner's to manage.
        ownerId: fileRequest.createdByUserId,
        filename: `${checksumSha256}.${analysis.extension || "bin"}`,
        originalFilename: admission.safeFilename,
        mimeType: analysis.mimeType,
        mediaType: analysis.mediaType,
        extension: analysis.extension || "bin",
        durationSeconds: analysis.durationSeconds,
        width: analysis.width,
        height: analysis.height,
        codec: analysis.codec,
        uploadClient: "file-request",
        fileRequestId: fileRequest.id,
        fileRequestSubmissionId: submission.id,
      },
      uploadSession: {
        userId: fileRequest.createdByUserId,
        originalFilename: admission.safeFilename,
        targetLibraryId: fileRequest.destinationLibraryId,
        targetFolderId: fileRequest.destinationFolderId,
      },
      jobNames: JOB_NAMES,
    })

    reserved = false // the quota now belongs to a committed asset

    await fastify.prisma.fileRequestSubmission.update({
      where: { id: submission.id },
      data: {
        fileCount: { increment: 1 },
        totalBytes: { increment: BigInt(sizeBytes) },
        status: committed.requiresProcessing ? "PROCESSING" : "UPLOADING",
      },
    })

    // Processing (thumbnails, probing, AI) is queued, never awaited here.
    await dispatchPendingForUpload(fastify.prisma, { media: mediaQueue }, committed.pendingJobs, input.log)

    await fastify.publishRealtimeEvent(
      buildRealtimeEvent("asset.created", {
        userId: fileRequest.createdByUserId,
        libraryId: fileRequest.destinationLibraryId,
        assetId: committed.assetId,
        message: `${admission.safeFilename} arrived through “${fileRequest.title}”.`,
        data: {
          mediaType: analysis.mediaType,
          fileName: admission.safeFilename,
          client: "file-request",
        },
      }),
    )

    return {
      ok: true,
      submissionId: submission.id,
      assetId: committed.assetId,
      fileName: admission.safeFilename,
      sizeBytes,
      status: committed.requiresProcessing ? "PROCESSING" : "READY",
    }
  } catch (error) {
    await releaseReservation()
    throw error
  }
}
