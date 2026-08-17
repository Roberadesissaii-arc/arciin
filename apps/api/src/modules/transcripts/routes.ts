/**
 * Transcript endpoints.
 *
 * Three verbs and nothing clever: read the current transcript, ask for one, and
 * save a corrected one. All the provider work lives behind
 * `services/media-ai`, so this file is about access and state.
 *
 * The access rule is the important part. An asset id is guessable, so every
 * route resolves the asset itself and re-checks folder access rather than
 * trusting the caller to have asked for something they can see.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { JOB_TYPES, normalizeTranscriptSegments } from "@arciin/shared"
import { isSameLanguage, languageName } from "@arciin/types"
import { access, rm } from "node:fs/promises"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { candidateStorageObjectPaths } from "@arciin/storage"

import { assertAssetFolderAccess } from "@/services/folders/folder-lock"
import {
  describeBackends,
  loadDubbingSettings,
  saveSeparationMode,
} from "@/services/dubbing/separation-settings"
import { getRunPodStatus } from "@/services/dubbing/runpod-config"
import { streamFileResponse } from "@/services/media/stream-file-response"
import { mediaQueue } from "@/services/jobs/queues"
import {
  AudioSeparationService,
  AudioSeparatorBackend,
  DUB_TTS_MODEL,
  GeminiNotConfiguredError,
  buildVoiceProfile,
  resolveGeminiMediaConfig,
  suggestTitles,
  translateTranscript,
  voiceSettingsFingerprint,
  GEMINI_VOICES,
  buildRemuxArgs,
  resolveSeparationBackend,
  SeparationModeUnavailableError,
  type VoiceProfile,
} from "@arciin/media-ai"
import { requireRole } from "@/services/security/auth"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"

/** Remuxing is a stream copy, so this stays a short, bounded call. */
const execFileAsync = promisify(execFile)

/** Media we will try to transcribe. Audio is included for future reuse. */
function isTranscribableAsset(mediaType: string): boolean {
  return mediaType === "VIDEO" || mediaType === "AUDIO"
}

