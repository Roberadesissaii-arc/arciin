/**
 * Re-queue metadata/thumbnail work after a canonical original is healed.
 *
 * Job ids include `__heal` so BullMQ does not ignore a previously failed
 * `extract-metadata__<assetId>` UnrecoverableError. The outbox jobId is unique,
 * so a second heal resets the existing row instead of inserting a duplicate.
 */

import type { PrismaClient } from "@prisma/client"
import type { FastifyBaseLogger } from "fastify"

import { JOB_TYPES } from "@arciin/config"
import { planUploadOutbox, requiresWorkerProcessing } from "@arciin/shared"

import { mediaQueue } from "@/services/jobs/queues"
import { dispatchPendingForUpload } from "@/services/uploads/outbox-dispatch"

const JOB_NAMES = {
  extractMetadata: JOB_TYPES.extractMetadata,
  generateThumbnail: JOB_TYPES.generateThumbnail,
}

export async function scheduleAssetProcessing(
  prisma: PrismaClient,
  input: {
    assetId: string
    userId: string
    mediaType: string
    wantsDocumentThumbnail?: boolean
    log?: FastifyBaseLogger
  },
): Promise<{ enqueued: boolean }> {
  if (!requiresWorkerProcessing(input.mediaType) && !input.wantsDocumentThumbnail) {
    await prisma.asset.update({
      where: { id: input.assetId },
      data: { status: "READY" },
    })
    return { enqueued: false }
  }

  const inflight = await prisma.job.findFirst({
    where: {
      status: { in: ["QUEUED", "ACTIVE"] },
      payload: { path: ["assetId"], equals: input.assetId },
    },
    select: { id: true },
  })
  if (inflight) {
    await prisma.asset.update({
      where: { id: input.assetId },
      data: { status: "PROCESSING" },
    })
    return { enqueued: false }
  }

  let session = await prisma.uploadSession.findFirst({
    where: { assetId: input.assetId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })
  if (!session) {
    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: input.assetId },
      select: {
        ownerId: true,
        originalFilename: true,
        libraryId: true,
        folderId: true,
        mimeType: true,
        sizeBytes: true,
      },
    })
    session = await prisma.uploadSession.create({
      data: {
        userId: asset.ownerId,
        originalFilename: asset.originalFilename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        status: "PROCESSING",
        progress: 88,
        targetLibraryId: asset.libraryId,
        targetFolderId: asset.folderId,
        detectedMediaType: input.mediaType as never,
        assetId: input.assetId,
      },
      select: { id: true },
    })
  } else {
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: "PROCESSING", progress: 88, completedAt: null, error: null },
    })
  }

  const planned = planUploadOutbox(
    {
      assetId: input.assetId,
      uploadId: session.id,
      userId: input.userId,
      mediaType: input.mediaType,
      wantsDocumentThumbnail: input.wantsDocumentThumbnail,
    },
    JOB_NAMES,
  )

  const pending: {
    outboxId: string
    jobId: string
    queue: string
    jobName: string
    payload: unknown
  }[] = []

  for (const job of planned) {
    const jobId = `${job.jobId}__heal`
    const jobRecord = await prisma.job.create({
      data: {
        type: job.jobName,
        status: "QUEUED",
        progress: 0,
        payload: { ...job.payload },
      },
      select: { id: true },
    })
    const payload = { ...job.payload, jobRecordId: jobRecord.id }
    await prisma.job.update({
      where: { id: jobRecord.id },
      data: { payload },
    })

    const existingOutbox = await prisma.uploadOutbox.findUnique({
      where: { jobId },
      select: { id: true },
    })
    const outbox = existingOutbox
      ? await prisma.uploadOutbox.update({
          where: { id: existingOutbox.id },
          data: {
            payload,
            jobName: job.jobName,
            queue: job.queue,
            status: "PENDING",
            attempts: 0,
            lastError: null,
            availableAt: new Date(),
            dispatchedAt: null,
          },
          select: { id: true },
        })
      : await prisma.uploadOutbox.create({
          data: {
            jobId,
            queue: job.queue,
            jobName: job.jobName,
            payload,
          },
          select: { id: true },
        })

    pending.push({ jobId, queue: job.queue, jobName: job.jobName, payload, outboxId: outbox.id })
  }

  await prisma.asset.update({
    where: { id: input.assetId },
    data: { status: "PROCESSING" },
  })

  for (const entry of pending) {
    const existingJob = await mediaQueue.getJob(entry.jobId).catch(() => null)
    if (existingJob) await existingJob.remove().catch(() => {})
  }

  await dispatchPendingForUpload(prisma, { media: mediaQueue }, pending, input.log).catch(() => {})
  return { enqueued: pending.length > 0 }
}
