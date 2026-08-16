import { access, lstat, mkdir, readdir, readlink, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { UnrecoverableError } from "bullmq"
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
  planTempCleanup,
  isIsoMediaContainerMime,
  refineIsoMediaClassification,
  summarizeMediaStreams,
  type AnalyzeFilePayload,
  type ApplyUpdatePayload,
  type CalculateStorageUsagePayload,
  type CleanupTempFilesPayload,
  type MigrateStoragePayload,
  type ExtractMetadataPayload,
  type GenerateThumbnailPayload,
  type TranscribeMediaPayload,
  type PlexSyncPlaceholderPayload,
  type StageUpdatePayload,
} from "@arciin/shared"
import {
  candidateStorageObjectPaths,
  normalizeConfiguredStorageRoot,
  resolveArciinStorageRoot,
} from "@arciin/storage"

import { workerConfig } from "@/config"
import { runApplyUpdate, runStageUpdate } from "@/services/auto-update"
import { syncConnectorMirrorsForAsset } from "@/services/connector-mirror"
import { createRealtimeEvent, publishRealtimeEvent } from "@/services/realtime"
import {
  completeUploadSession as runCompleteUploadSession,
  failUploadSession,
  type CompletionDeps,
} from "@/services/upload-completion"

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

/** Bind the injectable completion helpers to the real Prisma client and Redis. */
function completionDeps(redis: Redis): CompletionDeps {
  return {
    findUploadSession: async ({ uploadId, assetId }) =>
      uploadId
        ? prisma.uploadSession.findUnique({
            where: { id: uploadId },
            include: { targetLibrary: { select: { name: true } } },
          })
        : assetId
          ? prisma.uploadSession.findFirst({
              where: { assetId },
              include: { targetLibrary: { select: { name: true } } },
            })
          : null,
    promoteUploadSession: async ({ id, unlessStatusIn, data }) => {
      const result = await prisma.uploadSession.updateMany({
        where: {
          id,
          status: { notIn: unlessStatusIn as Prisma.EnumUploadStatusFilter["notIn"] },
        },
        data: data as Prisma.UploadSessionUpdateManyMutationInput,
      })
      return result.count
    },
    markAssetFailed: async (assetId, message) => {
      await prisma.asset.update({
        where: { id: assetId },
        data: { status: "FAILED", processingError: message },
      })
    },
    publish: async (event) => {
      const { type, ...rest } = event
      await publishRealtimeEvent(redis, createRealtimeEvent(type, rest))
    },
  }
}

