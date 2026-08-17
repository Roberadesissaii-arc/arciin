import { access, copyFile, lstat, mkdir, readdir, readlink, rm, stat, unlink, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
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
  type DubMediaPayload,
  type TranscribeMediaPayload,
  type PlexSyncPlaceholderPayload,
  type StageUpdatePayload,
} from "@arciin/shared"
import { buildObjectKey, candidateStorageObjectPaths,
  normalizeConfiguredStorageRoot,
  resolveArciinStorageRoot,
} from "@arciin/storage"
import { normalizeTranscriptSegments } from "@arciin/shared"
import { languageName } from "@arciin/types"
import type {
  DubSegment,
  FitResult,
  PlacedClip,
  VoiceProfile,
} from "@arciin/media-ai"

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

/** ffmpeg, quietly, failing loudly. */
async function runFfmpeg(args: string[]) {
  await execa("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    timeout: 30 * 60 * 1000,
  })
}

/**
 * Keep the whole separator log, out of the database.
 *
 * The full output is genuinely useful when a separation dies — it names the
 * model, the bit depth, the chunk it reached — but it is diagnostics, not user
 * content, and it has no business in a column the browser renders. One file per
 * dub, overwritten on each attempt, swept by the existing temp cleanup.
 */
async function writeDubDiagnostics(dubId: string, storageRoot: string, output: string) {
  try {
    const dir = path.join(storageRoot, "logs")
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `dub-${dubId}.log`), output, "utf8")
  } catch {
    // Losing a diagnostic log must never be the reason a dub fails.
  }
}

/**
 * One or two sentences a person can act on.
 *
 * The old behaviour put `error.message` straight into the row, which for a
 * separator failure meant "Command failed: /srv/…" followed by pages of Python
 * logging. What someone needs to know first is which part broke and whether
 * trying again is worth it.
 */
function describeDubFailure(error: unknown): string {
  if (error instanceof Error && error.name === "MediaToolError") {
    const tool = (error as { tool?: string }).tool ?? ""
    if (tool.includes("separator")) {
      return `Audio separation failed. ${error.message}`
    }
    if (tool.includes("ffmpeg")) {
      return `Mixing the dubbed audio failed. ${error.message}`
    }
    return error.message
  }
  if (error instanceof Error && error.message) {
    // Long enough to be a log rather than a sentence: do not present it as one.
    return error.message.length > 300
      ? "The dub could not be generated. Open technical details for the full output."
      : error.message
  }
  return "The dub could not be generated."
}

/**
 * Move a generated file into content-addressed storage.
 *
 * The same layout uploads use, so a dub is an ordinary stored object that the
 * download route and cleanup already understand.
 */
async function storeDubArtifact(filePath: string, storageRoot: string, mimeType: string) {
  const checksum = await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256")
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject)
  })

  const extension = path.extname(filePath) || ".m4a"
  const objectKey = buildObjectKey(checksum, extension)
  const physicalPath = path.join(storageRoot, objectKey)
  await mkdir(path.dirname(physicalPath), { recursive: true })
  await copyFile(filePath, physicalPath)
  const size = (await stat(physicalPath)).size

  const location = await prisma.storageLocation.findFirst({ where: { isDefault: true } })
  if (!location) throw new Error("No default storage location is configured.")

  // Content-addressed, so re-generating an identical dub reuses the row.
  const existing = await prisma.storageObject.findUnique({ where: { objectKey } })
  if (existing) return existing

  return prisma.storageObject.create({
    data: {
      storageLocationId: location.id,
      objectKey,
      physicalPath,
      sizeBytes: BigInt(size),
      checksumSha256: checksum,
      mimeType,
    },
  })
}

