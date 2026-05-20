import type { PrismaClient } from "@prisma/client"
import type { Queue } from "bullmq"

import { JOB_TYPES, assetSupportsDocumentThumbnail } from "@arciin/shared"

export async function enqueueGenerateThumbnailJob(
  prisma: PrismaClient,
  mediaQueue: Queue,
  opts: { assetId: string; userId: string; uploadId?: string },
) {
  const thumbnailJob = await prisma.job.create({
    data: {
      type: JOB_TYPES.generateThumbnail,
      status: "QUEUED",
      progress: 0,
      payload: {
        assetId: opts.assetId,
        uploadId: opts.uploadId,
        userId: opts.userId,
      },
    },
  })

  await mediaQueue.add(JOB_TYPES.generateThumbnail, {
    assetId: opts.assetId,
    uploadId: opts.uploadId,
    userId: opts.userId,
    jobRecordId: thumbnailJob.id,
  })
}

/** Queue thumbnail jobs for recent PDFs when the user enables document previews. */
export async function queueDocumentThumbnailBackfill(
  prisma: PrismaClient,
  mediaQueue: Queue,
  userId: string,
  limit = 80,
) {
  const assets = await prisma.asset.findMany({
    where: {
      deletedAt: null,
      OR: [
        { mimeType: "application/pdf" },
        { extension: "pdf" },
        { mediaType: "DOCUMENT" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      mediaType: true,
      mimeType: true,
      extension: true,
      originalFilename: true,
    },
  })

  for (const asset of assets) {
    if (
      !assetSupportsDocumentThumbnail(
        asset.mediaType,
        asset.mimeType,
        asset.extension,
        asset.originalFilename,
      )
    ) {
      continue
    }

    await enqueueGenerateThumbnailJob(prisma, mediaQueue, {
      assetId: asset.id,
      userId,
    })
  }
}