/** Surface a failed media job to the user rather than leaving it "Processing". */
export async function failUploadForJob(
  redis: Redis,
  data: { uploadId?: string; assetId?: string },
  error: unknown,
) {
  await failUploadSession(completionDeps(redis), data, error)
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

async function detectMetadata(filePath: string, originalFilename: string) {
  const detected = await fileTypeFromFile(filePath)

  let mimeType = detected?.mime
  let extension = detected?.ext
  let mediaTypeOverride: string | undefined

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

    // Same stream-aware rule the API applies at upload time, so both sides
    // reach the same verdict for audio-only MP4/M4A containers.
    if (isIsoMediaContainerMime(mimeType)) {
      const refined = refineIsoMediaClassification({
        mediaType: inferMediaType(mimeType, originalFilename),
        mimeType,
        extension: extension ?? "",
        originalFilename,
        streams: summarizeMediaStreams(ffprobe?.streams),
      })
      mimeType = refined.mimeType
      extension = refined.extension || extension
      mediaTypeOverride = refined.mediaType
    }

    const wantsVideoStream = mimeType.startsWith("video/")
    const stream = ffprobe?.streams?.find((item) =>
      wantsVideoStream ? item.codec_type === "video" : item.codec_type === "audio",
    )
    durationSeconds = parseDurationSeconds(ffprobe?.format, stream)
    width = typeof stream?.width === "number" ? stream.width : width
    height = typeof stream?.height === "number" ? stream.height : height
    codec = typeof stream?.codec_name === "string" ? stream.codec_name : undefined
  }

  return {
    mimeType,
    extension,
    mediaTypeOverride,
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
    | (GenerateThumbnailPayload & { jobRecordId?: string })
    | (TranscribeMediaPayload & { jobRecordId?: string }),
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
    // Throw rather than return: returning marked the BullMQ job successful, so
    // the upload sat at "Processing" forever with nothing reported.
    // Unrecoverable — a missing file will still be missing on the next attempt,
    // so this fails once instead of burning the whole retry budget.
    throw new UnrecoverableError("Original file missing on disk.")
  }

  const storageRoot = resolveArciinStorageRoot(instance?.storageRoot, objectFilePath)

  if (name === JOB_TYPES.analyzeFile || name === JOB_TYPES.extractMetadata) {
    const metadata = await detectMetadata(objectFilePath, asset.originalFilename)

    const mimeType = metadata.mimeType || asset.mimeType
    const extension = metadata.extension || asset.extension
    const mediaType =
      metadata.mediaTypeOverride ?? inferMediaType(mimeType, asset.originalFilename)

    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        mimeType,
        extension,
        mediaType: mediaType as typeof asset.mediaType,
        width: metadata.width ?? asset.width,
        height: metadata.height ?? asset.height,
        durationSeconds: metadata.durationSeconds ?? asset.durationSeconds,
        codec: metadata.codec ?? asset.codec,
      },
    })

    if ("uploadId" in data && data.uploadId) {
      // Never walk a finished upload back to CLASSIFIED: the thumbnail job may
      // have already promoted it to READY (job order is not guaranteed).
      await prisma.uploadSession.updateMany({
        where: { id: data.uploadId, status: { notIn: ["READY", "FAILED"] } },
        data: {
          status: "CLASSIFIED",
          progress: 90,
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

    // Audio never gets a thumbnail job, so metadata extraction is the last
    // required step — finish the upload here. Use the freshly detected type,
    // not the stale row read before the update above.
    if (name === JOB_TYPES.extractMetadata && mediaType === "AUDIO") {
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          status: "READY",
        },
      })

      await runCompleteUploadSession(completionDeps(redis), {
        uploadId: "uploadId" in data ? data.uploadId : undefined,
        assetId: asset.id,
        libraryId: asset.libraryId,
        originalFilename: asset.originalFilename,
        importSourceUrl: asset.importSourceUrl,
      })
    }
  }

  if (name === JOB_TYPES.transcribeMedia && "transcriptId" in data) {
    /**
     * Speech to timestamped text.
     *
     * Runs here rather than in the API process because the work is unbounded —
     * a long recording means minutes of extraction, upload and model time — and
     * because a queued job survives the browser tab that asked for it. The
     * transcript row is updated as the stages pass, so a drawer reopened after
     * a refresh picks the run up where it is rather than starting again.
     */
    const payload = data as TranscribeMediaPayload & { jobRecordId?: string }
    const { transcribeMedia } = await import("@arciin/media-ai")
    const { resolveGeminiMediaConfig, GeminiNotConfiguredError } = await import(
      "@arciin/media-ai"
    )

    const failTranscript = async (message: string, status: "FAILED" | "NO_AUDIO" | "NO_SPEECH") => {
      await prisma.mediaTranscript.update({
        where: { id: payload.transcriptId },
        data: { status, error: status === "FAILED" ? message : null },
      })
      await markJob(payload.jobRecordId, {
        status: status === "FAILED" ? "FAILED" : "COMPLETED",
        progress: 100,
        ...(status === "FAILED" ? { error: message } : { result: { outcome: status } }),
      })
    }

    try {
      const config = await resolveGeminiMediaConfig(prisma, payload.profileId)

      await prisma.mediaTranscript.update({
        where: { id: payload.transcriptId },
        data: { status: "PROCESSING", model: config.model, provider: "gemini" },
      })
      await markJob(payload.jobRecordId, { status: "ACTIVE", progress: 20 })

      const result = await transcribeMedia({
        config,
        filePath: objectFilePath,
        mimeType: asset.mimeType,
        onStage: (stage: "preparing" | "uploading" | "analyzing") => {
          // Named stages, not an invented percentage: the only honest numbers
          // here are the ones the pipeline actually reaches.
          const progress = stage === "preparing" ? 30 : stage === "uploading" ? 50 : 70
          void markJob(payload.jobRecordId, { status: "ACTIVE", progress })
        },
      })

      if (!result.ok) {
        await failTranscript(
          result.message,
          result.reason === "no_audio"
            ? "NO_AUDIO"
            : result.reason === "no_speech"
              ? "NO_SPEECH"
              : "FAILED",
        )
        return
      }

      await prisma.mediaTranscript.update({
        where: { id: payload.transcriptId },
        data: {
          status: "READY",
          language: result.language,
          segments: result.segments as unknown as Prisma.InputJsonValue,
          fullText: result.fullText,
          durationSeconds: result.durationSeconds,
          model: result.model,
          provider: "gemini",
          error: null,
          // A fresh generation is machine output again, whatever came before.
          edited: false,
          generatedAt: new Date(),
        },
      })

      await markJob(payload.jobRecordId, {
        status: "COMPLETED",
        progress: 100,
        result: { segments: result.segments.length, language: result.language },
      })

      await publishRealtimeEvent(
        redis,
        createRealtimeEvent("asset.transcript.ready", {
          userId: payload.userId,
          assetId: asset.id,
          message: `Transcript ready for ${asset.originalFilename}.`,
          data: { transcriptId: payload.transcriptId },
        }),
      ).catch(() => {})
      return
    } catch (error) {
      const message =
        error instanceof GeminiNotConfiguredError
          ? "Gemini isn't configured. Add a Gemini key under Models."
          : error instanceof Error
            ? error.message
            : "Transcript generation failed."
      await failTranscript(message, "FAILED")
      return
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

    await runCompleteUploadSession(completionDeps(redis), {
      uploadId: "uploadId" in data ? data.uploadId : undefined,
      assetId: asset.id,
      libraryId: asset.libraryId,
      originalFilename: asset.originalFilename,
      importSourceUrl: asset.importSourceUrl,
    })

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
    | (StageUpdatePayload & { jobRecordId?: string })
    | (ApplyUpdatePayload & { jobRecordId?: string }),
  redis: Redis
) {
  if (name === JOB_TYPES.stageUpdate && "targetVersion" in data) {
    await markJob(data.jobRecordId, { status: "ACTIVE", progress: 10 })
    const result = await runStageUpdate(data.targetVersion, redis)
    if (result.success) {
      await markJob(data.jobRecordId, { status: "COMPLETED", progress: 100, result: {} })
    } else {
      await markJobFailure(data.jobRecordId, new Error("Update stage failed — see Settings -> Updates for details."))
    }
    return
  }

  if (name === JOB_TYPES.applyUpdate) {
    await markJob(data.jobRecordId, { status: "ACTIVE", progress: 10 })
    const result = await runApplyUpdate(redis)
    // If applyNative() actually restarted this process, execution never
    // reaches here — that's expected, not an error.
    if (result.success) {
      await markJob(data.jobRecordId, { status: "COMPLETED", progress: 100, result: {} })
    } else {
      await markJobFailure(data.jobRecordId, new Error("No staged update to apply, or apply failed."))
    }
    return
  }

  await markJob(data.jobRecordId, { status: "ACTIVE", progress: 10 })

  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = normalizeConfiguredStorageRoot(
    instance?.storageRoot,
    path.resolve(workerConfig.ARCIIN_DATA_DIR),
  )

  if (name === JOB_TYPES.cleanupTempFiles) {
    const startedAt = Date.now()
    const tempDir = path.resolve(storageRoot, "temp")
    const olderThanHours = "olderThanHours" in data ? data.olderThanHours : undefined

    let examined = 0
    let deleted = 0
    let bytesRecovered = 0
    let retained = 0
    let errors = 0

    try {
      const entries = await readdir(tempDir, { withFileTypes: true })
      const candidates = []

      for (const entry of entries) {
        examined += 1
        const entryPath = path.join(tempDir, entry.name)

        try {
          // lstat, not stat: a symlink must be judged as a link, not followed.
          const linkStat = await lstat(entryPath)
          if (linkStat.isSymbolicLink()) {
            const target = path.resolve(tempDir, await readlink(entryPath))
            candidates.push({
              path: entryPath,
              mtimeMs: linkStat.mtimeMs,
              sizeBytes: 0,
              escapesRoot: !target.startsWith(`${tempDir}/`),
            })
            continue
          }
          if (!linkStat.isFile()) {
            retained += 1
            continue
          }
          candidates.push({
            path: entryPath,
            mtimeMs: linkStat.mtimeMs,
            sizeBytes: linkStat.size,
          })
        } catch {
          errors += 1
        }
      }

      // The decision is made by a pure, unit-tested policy; this loop only
      // carries it out.
      const plan = planTempCleanup(candidates, {
        tempRoot: tempDir,
        now: Date.now(),
        maxAgeHours: olderThanHours,
      })

      retained += plan.retained.length

      for (const file of plan.deletable) {
        try {
          await rm(file.path, { force: true })
          deleted += 1
          bytesRecovered += file.sizeBytes
        } catch {
          errors += 1
        }
      }
    } catch {
      // A missing temp directory is not a failure — nothing to clean.
      errors += 1
    }

    const result = {
      examined,
      deleted,
      retained,
      bytesRecovered,
      errors,
      durationMs: Date.now() - startedAt,
    }

    // Counts and bytes only — never private filenames.
    console.log("[cleanup] temp files", JSON.stringify(result))

    await markJob(data.jobRecordId, {
      status: "COMPLETED",
      progress: 100,
      result,
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
