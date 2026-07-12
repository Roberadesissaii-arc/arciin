import { access, mkdir, readdir, rm, stat, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { execa } from "execa"
import { fileTypeFromFile } from "file-type"
import type Redis from "ioredis"
import sharp from "sharp"

import type { Prisma } from "@prisma/client"
import { prisma, runStorageMigration } from "@arciin/database"
import {
  JOB_TYPES,
  VIDEO_THUMBNAIL_PLACEHOLDER_SVG,
  assetSupportsDocumentThumbnail,
  inferMediaType,
  type AnalyzeFilePayload,
  type CalculateStorageUsagePayload,
  type CleanupTempFilesPayload,
  type MigrateStoragePayload,
  type ExtractMetadataPayload,
  type GenerateThumbnailPayload,
  type PlexSyncPlaceholderPayload,
} from "@arciin/shared"
import {
  candidateStorageObjectPaths,
  normalizeConfiguredStorageRoot,
  resolveArciinStorageRoot,
} from "@arciin/storage"

import { workerConfig } from "@/config"
import { syncConnectorMirrorsForAsset } from "@/services/connector-mirror"
import { createRealtimeEvent, publishRealtimeEvent } from "@/services/realtime"

async function markJob(
  jobRecordId: string | undefined,
  input: {
    status: "ACTIVE" | "COMPLETED" | "FAILED"
    progress: number
    result?: Record<string, unknown>
    error?: string
  }
) {
  if (!jobRecordId) {
    return
  }

  await prisma.job.update({
    where: {
      id: jobRecordId,
    },
    data: {
      status: input.status,
      progress: input.progress,
      result: input.result as Prisma.InputJsonValue | undefined,
      error: input.error,
      completedAt: input.status === "COMPLETED" || input.status === "FAILED" ? new Date() : null,
    },
  })
}

export async function markJobFailure(jobRecordId: string | undefined, error: unknown) {
  await markJob(jobRecordId, {
    status: "FAILED",
    progress: 0,
    error: error instanceof Error ? error.message : "Job failed.",
  })
}

async function readWithFfprobe(filePath: string) {
  try {
    const { stdout } = await execa("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      filePath,
    ])

    return JSON.parse(stdout) as {
      streams?: Array<Record<string, unknown>>
      format?: Record<string, unknown>
    }
  } catch {
    return null
  }
}

function parseDurationSeconds(
  format: Record<string, unknown> | undefined,
  stream: Record<string, unknown> | undefined,
): number | undefined {
  const raw =
    (typeof format?.duration === "string" ? Number(format.duration) : undefined) ??
    (typeof stream?.duration === "string" ? Number(stream.duration) : undefined)

  if (raw == null || !Number.isFinite(raw) || raw <= 0) return undefined
  return raw
}

async function detectMetadata(filePath: string) {
  const detected = await fileTypeFromFile(filePath)
  const mimeType = detected?.mime
  const extension = detected?.ext

  let width: number | undefined
  let height: number | undefined
  let durationSeconds: number | undefined
  let codec: string | undefined

  if (mimeType?.startsWith("image/")) {
    try {
      const metadata = await sharp(filePath).metadata()
      width = metadata.width
      height = metadata.height
    } catch {
      width = undefined
      height = undefined
    }
  }

  if (mimeType?.startsWith("video/") || mimeType?.startsWith("audio/")) {
    const ffprobe = await readWithFfprobe(filePath)
    const stream = ffprobe?.streams?.find((item) =>
      mimeType.startsWith("video/")
        ? item.codec_type === "video"
        : item.codec_type === "audio",
    )
    durationSeconds = parseDurationSeconds(ffprobe?.format, stream)
    width = typeof stream?.width === "number" ? stream.width : width
    height = typeof stream?.height === "number" ? stream.height : height
    codec = typeof stream?.codec_name === "string" ? stream.codec_name : undefined
  }

  return {
    mimeType,
    extension,
    width,
    height,
    durationSeconds,
    codec,
  }
}

