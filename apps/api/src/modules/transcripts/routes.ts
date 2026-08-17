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
import { assertAssetFolderAccess } from "@/services/folders/folder-lock"
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
  type VoiceProfile,
} from "@arciin/media-ai"
import { requireRole } from "@/services/security/auth"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"

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
        separatorAvailable: await separation.isAvailable(),
        dubbableLanguages: (transcript?.translations ?? [])
          .map((t) => t.language)
          .filter(isDubbableLanguage),
      },
    })
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
        voiceProfiles: z.array(z.record(z.string(), z.unknown())).max(24).optional(),
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

    const separation = new AudioSeparationService([new AudioSeparatorBackend()])
    if (!(await separation.isAvailable())) {
      reply.status(409).send({
        error: {
          code: "SEPARATOR_UNAVAILABLE",
          message:
            "Dubbing needs an audio separator so the original music and ambience can be kept. See docs/DUBBING.md.",
        },
      })
      return
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
