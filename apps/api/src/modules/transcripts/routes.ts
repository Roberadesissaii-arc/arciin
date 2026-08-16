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

import { assertAssetFolderAccess } from "@/services/folders/folder-lock"
import { mediaQueue } from "@/services/jobs/queues"
import {
  GeminiNotConfiguredError,
  resolveGeminiMediaConfig,
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
      })

      reply.send({
        data: {
          transcript: transcript ? serializeTranscript(transcript) : null,
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