async function generatePdfThumbnail(filePath: string, thumbnailPath: string) {
  const tmpPng = path.join(tmpdir(), `arciin-doc-${process.pid}-${Date.now()}.png`)
  try {
    const r = await execa(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        filePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:-1",
        tmpPng,
      ],
      { timeout: 120_000, reject: false },
    )
    if (r.exitCode !== 0) return null
    try {
      await access(tmpPng)
    } catch {
      return null
    }
    await sharp(tmpPng, { failOn: "none" })
      .resize(640, 360, { fit: "inside" })
      .webp({ quality: 82 })
      .toFile(thumbnailPath)
    return thumbnailPath
  } catch {
    return null
  } finally {
    await unlink(tmpPng).catch(() => {})
  }
}

async function generateThumbnail(
  assetId: string,
  filePath: string,
  storageRoot: string,
  mediaType: string,
  mimeType?: string | null,
  extension?: string | null,
  originalFilename?: string | null,
) {
  const thumbnailsDir = path.join(storageRoot, "thumbnails")
  await mkdir(thumbnailsDir, { recursive: true })
  const thumbnailPath = path.join(thumbnailsDir, `${assetId}.webp`)

  try {
    if (mediaType === "IMAGE") {
      await sharp(filePath, { failOn: "none" })
        .rotate()
        .resize(640, 360, { fit: "inside" })
        .webp({ quality: 82 })
        .toFile(thumbnailPath)
      return thumbnailPath
    }

    if (filePath.match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
      await sharp(filePath, { failOn: "none" })
        .rotate()
        .resize(640, 360, { fit: "inside" })
        .webp({ quality: 82 })
        .toFile(thumbnailPath)
      return thumbnailPath
    }

    if (mediaType === "VIDEO" || filePath.match(/\.(mov|mp4|mpe?g|webm|mkv|avi|m4v)$/i)) {
      const r = await execa(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          filePath,
          "-frames:v",
          "1",
          "-vf",
          "scale=640:-1",
          thumbnailPath,
        ],
        { timeout: 120_000, reject: false },
      )
      if (r.exitCode === 0) {
        try {
          await access(thumbnailPath)
          return thumbnailPath
        } catch {
          /* use placeholder */
        }
      }
      await sharp(Buffer.from(VIDEO_THUMBNAIL_PLACEHOLDER_SVG))
        .resize(640, 360)
        .webp({ quality: 80 })
        .toFile(thumbnailPath)
      return thumbnailPath
    }

    if (
      assetSupportsDocumentThumbnail(mediaType, mimeType, extension, originalFilename)
    ) {
      return generatePdfThumbnail(filePath, thumbnailPath)
    }

    return null
  } catch {
    return null
  }
}

