import { access } from "node:fs/promises"
import path from "node:path"

import type { PrismaClient } from "@prisma/client"
import type { Queue } from "bullmq"

import { JOB_TYPES, assetSupportsDocumentThumbnail, resolveArciinStorageRoot } from "@arciin/shared"

import { getStoragePaths } from "@/services/storage/local-storage"

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

async function documentThumbnailFileExists(
  storageRoot: string,
  assetId: string,
): Promise<boolean> {
  const thumbPath = path.join(getStoragePaths(storageRoot).thumbnailsDir, `${assetId}.webp`)
  try {
    await access(thumbPath)
    return true
  } catch {
    return false
  }
}

/** Queue thumbnail jobs for recent PDFs when the user enables document previews. */
export async function queueDocumentThumbnailBackfill(
  prisma: PrismaClient,
  mediaQueue: Queue,
  userId: string,
  configuredStorageRoot?: string | null,
  limit = 500,
) {
  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = resolveArciinStorageRoot(
    configuredStorageRoot ?? instance?.storageRoot ?? null,
    instance?.storageRoot ?? "./data/arciin",
  )

  const pendingJobs = await prisma.job.findMany({
    where: {
      type: JOB_TYPES.generateThumbnail,
      status: { in: ["QUEUED", "ACTIVE"] },
    },
    select: { payload: true },
  })
  const pendingAssetIds = new Set<string>()
  for (const job of pendingJobs) {
    const payload = job.payload as { assetId?: string } | null
    if (payload?.assetId) pendingAssetIds.add(payload.assetId)
  }

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

    if (pendingAssetIds.has(asset.id)) continue

    if (await documentThumbnailFileExists(storageRoot, asset.id)) continue

    await enqueueGenerateThumbnailJob(prisma, mediaQueue, {
      assetId: asset.id,
      userId,
    })
  }
}