export async function handleMediaJob(
  name: string,
  data:
    | (AnalyzeFilePayload & { jobRecordId?: string })
    | (ExtractMetadataPayload & { jobRecordId?: string })
    | (GenerateThumbnailPayload & { jobRecordId?: string })
    | (TranscribeMediaPayload & { jobRecordId?: string })
    | (DubMediaPayload & { jobRecordId?: string }),
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

  if (name === JOB_TYPES.dubMedia && "dubId" in data) {
    /**
     * A dub: separate, synthesise, fit, mix, store.
     *
     * Every stage here is unbounded, and separation alone runs at roughly 13x
     * realtime on a CPU without AVX, so this cannot live in a request. The dub
     * row is updated as the stages pass, which is what lets a panel closed
     * mid-run reopen onto the current state rather than starting again.
     *
     * The media never leaves the server. Separation is local; only translated
     * text and performance instructions go to Gemini, and audio comes back.
     */
    const payload = data as DubMediaPayload & { jobRecordId?: string }
    const media = await import("@arciin/media-ai")

    /**
     * How far the whole dub has got, per stage.
     *
     * The stages are wildly uneven — separation is most of the wall clock on
     * this hardware — so a stage's own percentage is mapped into the slice of
     * the job it represents. Otherwise the overall bar sprints to 45% in the
     * first minute and then sits still for an hour.
     */
    const STAGE_SPAN: Record<string, [number, number]> = {
      PREPARING: [5, 10],
      SEPARATING: [10, 60],
      SYNTHESIZING: [60, 85],
      MIXING: [85, 98],
    }

    const overall = (status: string, stagePercent: number | null) => {
      const [from, to] = STAGE_SPAN[status] ?? [0, 100]
      if (stagePercent === null) return from
      return Math.round(from + ((to - from) * Math.max(0, Math.min(100, stagePercent))) / 100)
    }

    const throttle = new media.ProgressThrottle()

    const stage = async (
      status: "PREPARING" | "SEPARATING" | "SYNTHESIZING" | "MIXING",
      label: string,
    ) => {
      throttle.reset()
      await prisma.mediaDub.update({
        where: { id: payload.dubId },
        data: {
          status,
          stage: label,
          // A new stage has no counter yet, and last stage's numbers would be a
          // lie. Cleared so the panel shows an indeterminate state instead.
          progressPercent: null,
          progressCurrent: null,
          progressTotal: null,
          progressUpdatedAt: new Date(),
        },
      })
      await markJob(payload.jobRecordId, { status: "ACTIVE", progress: overall(status, null) })
    }

    /**
     * A real counter from whatever is doing the work.
     *
     * Throttled, because the separator reports 123 times over ninety minutes and
     * synthesis once per segment, and every write is CPU taken from the job the
     * reader is waiting for. `progressUpdatedAt` moves on every write it does
     * make, which is what lets the panel tell slow from stopped.
     */
    const reportProgress = async (
      status: "SEPARATING" | "SYNTHESIZING" | "MIXING",
      current: number,
      total: number,
      label?: string,
    ) => {
      const percent = media.percentOf(current, total)
      if (!throttle.shouldWrite(percent)) return
      await prisma.mediaDub.update({
        where: { id: payload.dubId },
        data: {
          progressPercent: percent,
          progressCurrent: current,
          progressTotal: total,
          progressUpdatedAt: new Date(),
          ...(label ? { stage: label } : {}),
        },
      })
      await markJob(payload.jobRecordId, { status: "ACTIVE", progress: overall(status, percent) })
    }

    const failDub = async (message: string, detail?: string) => {
      await prisma.mediaDub.update({
        where: { id: payload.dubId },
        data: {
          status: "FAILED",
          stage: null,
          error: message,
          // Bounded and sanitised; the full log stays on disk.
          errorDetail: detail ?? null,
          progressUpdatedAt: new Date(),
        },
      })
      await markJob(payload.jobRecordId, { status: "FAILED", progress: 100, error: message })
    }

    const workDir = path.join(storageRoot, "temp", `dub-${payload.dubId}`)

    try {
      const translation = await prisma.mediaTranslation.findUnique({
        where: { id: payload.translationId },
        include: { transcript: true },
      })
      if (!translation || translation.status !== "READY") {
        await failDub("The translation is not ready.")
        return
      }

      const segments = normalizeTranscriptSegments(translation.segments)
      if (segments.length === 0) {
        await failDub("The translation has no speech to dub.")
        return
      }

      const dubRow = await prisma.mediaDub.findUnique({ where: { id: payload.dubId } })
      const profiles = (dubRow?.voiceProfiles ?? []) as unknown as VoiceProfile[]
      if (profiles.length === 0) {
        await failDub("No voice settings were saved for this dub.")
        return
      }

      let config
      try {
        config = await media.resolveGeminiMediaConfig(prisma, payload.profileId)
      } catch {
        await failDub("Add a Gemini model profile under Models to generate a dub.")
        return
      }

      await mkdir(workDir, { recursive: true })

      // ── prepare ─────────────────────────────────────────────────────────
      await stage("PREPARING", "Preparing audio")

      // ── separate ────────────────────────────────────────────────────────
      await stage("SEPARATING", "Separating dialogue from background")
      const separation = new media.AudioSeparationService([new media.AudioSeparatorBackend()])
      if (!(await separation.isAvailable())) {
        await failDub(
          "Audio dubbing needs a separator so the original music and ambience can be kept. See docs/DUBBING.md.",
        )
        return
      }

      const sourceAudio = path.join(workDir, "source.wav")
      await runFfmpeg(["-y", "-i", objectFilePath, "-vn", "-ac", "2", "-ar", "44100", sourceAudio])

      const stems = await separation.separate({
        inputPath: sourceAudio,
        workDir,
        onStage: (label) => {
          void prisma.mediaDub.update({ where: { id: payload.dubId }, data: { stage: label } })
        },
        /**
         * The separator's own chunk counter.
         *
         * This is the number the reader was missing: the tool was printing
         * `39/122` while the panel said only "Separating dialogue from
         * background" for half an hour.
         */
        onProgress: (progress) => {
          void reportProgress(
            "SEPARATING",
            progress.completed,
            progress.total,
            "Separating dialogue from background",
          ).catch(() => {})
        },
        /** The whole log, kept where diagnostics belong rather than in a column. */
        onDiagnostics: (output) => writeDubDiagnostics(payload.dubId, storageRoot, output),
      })

      // ── synthesise ──────────────────────────────────────────────────────
      await stage("SYNTHESIZING", "Generating translated voices")
      const bySpeaker = new Map<string, DubSegment[]>()
      for (const segment of segments) {
        const speaker = segment.speaker ?? profiles[0]!.speakerId
        const list = bySpeaker.get(speaker) ?? []
        list.push({ ...segment, speaker })
        bySpeaker.set(speaker, list)
      }

      const clips: PlacedClip[] = []
      const fits: FitResult[] = []
      /** What was actually spoken, when it differs from the saved translation. */
      const script: {
        startMs: number
        sourceText: string
        spokenText: string
        adapted: boolean
        lostMeaning: boolean
      }[] = []

      const targetLanguageName = languageName(translation.language) || translation.language

      /**
       * How many requests synthesis will make, known before it starts.
       *
       * Counted rather than estimated, so "segment 4 of 12" is a fact. The
       * chunking is the same call the loop below uses, so the total cannot drift
       * from what actually happens.
       */
      const plannedChunks = [...bySpeaker.values()].reduce(
        (sum, list) => sum + media.chunkSegments(list).length,
        0,
      )
      let synthesised = 0

      for (const [speaker, speakerSegments] of bySpeaker) {
        const profile =
          profiles.find((p) => p.speakerId === speaker) ?? profiles[0]!
        // Chunked so a long transcript does not drift, and never mixing speakers.
        for (const chunk of media.chunkSegments(speakerSegments)) {
          const chunkStart = chunk[0]!.startMs
          const chunkEnd = chunk[chunk.length - 1]!.endMs ?? chunkStart
          const sourceText = chunk.map((c) => c.text).join(" ")

          const speak = async (segments: typeof chunk) =>
            media.synthesizeDubChunk({
              config,
              profile,
              segments,
              sourceLanguage: translation.transcript.language,
              targetLanguage: translation.language,
            })

          let spoken = chunk
          let result = await speak(spoken)
          let fit = media.fitSegment({
            startMs: chunkStart,
            endMs: chunkEnd,
            actualMs: result.durationMs,
            speaker,
          })
          let adaptation = { adapted: false, lostMeaning: false, text: sourceText }

          /**
           * Too long to say in the time available: rewrite the line, not the
           * timeline.
           *
           * The saved translation is left exactly as it is — a reader's
           * transcript stays complete and faithful — while the dub speaks a
           * tighter version of the same line. Pushing it later instead produced
           * a 12.8-second dub for a 10-second video, which is speech nobody
           * ever hears.
           */
          if (fit.needsReview) {
            const ratio = media.adaptationRatio(fit.targetMs, result.durationMs)
            adaptation = await media.adaptDubLine({
              config,
              text: sourceText,
              languageName: targetLanguageName,
              ratio,
              targetMs: fit.targetMs,
            })

            if (adaptation.adapted) {
              spoken = [{ ...chunk[0]!, text: adaptation.text, endMs: chunkEnd }]
              result = await speak(spoken)
              fit = media.fitSegment({
                startMs: chunkStart,
                endMs: chunkEnd,
                actualMs: result.durationMs,
                speaker,
              })
            }
          }

          fits.push(fit)
          script.push({
            startMs: chunkStart,
            sourceText,
            spokenText: adaptation.adapted ? adaptation.text : sourceText,
            adapted: adaptation.adapted,
            lostMeaning: adaptation.lostMeaning,
          })

          const clipPath = path.join(workDir, `clip-${clips.length}.wav`)
          await writeFile(clipPath, media.pcmToWav(result.pcm))
          clips.push({ path: clipPath, startMs: chunkStart, rate: fit.rate })

          synthesised += 1
          await reportProgress(
            "SYNTHESIZING",
            synthesised,
            plannedChunks,
            // Named, because with two speakers "4 of 12" alone hides which
            // voice is being generated.
            `Generating translated voices · ${speaker}`,
          )
        }
      }

      /**
       * Place everything inside the picture.
       *
       * The media duration is the hard bound: a clip that will not fit in what
       * remains is trimmed and flagged rather than appended past the end.
       */
      const mediaDurationMs = Math.round((asset.durationSeconds ?? 0) * 1000)
      const placed = media.layoutTimeline(fits, mediaDurationMs || undefined)
      placed.forEach((slot, index) => {
        const clip = clips[index]
        if (clip) clip.startMs = slot.startMs
      })
      const clamped = placed.filter((slot) => slot.clamped).length

      // ── mix ─────────────────────────────────────────────────────────────
      await stage("MIXING", "Mixing the original soundtrack")
      const audioName = media.dubFilename(asset.originalFilename, translation.language, "audio")
      const dubAudioPath = path.join(workDir, audioName)
      await runFfmpeg(
        media.buildMixArgs({
          backgroundPath: stems.backgroundPath,
          clips,
          outputPath: dubAudioPath,
        }),
      )

      await prisma.mediaDub.update({
        where: { id: payload.dubId },
        data: { stage: "Saving dubbed audio", progressUpdatedAt: new Date() },
      })
      const stored = await storeDubArtifact(dubAudioPath, storageRoot, "audio/mp4")
      // Anything the rate could not fix, or the picture could not hold.
      const review = fits.filter((f) => f.needsReview)
      const summary = media.summariseFit(fits)

      await prisma.mediaDub.update({
        where: { id: payload.dubId },
        data: {
          // Generated, but honest that some lines could not be fitted naturally.
          status: review.length > 0 || clamped > 0 ? "NEEDS_REVIEW" : "READY",
          stage: null,
          error: null,
          provider: "gemini",
          model: media.DUB_TTS_MODEL,
          backgroundStrategy: stems.strategy,
          audioStorageObjectId: stored.id,
          durationMs: Math.round((asset.durationSeconds ?? 0) * 1000) || null,
          reviewSegments: review as unknown as object,
          // The spoken script, so a reader can see where words were tightened.
          dubScript: script as unknown as object,
          translationUpdatedAt: translation.updatedAt,
          transcriptUpdatedAt: translation.transcript.updatedAt,
          generatedAt: new Date(),
        },
      })
      await markJob(payload.jobRecordId, {
        status: "COMPLETED",
        progress: 100,
        result: {
          segments: summary.total,
          adjusted: summary.adjusted,
          review: review.length,
          clamped,
          adapted: script.filter((line) => line.adapted).length,
        },
      })
    } catch (error) {
      /**
       * What the reader is told, and what is kept for whoever debugs it.
       *
       * A `MediaToolError` already carries both. Anything else gets its message
       * as the summary and nothing as the detail, because a message we did not
       * shape is not safe to present as technical output.
       */
      const summary = describeDubFailure(error)
      const detail = error instanceof media.MediaToolError ? error.detail : undefined
      await failDub(summary, detail)
    } finally {
      // The stems and clips are large and only needed during the run.
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
    return
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