export async function handleMediaJob(
  name: string,
  data:
    | (AnalyzeFilePayload & { jobRecordId?: string })
    | (ExtractMetadataPayload & { jobRecordId?: string })
    | (GenerateThumbnailPayload & { jobRecordId?: string }),
  redis: Redis
) {
  await markJob(data.jobRecordId, { status: "ACTIVE", progress: 10 })

  const asset = await prisma.asset.findUnique({
    where: { id: data.assetId },
    include: {
      storageObject: true,
      library: { select: { storageLocation: { select: { rootPath: true } } } },
    },
  })

  if (!asset) {
    throw new Error("Asset not found.")
  }

  const instance = await prisma.instanceConfig.findFirst()

  let objectFilePath: string | null = null
  for (const p of candidateStorageObjectPaths(
    instance?.storageRoot ?? null,
    asset.storageObject.physicalPath,
    asset.storageObject.objectKey,
    [path.resolve(workerConfig.ARCIIN_DATA_DIR), asset.library?.storageLocation?.rootPath],
  )) {
    try {
      await access(p)
      objectFilePath = p
      break
    } catch {
      continue
    }
  }

  if (!objectFilePath) {
    await markJobFailure(data.jobRecordId, new Error("Original file missing on disk."))
    return
  }

  const storageRoot = resolveArciinStorageRoot(instance?.storageRoot, objectFilePath)

  if (name === JOB_TYPES.analyzeFile || name === JOB_TYPES.extractMetadata) {
    const metadata = await detectMetadata(objectFilePath)

    const mimeType = metadata.mimeType || asset.mimeType
    const extension = metadata.extension || asset.extension
    const mediaType = inferMediaType(mimeType, asset.originalFilename)

    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        mimeType,
        extension,
        mediaType,
        width: metadata.width ?? asset.width,
        height: metadata.height ?? asset.height,
        durationSeconds: metadata.durationSeconds ?? asset.durationSeconds,
        codec: metadata.codec ?? asset.codec,
      },
    })

    if ("uploadId" in data && data.uploadId) {
      await prisma.uploadSession.update({
        where: { id: data.uploadId },
        data: {
          status: "CLASSIFIED",
          progress: 100,
        },
      })
    }

    await publishRealtimeEvent(
      redis,
      createRealtimeEvent("asset.classified", {
        assetId: asset.id,
        libraryId: asset.libraryId,
        userId: data.userId,
        message: `${asset.originalFilename} classified.`,
      })
    )

    if (name === JOB_TYPES.extractMetadata && asset.mediaType === "AUDIO") {
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          status: "READY",
        },
      })

      if ("uploadId" in data && data.uploadId) {
        await prisma.uploadSession.update({
          where: { id: data.uploadId },
          data: {
            status: "READY",
            progress: 100,
            completedAt: new Date(),
          },
        })
      }
    }
  }

  if (name === JOB_TYPES.generateThumbnail) {
    const thumbnailPath = await generateThumbnail(
      asset.id,
      objectFilePath,
      storageRoot,
      asset.mediaType,
      asset.mimeType,
      asset.extension,
      asset.originalFilename,
    )

    const assetPatch: { status?: "READY"; updatedAt?: Date } = {}
    if (asset.status !== "READY") {
      assetPatch.status = "READY"
    }
    if (thumbnailPath) {
      assetPatch.updatedAt = new Date()
    }
    if (Object.keys(assetPatch).length > 0) {
      await prisma.asset.update({
        where: { id: asset.id },
        data: assetPatch,
      })
    }

    const upload = await prisma.uploadSession.findFirst({
      where: {
        assetId: asset.id,
      },
      include: {
        targetLibrary: { select: { name: true } },
      },
    })

    /** PDFs are often READY before thumbnail jobs run — do not re-emit upload.completed (Sonner spam). */
    const uploadNotYetAnnounced =
      upload && upload.status !== "READY" && upload.completedAt == null

    if (uploadNotYetAnnounced) {
      const origin = asset.importSourceUrl ? "url" : "upload"
      const destination = upload.targetLibrary?.name

      await prisma.uploadSession.update({
        where: { id: upload.id },
        data: {
          status: "READY",
          progress: 100,
          completedAt: new Date(),
        },
      })

      await publishRealtimeEvent(
        redis,
        createRealtimeEvent("upload.completed", {
          userId: upload.userId,
          libraryId: asset.libraryId,
          uploadId: upload.id,
          assetId: asset.id,
          progress: 100,
          message:
            origin === "url"
              ? `${asset.originalFilename} imported from link.`
              : `${asset.originalFilename} uploaded.`,
          data: {
            fileName: asset.originalFilename,
            destination,
            origin,
          },
        }),
      )
    }

    if (thumbnailPath) {
      await publishRealtimeEvent(
        redis,
        createRealtimeEvent("thumbnail.created", {
          userId: data.userId,
          libraryId: asset.libraryId,
          assetId: asset.id,
          message: "Thumbnail created.",
        }),
      )
    }

    await syncConnectorMirrorsForAsset(asset.id).catch(() => {})
  }

  if (name === JOB_TYPES.extractMetadata && asset.mediaType === "AUDIO") {
    await syncConnectorMirrorsForAsset(asset.id).catch(() => {})
  }

  await markJob(data.jobRecordId, {
    status: "COMPLETED",
    progress: 100,
    result: {
      assetId: asset.id,
      jobType: name,
    },
  })
}