function serializeTranscript(row: {
  id: string
  assetId: string
  status: string
  provider: string | null
  model: string | null
  language: string | null
  fullText: string | null
  segments: unknown
  durationSeconds: number | null
  edited: boolean
  error: string | null
  jobId: string | null
  generatedAt: Date | null
  updatedAt: Date
}) {
  return {
    id: row.id,
    assetId: row.assetId,
    status: row.status,
    provider: row.provider,
    model: row.model,
    language: row.language,
    fullText: row.fullText,
    segments: normalizeTranscriptSegments(row.segments),
    durationSeconds: row.durationSeconds,
    edited: row.edited,
    error: row.error,
    jobId: row.jobId,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Languages the speech model can actually voice.
 *
 * Translation reaches far more languages than TTS does, so a dub button must
 * not appear for a language the provider cannot speak — the reader would pay
 * for a job that could only fail.
 */
const DUBBABLE_LANGUAGES = new Set([
  "ar", "bn", "de", "en", "es", "fr", "gu", "hi", "id", "it", "ja", "kn", "ko",
  "ml", "mr", "nl", "pl", "pt", "ro", "ru", "ta", "te", "th", "tr", "uk", "ur",
  "vi", "zh",
])

export function isDubbableLanguage(tag: string): boolean {
  return DUBBABLE_LANGUAGES.has(tag.trim().toLowerCase().split(/[-_]/)[0] ?? "")
}

function serializeDub(
  row: {
    id: string
    language: string
    status: string
    stage: string | null
    error: string | null
    errorDetail: string | null
    progressPercent: number | null
    progressCurrent: number | null
    progressTotal: number | null
    progressUpdatedAt: Date | null
    progressSamples: unknown
    separationMode: string | null
    separationBackend: string | null
    provider: string | null
    model: string | null
    voiceProfiles: unknown
    backgroundStrategy: string | null
    reviewSegments: unknown
    audioStorageObjectId: string | null
    durationMs: number | null
    translationUpdatedAt: Date | null
    transcriptUpdatedAt: Date | null
    settingsFingerprint: string | null
    generatedAt: Date | null
    updatedAt: Date
  },
  translationUpdatedAt: Date,
  transcriptUpdatedAt: Date,
) {
  return {
    id: row.id,
    language: row.language,
    status: row.status,
    stage: row.stage,
    error: row.error,
    errorDetail: row.errorDetail,
    /** Real counters, or null where the stage genuinely cannot say. */
    progressPercent: row.progressPercent,
    progressCurrent: row.progressCurrent,
    progressTotal: row.progressTotal,
    progressUpdatedAt: row.progressUpdatedAt?.toISOString() ?? null,
    /**
     * The rolling history the estimate is computed from.
     *
     * Sent rather than reduced to a number on the server, because the browser
     * recomputes between polls — time spent on the chunk in flight counts, and
     * a figure baked at fetch time would freeze for four seconds and then jump.
     */
    progressSamples: Array.isArray(row.progressSamples) ? row.progressSamples : null,
    separationMode: row.separationMode,
    separationBackend: row.separationBackend,
    provider: row.provider,
    model: row.model,
    voiceProfiles: (row.voiceProfiles ?? []) as unknown,
    backgroundStrategy: row.backgroundStrategy,
    reviewSegments: (row.reviewSegments ?? []) as unknown,
    hasAudio: Boolean(row.audioStorageObjectId),
    durationMs: row.durationMs,
    /**
     * The words or the voices have moved since this audio was made.
     *
     * Derived on read so one edit marks every dub at once, and so a stale dub
     * is never played as though it matched the text on screen.
     */
    stale:
      (row.translationUpdatedAt !== null && row.translationUpdatedAt < translationUpdatedAt) ||
      (row.transcriptUpdatedAt !== null && row.transcriptUpdatedAt < transcriptUpdatedAt),
    generatedAt: row.generatedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeTranslation(
  row: {
    id: string
    language: string
    status: string
    provider: string | null
    model: string | null
    fullText: string | null
    segments: unknown
    error: string | null
    sourceUpdatedAt: Date | null
    generatedAt: Date | null
    updatedAt: Date
  },
  sourceUpdatedAt: Date,
) {
  return {
    id: row.id,
    language: row.language,
    status: row.status,
    provider: row.provider,
    model: row.model,
    fullText: row.fullText,
    segments: normalizeTranscriptSegments(row.segments),
    error: row.error,
    /**
     * The original has moved since this was produced.
     *
     * Derived rather than stored so an edit to the transcript marks every
     * translation at once, without a fan-out write that could half-succeed.
     */
    stale: Boolean(row.sourceUpdatedAt && row.sourceUpdatedAt < sourceUpdatedAt),
    generatedAt: row.generatedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function transcriptRoutes(fastify: FastifyInstance) {
  const guard = [requireRole(["OWNER", "ADMIN", "MEMBER"])]

  /**
   * The asset, if this caller may see it.
   *
   * Returns null having already sent the reply, so callers just `return`.
   * Deliberately identical for "does not exist" and "not allowed": telling an
   * unauthorised caller which ids are real is itself a leak.
   */
  /**
   * Where a stored object's bytes actually are.
   *
   * The same candidate walk the download route uses: a physical path recorded
   * before a storage move is not necessarily where the file lives now.
   */
  async function resolveStoredPath(objectId: string): Promise<string | null> {
    const object = await fastify.prisma.storageObject.findUnique({
      where: { id: objectId },
      include: { storageLocation: { select: { rootPath: true } } },
    })
    if (!object) return null

    const instance = await fastify.prisma.instanceConfig.findFirst()
    for (const candidate of candidateStorageObjectPaths(
      instance?.storageRoot ?? null,
      object.physicalPath,
      object.objectKey,
      [object.storageLocation?.rootPath],
    )) {
      try {
        await access(candidate)
        return candidate
      } catch {
        continue
      }
    }
    return null
  }

  async function loadAccessibleAsset(
    request: FastifyRequest,
    reply: FastifyReply,
    assetId: string,
  ) {
    const asset = await fastify.prisma.asset.findFirst({
      where: { id: assetId, deletedAt: null },
      select: {
        id: true,
        folderId: true,
        mediaType: true,
        mimeType: true,
        originalFilename: true,
        durationSeconds: true,
      },
    })
    if (!asset) {
      reply.status(404).send({ error: { code: "NOT_FOUND", message: "File not found." } })
      return null
    }
    if (!(await assertAssetFolderAccess(fastify, request, reply, asset.folderId))) {
      return null
    }
    return asset
  }

  // ── read ──────────────────────────────────────────────────────────────────
  fastify.get(
    "/assets/:assetId/transcript",
    { preHandler: guard },
    async (request, reply) => {
      const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      const transcript = await fastify.prisma.mediaTranscript.findUnique({
        where: { assetId },
        include: { translations: { orderBy: { language: "asc" } } },
      })

      reply.send({
        data: {
          transcript: transcript ? serializeTranscript(transcript) : null,
          translations: transcript
            ? transcript.translations.map((t) => serializeTranslation(t, transcript.updatedAt))
            : [],
          transcribable: isTranscribableAsset(asset.mediaType),
        },
      })
    },
  )

  // ── generate / regenerate ────────────────────────────────────────────────
  fastify.post(
    "/assets/:assetId/transcript",
    { preHandler: guard },
    async (request, reply) => {
      const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
      const body = z
        .object({ profileId: z.string().optional(), force: z.boolean().optional() })
        .safeParse(request.body ?? {})
      const profileId = body.success ? body.data.profileId : undefined

      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      if (!isTranscribableAsset(asset.mediaType)) {
        reply.status(400).send({
          error: {
            code: "UNSUPPORTED_MEDIA",
            message: "Transcripts are only available for video and audio files.",
          },
        })
        return
      }

      // Checked before any work is queued, so an unconfigured instance gets a
      // useful message instead of a job that fails a minute later.
      let config
      try {
        config = await resolveGeminiMediaConfig(fastify.prisma, profileId)
      } catch (error) {
        if (error instanceof GeminiNotConfiguredError) {
          reply.status(400).send({
            error: {
              code: "GEMINI_NOT_CONFIGURED",
              message: "Gemini isn't configured yet. Add a Gemini key under Models to generate transcripts.",
            },
          })
          return
        }
        throw error
      }

      const existing = await fastify.prisma.mediaTranscript.findUnique({ where: { assetId } })
      if (existing && (existing.status === "PENDING" || existing.status === "PROCESSING")) {
        // Already running. Return it rather than queueing a second upload of
        // the same media — the drawer is just re-asking.
        reply.send({ data: { transcript: serializeTranscript(existing) } })
        return
      }

      const jobRecord = await fastify.prisma.job.create({
        data: {
          type: JOB_TYPES.transcribeMedia,
          status: "QUEUED",
          progress: 0,
          payload: { assetId, filename: asset.originalFilename },
        },
      })

      /**
       * The row is created before the job is queued.
       *
       * That ordering is what lets the drawer show "Generating transcript…"
       * immediately, and — more importantly — what lets it show that again
       * after a refresh. State that only exists inside a running request cannot
       * survive the page being closed.
       *
       * Previous text is kept until the new run succeeds, so a failed
       * regeneration does not cost the reader the transcript they already had.
       */
      const transcript = await fastify.prisma.mediaTranscript.upsert({
        where: { assetId },
        create: {
          assetId,
          status: "PENDING",
          provider: "gemini",
          model: config.model,
          jobId: jobRecord.id,
        },
        update: {
          status: "PENDING",
          provider: "gemini",
          model: config.model,
          jobId: jobRecord.id,
          error: null,
        },
      })

      await mediaQueue.add(JOB_TYPES.transcribeMedia, {
        assetId,
        transcriptId: transcript.id,
        userId: request.auth!.user.id,
        ...(profileId ? { profileId } : {}),
        jobRecordId: jobRecord.id,
      })

      await recordAndBroadcastActivity(fastify, {
        userId: request.auth!.user.id,
        type: "transcript.requested",
        title: "Transcript requested",
        message: `Generating a transcript for ${asset.originalFilename}.`,
        entityType: "asset",
        entityId: assetId,
        metadata: { transcriptId: transcript.id, jobId: jobRecord.id },
      })

      reply.status(202).send({ data: { transcript: serializeTranscript(transcript) } })
    },
  )

  // ── manual correction ────────────────────────────────────────────────────
  /**
   * Translate the saved transcript into one language.
   *
   * Text in, text out. The media is never opened: the segments already exist,
   * so re-reading the video would cost a second upload to re-derive words the
   * instance is already holding.
   *
   * Synchronous rather than queued, unlike transcription — this is a few
   * kilobytes of text and returns in seconds, and a job would add a polling
   * surface for no benefit.
   */
  fastify.post(
    "/assets/:assetId/transcript/translations",
    { preHandler: guard },
    async (request, reply) => {
      const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
      const parsed = z
        .object({
          language: z.string().min(2).max(16),
          profileId: z.string().optional(),
        })
        .safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Pick a language to translate into." },
        })
        return
      }

      // Ownership is re-checked here, not inherited from the transcript: an
      // asset id is guessable and this endpoint spends money.
      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      const transcript = await fastify.prisma.mediaTranscript.findUnique({ where: { assetId } })
      if (!transcript || transcript.status !== "READY") {
        reply.status(409).send({
          error: {
            code: "NO_TRANSCRIPT",
            message: "Generate a transcript before translating it.",
          },
        })
        return
      }

      const segments = normalizeTranscriptSegments(transcript.segments)
      if (segments.length === 0) {
        reply.status(409).send({
          error: { code: "EMPTY_TRANSCRIPT", message: "This transcript has no speech to translate." },
        })
        return
      }

      const target = parsed.data.language.trim()
      // Translating English into English is a paid request for nothing.
      if (isSameLanguage(target, transcript.language)) {
        reply.status(400).send({
          error: {
            code: "SAME_LANGUAGE",
            message: "That is already the transcript's language.",
          },
        })
        return
      }

      let config
      try {
        config = await resolveGeminiMediaConfig(fastify.prisma, parsed.data.profileId)
      } catch (error) {
        if (error instanceof GeminiNotConfiguredError) {
          reply.status(409).send({
            error: {
              code: "GEMINI_NOT_CONFIGURED",
              message: "Add a Gemini model profile under Models to translate.",
            },
          })
          return
        }
        throw error
      }

      try {
        const result = await translateTranscript({
          config,
          segments,
          targetLanguageName: languageName(target) || target,
          sourceLanguageName: transcript.language ? languageName(transcript.language) : null,
        })

        const data = {
          status: "READY" as const,
          provider: "gemini",
          model: result.model,
          fullText: result.fullText,
          segments: result.segments as unknown as object,
          error: null,
          sourceUpdatedAt: transcript.updatedAt,
          generatedAt: new Date(),
        }

        const row = await fastify.prisma.mediaTranslation.upsert({
          where: { transcriptId_language: { transcriptId: transcript.id, language: target } },
          create: { transcriptId: transcript.id, language: target, ...data },
          // Regenerating replaces in place rather than accumulating rows.
          update: data,
        })

        reply.send({ data: { translation: serializeTranslation(row, transcript.updatedAt) } })
      } catch (error) {
        reply.status(502).send({
          error: {
            code: "TRANSLATION_FAILED",
            message:
              error instanceof Error ? error.message : "The model did not return a translation.",
          },
        })
      }
    },
  )

  /**
   * Title suggestions from what the video actually says.
   *
   * Reads the saved original transcript — never a translation, and never the
   * media. Returns choices; renaming is a separate, explicit act.
   */
  fastify.post(
    "/assets/:assetId/title-suggestions",
    { preHandler: guard },
    async (request, reply) => {
      const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
      const body = z
        .object({ profileId: z.string().optional(), count: z.number().int().min(1).max(6).optional() })
        .safeParse(request.body ?? {})

      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      const transcript = await fastify.prisma.mediaTranscript.findUnique({ where: { assetId } })
      const text = transcript?.fullText?.trim()
      if (!transcript || transcript.status !== "READY" || !text) {
        reply.status(409).send({
          error: {
            code: "NO_TRANSCRIPT",
            message: "Generate a transcript first to create an AI title.",
          },
        })
        return
      }

      let config
      try {
        config = await resolveGeminiMediaConfig(
          fastify.prisma,
          body.success ? body.data.profileId : undefined,
        )
      } catch (error) {
        if (error instanceof GeminiNotConfiguredError) {
          reply.status(409).send({
            error: {
              code: "GEMINI_NOT_CONFIGURED",
              message: "Add a Gemini model profile under Models to suggest titles.",
            },
          })
          return
        }
        throw error
      }

      try {
        const result = await suggestTitles({
          config,
          transcriptText: text,
          count: body.success ? body.data.count : undefined,
        })
        reply.send({ data: { titles: result.titles, model: result.model } })
      } catch (error) {
        reply.status(502).send({
          error: {
            code: "TITLE_FAILED",
            message: error instanceof Error ? error.message : "The model did not return titles.",
          },
        })
      }
    },
  )

  /** Every dub for this asset, and whether dubbing can run at all here. */
  fastify.get("/assets/:assetId/dubs", { preHandler: guard }, async (request, reply) => {
    const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
    const asset = await loadAccessibleAsset(request, reply, assetId)
    if (!asset) return

    const transcript = await fastify.prisma.mediaTranscript.findUnique({
      where: { assetId },
      include: { translations: true },
    })
    const dubs = await fastify.prisma.mediaDub.findMany({
      where: { assetId },
      orderBy: { language: "asc" },
    })

    const separation = new AudioSeparationService([new AudioSeparatorBackend()])

    const dubbingSettings = await loadDubbingSettings(fastify.prisma)
    const localAvailable = await separation.isAvailable()
    const runpodStatus = await getRunPodStatus(fastify.prisma)
    const backends = describeBackends({
      settings: dubbingSettings,
      localAvailable,
      runpod: { configured: runpodStatus.configured, healthy: runpodStatus.lastTest?.ok ?? null },
    })

    reply.send({
      data: {
        dubs: dubs.map((dub) => {
          const translation = transcript?.translations.find((t) => t.language === dub.language)
          return serializeDub(
            dub,
            translation?.updatedAt ?? dub.updatedAt,
            transcript?.updatedAt ?? dub.updatedAt,
          )
        }),
        /**
         * Whether the reader can be offered a dub at all.
         *
         * Checked before the button exists rather than after the job fails:
         * separation is a precondition, and discovering it is missing halfway
         * through means the reader waited for nothing.
         */
        separatorAvailable: localAvailable,
        /**
         * Where separation can run, and what this instance defaults to.
         *
         * Sent with the listing so the panel never has to ask separately, and
         * so "is Cloud actually usable" is answered in exactly one place.
         */
        processing: {
          mode: dubbingSettings.separationMode,
          local: backends.local,
          cloud: backends.cloud,
        },
        dubbableLanguages: (transcript?.translations ?? [])
          .map((t) => t.language)
          .filter(isDubbableLanguage),
      },
    })
  })

  /**
   * What a caller may say about how a speaker should sound.
   *
   * Enumerated rather than passed through, because every one of these fields
   * ends up inside a model prompt. An open record would let a caller put
   * arbitrary text into the instructions given to the voice model; naming the
   * fields and their allowed values means the only free text that gets through
   * is the three fields that are meant to be free text, and those are length-
   * capped here and stripped of the speech markers downstream.
   */
  const voiceOverrideSchema = z.object({
    speakerId: z.string().min(1).max(120),
    presentation: z.enum(["masculine", "feminine", "neutral", "auto"]).optional(),
    ageStyle: z.enum(["youthful", "young-adult", "adult", "mature", "auto"]).optional(),
    pitch: z.enum(["low", "medium", "high"]).optional(),
    energy: z.enum(["low", "medium", "high"]).optional(),
    pace: z.enum(["slow", "medium", "fast"]).optional(),
    texture: z
      .enum(["soft", "clear", "warm", "breathy", "gravelly", "bright", "firm", "smooth"])
      .optional(),
    // Must be a voice the provider actually has, or synthesis fails at the
    // provider with a message no reader could act on.
    selectedGeminiVoice: z
      .enum(GEMINI_VOICES.map((v) => v.name) as [string, ...string[]])
      .optional(),
    accent: z
      .union([
        z.object({ kind: z.enum(["preserve-source", "neutral-target"]) }),
        z.object({ kind: z.literal("custom"), description: z.string().max(200) }),
      ])
      .optional(),
    emotion: z
      .union([
        z.object({ kind: z.enum(["match-original", "neutral"]) }),
        z.object({ kind: z.literal("preset"), preset: z.string().max(60) }),
        z.object({ kind: z.literal("custom"), description: z.string().max(200) }),
      ])
      .optional(),
    directorNotes: z.string().max(400).optional(),
  })

  /**
   * Generate or regenerate a dub for one translated language.
   *
   * Creates the row, then queues the work — that ordering is what lets a panel
   * closed mid-run reopen onto the current stage instead of an empty state.
   */
  fastify.post("/assets/:assetId/dubs", { preHandler: guard }, async (request, reply) => {
    const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
    const parsed = z
      .object({
        language: z.string().min(2).max(16),
        profileId: z.string().optional(),
        /** Per-speaker overrides. Anything omitted is matched automatically. */
        voiceProfiles: z.array(voiceOverrideSchema).max(24).optional(),
        /**
         * Where to run the separation for this job.
         *
         * Optional: omitted means "use the instance default". Supplying it both
         * overrides this job and becomes the new default, because a reader who
         * changes it here has expressed a preference and should not have to
         * express it again next time.
         */
        separationMode: z.enum(["auto", "local", "cloud"]).optional(),
      })
      .safeParse(request.body)

    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Pick a language to dub." },
      })
      return
    }

    // Ownership re-checked here: this endpoint spends money and reads speech.
    const asset = await loadAccessibleAsset(request, reply, assetId)
    if (!asset) return

    const language = parsed.data.language.trim()
    if (!isDubbableLanguage(language)) {
      reply.status(409).send({
        error: {
          code: "LANGUAGE_NOT_DUBBABLE",
          message: "Audio dubbing is not currently supported for this language.",
        },
      })
      return
    }

    const transcript = await fastify.prisma.mediaTranscript.findUnique({
      where: { assetId },
      include: { translations: { where: { language } } },
    })
    const translation = transcript?.translations[0]
    if (!transcript || !translation || translation.status !== "READY") {
      reply.status(409).send({
        error: { code: "NO_TRANSLATION", message: "Translate this video before dubbing it." },
      })
      return
    }

    /**
     * Which backend this job will use, decided before anything is queued.
     *
     * An explicit choice is never quietly substituted. Someone who picks Cloud
     * because their machine is slow must not discover ninety minutes later that
     * it ran locally anyway, and someone who picks Local has usually made a
     * decision about where their audio may go. So an unavailable explicit
     * choice is refused here, with the reason, rather than fallen back from.
     */
    const separation = new AudioSeparationService([new AudioSeparatorBackend()])
    const settings = parsed.data.separationMode
      ? await saveSeparationMode(fastify.prisma, parsed.data.separationMode)
      : await loadDubbingSettings(fastify.prisma)
    const runpod = await getRunPodStatus(fastify.prisma)
    const backends = describeBackends({
      settings,
      localAvailable: await separation.isAvailable(),
      runpod: { configured: runpod.configured, healthy: runpod.lastTest?.ok ?? null },
    })

    let decision
    try {
      decision = resolveSeparationBackend({
        mode: parsed.data.separationMode ?? settings.separationMode,
        local: backends.local,
        cloud: backends.cloud,
      })
    } catch (error) {
      if (error instanceof SeparationModeUnavailableError) {
        reply.status(409).send({
          error: { code: "SEPARATOR_UNAVAILABLE", message: error.message },
        })
        return
      }
      throw error
    }

    try {
      await resolveGeminiMediaConfig(fastify.prisma, parsed.data.profileId)
    } catch (error) {
      if (error instanceof GeminiNotConfiguredError) {
        reply.status(409).send({
          error: {
            code: "GEMINI_NOT_CONFIGURED",
            message: "Add a Gemini model profile under Models to generate a dub.",
          },
        })
        return
      }
      throw error
    }

    /**
     * One profile per speaker the transcript actually names.
     *
     * Built from whatever the caller overrode, defaulted otherwise — a reader
     * who cares about one field should not have to supply the rest.
     */
    const speakers = [
      ...new Set(
        normalizeTranscriptSegments(translation.segments)
          .map((s) => s.speaker)
          .filter((s): s is string => Boolean(s)),
      ),
    ]
    const speakerIds = speakers.length > 0 ? speakers : ["Speaker 1"]
    const overrides = (parsed.data.voiceProfiles ?? []) as Partial<VoiceProfile>[]

    const profiles = speakerIds.map((speakerId) =>
      buildVoiceProfile(
        { speakerId },
        (overrides.find((o) => o.speakerId === speakerId) ?? {}) as Partial<VoiceProfile>,
      ),
    )

    const jobRecord = await fastify.prisma.job.create({
      data: {
        type: JOB_TYPES.dubMedia,
        status: "QUEUED",
        progress: 0,
        payload: { assetId, language, filename: asset.originalFilename },
      },
    })

    const dubData = {
      transcriptId: transcript.id,
      translationId: translation.id,
      status: "PENDING" as const,
      stage: "Queued",
      error: null,
      provider: "gemini",
      model: DUB_TTS_MODEL,
      voiceProfiles: profiles as unknown as object,
      settingsFingerprint: voiceSettingsFingerprint(profiles),
      // Recorded with the result: a dub is a claim about where audio went, and
      // settings may change before anyone reads it.
      separationMode: decision.mode,
      separationBackend: decision.kind,
      jobId: jobRecord.id,
    }

    const dub = await fastify.prisma.mediaDub.upsert({
      where: { assetId_language: { assetId, language } },
      create: { assetId, language, ...dubData },
      // Regenerating replaces in place; the previous audio stays reachable
      // until the new run overwrites it.
      update: dubData,
    })

    await mediaQueue.add(JOB_TYPES.dubMedia, {
      assetId,
      dubId: dub.id,
      translationId: translation.id,
      userId: request.auth!.user.id,
      ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
      jobRecordId: jobRecord.id,
    })

    reply.status(202).send({
      data: { dub: serializeDub(dub, translation.updatedAt, transcript.updatedAt) },
    })
  })

  /**
   * Stream a finished dub.
   *
   * By asset and language rather than by storage-object id: an opaque object id
   * in a URL is a second, weaker way to reach a file, and this one has to pass
   * the same ownership check everything else does.
   *
   * Ranges are honoured because the player seeks — without them, moving the
   * playhead in a dubbed track would re-download from the start.
   */
  fastify.get(
    "/assets/:assetId/dubs/:language/audio",
    { preHandler: guard },
    async (request, reply) => {
      const { assetId, language } = z
        .object({ assetId: z.string(), language: z.string() })
        .parse(request.params)

      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      const dub = await fastify.prisma.mediaDub.findUnique({
        where: { assetId_language: { assetId, language } },
      })
      if (!dub?.audioStorageObjectId) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "No dub for that language." } })
        return
      }

      const object = await fastify.prisma.storageObject.findUnique({
        where: { id: dub.audioStorageObjectId },
        include: { storageLocation: { select: { rootPath: true } } },
      })
      if (!object) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Dub audio is missing." } })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      let resolved: string | null = null
      for (const candidate of candidateStorageObjectPaths(
        instance?.storageRoot ?? null,
        object.physicalPath,
        object.objectKey,
        [object.storageLocation?.rootPath],
      )) {
        try {
          await access(candidate)
          resolved = candidate
          break
        } catch {
          continue
        }
      }
      if (!resolved) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Dub audio is missing on the server." },
        })
        return
      }

      reply.header("X-Content-Type-Options", "nosniff")
      return streamFileResponse(reply, {
        path: resolved,
        contentType: object.mimeType || "audio/mp4",
        contentDisposition: `inline; filename="${asset.originalFilename}.${language}.dub.m4a"`,
        rangeHeader: request.headers.range ?? null,
      })
    },
  )

  /**
   * The video, with the dubbed audio in place of the original.
   *
   * Built on request rather than stored. A dubbed copy of a 175 MB film is
   * another 175 MB per language, which on a self-hosted box is a real cost for
   * a file most people download once — and the video stream is copied, not
   * re-encoded, so producing it takes seconds rather than the hour the dub
   * itself took.
   *
   * The muxed file is written to temp, streamed, and removed. No range support:
   * this is a download, and honouring ranges would mean rebuilding the file for
   * every seek.
   */
  fastify.get(
    "/assets/:assetId/dubs/:language/video",
    { preHandler: guard },
    async (request, reply) => {
      const { assetId, language } = z
        .object({ assetId: z.string(), language: z.string() })
        .parse(request.params)

      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      const dub = await fastify.prisma.mediaDub.findUnique({
        where: { assetId_language: { assetId, language } },
      })
      if (!dub?.audioStorageObjectId) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "No dub for that language." } })
        return
      }

      const assetRow = await fastify.prisma.asset.findUnique({
        where: { id: assetId },
        select: { storageObjectId: true },
      })
      const audioPath = await resolveStoredPath(dub.audioStorageObjectId)
      const videoPath = assetRow ? await resolveStoredPath(assetRow.storageObjectId) : null
      if (!audioPath || !videoPath) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "The dub or the original is missing on the server." },
        })
        return
      }

      const outputPath = path.join(
        tmpdir(),
        `arciin-dub-${dub.id}-${randomUUID()}.mp4`,
      )

      try {
        await execFileAsync("ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          ...buildRemuxArgs({ videoPath, audioPath, outputPath }),
        ], { timeout: 15 * 60 * 1000 })
      } catch {
        await rm(outputPath, { force: true }).catch(() => {})
        reply.status(500).send({
          error: {
            code: "REMUX_FAILED",
            message: "The dubbed video could not be assembled.",
          },
        })
        return
      }

      reply.header("X-Content-Type-Options", "nosniff")
      // Removed once the response is done, however it ends.
      reply.raw.on("close", () => {
        void rm(outputPath, { force: true }).catch(() => {})
      })

      return streamFileResponse(reply, {
        path: outputPath,
        contentType: "video/mp4",
        contentDisposition: `attachment; filename="${asset.originalFilename}.${language}.dub.mp4"`,
        rangeHeader: null,
      })
    },
  )

  fastify.patch(
    "/assets/:assetId/transcript",
    { preHandler: guard },
    async (request, reply) => {
      const { assetId } = z.object({ assetId: z.string() }).parse(request.params)
      const parsed = z
        .object({
          segments: z
            .array(
              z.object({
                startMs: z.number().int().min(0),
                endMs: z.number().int().min(0).optional(),
                speaker: z.string().max(120).optional(),
                text: z.string(),
              }),
            )
            .max(20_000)
            .optional(),
          fullText: z.string().max(2_000_000).optional(),
        })
        .safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Invalid transcript payload." },
        })
        return
      }

      const asset = await loadAccessibleAsset(request, reply, assetId)
      if (!asset) return

      const existing = await fastify.prisma.mediaTranscript.findUnique({ where: { assetId } })
      if (!existing) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "There is no transcript to edit yet." },
        })
        return
      }

      const segments = parsed.data.segments
        ? normalizeTranscriptSegments(parsed.data.segments)
        : normalizeTranscriptSegments(existing.segments)

      const updated = await fastify.prisma.mediaTranscript.update({
        where: { assetId },
        data: {
          segments: segments as never,
          fullText: parsed.data.fullText ?? existing.fullText,
          // Marked so a later Regenerate can warn before discarding this work.
          edited: true,
        },
      })

      reply.send({ data: { transcript: serializeTranscript(updated) } })
    },
  )
}