export async function handleStorageJob(
  name: string,
  data:
    | (CleanupTempFilesPayload & { jobRecordId?: string })
    | (CalculateStorageUsagePayload & { jobRecordId?: string })
    | (MigrateStoragePayload & { jobRecordId?: string })
) {
  await markJob(data.jobRecordId, { status: "ACTIVE", progress: 10 })

  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = normalizeConfiguredStorageRoot(
    instance?.storageRoot,
    path.resolve(workerConfig.ARCIIN_DATA_DIR),
  )

  if (name === JOB_TYPES.cleanupTempFiles) {
    const tempDir = path.join(storageRoot, "temp")
    const olderThanHours = "olderThanHours" in data ? data.olderThanHours : undefined
    const cutoff = Date.now() - (olderThanHours ?? 24) * 60 * 60 * 1000
    let deleted = 0

    try {
      const entries = await readdir(tempDir)

      for (const entry of entries) {
        const entryPath = path.join(tempDir, entry)
        const fileStat = await stat(entryPath)

        if (fileStat.mtimeMs < cutoff) {
          await rm(entryPath, { force: true })
          deleted += 1
        }
      }
    } catch {
      deleted = 0
    }

    await markJob(data.jobRecordId, {
      status: "COMPLETED",
      progress: 100,
      result: { deleted },
    })
    return
  }

  if (name === JOB_TYPES.calculateStorageUsage) {
    const objectsDir = path.join(storageRoot, "objects")
    let exists = true

    try {
      await access(objectsDir)
    } catch {
      exists = false
    }

    await markJob(data.jobRecordId, {
      status: "COMPLETED",
      progress: 100,
      result: {
        objectsDirExists: exists,
      },
    })
    return
  }

  if (name === JOB_TYPES.migrateStorage && "fromRoot" in data && "toRoot" in data) {
    const payload = data as MigrateStoragePayload & { jobRecordId?: string }
    try {
      const result = await runStorageMigration(
        prisma,
        {
          fromRoot: path.resolve(payload.fromRoot),
          toRoot: path.resolve(payload.toRoot),
          jobRecordId: payload.jobRecordId ?? "",
          userId: payload.requestedByUserId,
          displayRootLabel: payload.toRoot,
        },
        async (progress, phase) => {
          await markJob(payload.jobRecordId, {
            status: "ACTIVE",
            progress,
            result: { phase },
          })
        },
      )
      await markJob(payload.jobRecordId, {
        status: "COMPLETED",
        progress: 100,
        result: result as unknown as Record<string, unknown>,
      })
    } catch (error) {
      await markJobFailure(payload.jobRecordId, error)
      throw error
    }
  }
}

export async function handleIntegrationJob(
  name: string,
  data: PlexSyncPlaceholderPayload & { jobRecordId?: string },
  redis: Redis
) {
  await markJob(data.jobRecordId, { status: "ACTIVE", progress: 10 })

  if (name === JOB_TYPES.plexSyncPlaceholder) {
    await publishRealtimeEvent(
      redis,
      createRealtimeEvent("plex.sync.started", {
        userId: data.requestedByUserId,
        message: "Plex sync placeholder started.",
        data: {
          integrationId: data.integrationId,
        },
      })
    )

    await markJob(data.jobRecordId, {
      status: "COMPLETED",
      progress: 100,
      result: {
        integrationId: data.integrationId,
        placeholder: true,
      },
    })

    await publishRealtimeEvent(
      redis,
      createRealtimeEvent("plex.sync.completed", {
        userId: data.requestedByUserId,
        message: "Plex placeholder sync completed.",
        data: {
          integrationId: data.integrationId,
        },
      })
    )
  }
}
