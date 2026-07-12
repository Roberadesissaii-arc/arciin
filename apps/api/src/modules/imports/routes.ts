import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { JOB_TYPES } from "@arciin/shared"

import { buildRealtimeEvent } from "@/services/events/publish-event"
import { mediaQueue } from "@/services/jobs/queues"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import { serializeUpload } from "@/services/serializers"
import { isImportablePublicUrl } from "@/services/imports/url-guard"

/** Max concurrent in-flight URL imports per user (released by the worker). */
const MAX_ACTIVE_IMPORTS_PER_USER = 3

const importSchema = z.object({
  url: z.string().trim().url(),
  targetLibraryId: z.string().cuid().optional(),
  targetFolderId: z.string().cuid().optional(),
  audioOnly: z.boolean().optional(),
  audioFormat: z.enum(["mp3", "m4a"]).optional(),
  videoFormat: z.enum(["mp4", "best"]).optional(),
})

/** Best-effort filename for the pending session before the download resolves. */
function pendingFilenameFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    const last = url.pathname.split("/").filter(Boolean).pop()
    if (last && last.length <= 120) return decodeURIComponent(last)
    return url.hostname
  } catch {
    return "Imported link"
  }
}

export async function registerImportRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/imports",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["uploads:create"],
      ),
    },
    async (request, reply) => {
      if (!request.auth) return

      if (
        await checkEndpointRateLimit(request, reply, {
          key: `import:user:${request.auth.user.id}`,
          limit: 60,
          windowSec: 60,
        })
      ) {
        return
      }

      const parsed = importSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Enter a valid http(s) link to import.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const { url, targetLibraryId, targetFolderId, audioOnly, audioFormat, videoFormat } =
        parsed.data

      if (!isImportablePublicUrl(url)) {
        reply.status(400).send({
          error: {
            code: "IMPORT_URL_BLOCKED",
            message: "Only public http(s) links can be imported.",
          },
        })
        return
      }

      // Cap concurrent in-flight imports per user — each can spawn a heavy
      // download/transcode. The worker releases the slot when the job settles.
      const activeKey = `import:active:${request.auth.user.id}`
      const active = await fastify.redis.incr(activeKey)
      if (active === 1) await fastify.redis.expire(activeKey, 900)
      if (active > MAX_ACTIVE_IMPORTS_PER_USER) {
        await fastify.redis.decr(activeKey)
        reply.status(429).send({
          error: {
            code: "TOO_MANY_ACTIVE_IMPORTS",
            message: `You already have ${MAX_ACTIVE_IMPORTS_PER_USER} imports in progress. Wait for one to finish.`,
          },
        })
        return
      }

      const upload = await fastify.prisma.uploadSession.create({
        data: {
          userId: request.auth.user.id,
          originalFilename: pendingFilenameFromUrl(url),
          mimeType: null,
          sizeBytes: 0,
          status: "QUEUED",
          progress: 0,
          targetLibraryId: targetLibraryId ?? null,
          targetFolderId: targetFolderId ?? null,
        },
        include: { targetLibrary: true },
      })

      const job = await fastify.prisma.job.create({
        data: {
          type: JOB_TYPES.importUrl,
          status: "QUEUED",
          progress: 0,
          payload: {
            url,
            uploadId: upload.id,
            userId: request.auth.user.id,
            targetLibraryId,
            targetFolderId,
            audioOnly,
            audioFormat,
            videoFormat,
          },
        },
      })

      await mediaQueue.add(JOB_TYPES.importUrl, {
        url,
        uploadId: upload.id,
        userId: request.auth.user.id,
        targetLibraryId,
        targetFolderId,
        audioOnly,
        audioFormat,
        videoFormat,
        jobRecordId: job.id,
      })

      await fastify.publishRealtimeEvent(
        buildRealtimeEvent("upload.started", {
          userId: request.auth.user.id,
          uploadId: upload.id,
          progress: 12,
          message: `Importing ${upload.originalFilename}…`,
          data: {
            source: "url",
            origin: "url",
            url,
            fileName: upload.originalFilename,
            destination: upload.targetLibrary?.name ?? "Inbox",
          },
        }),
      )

      reply.status(202).send({ data: serializeUpload(upload) })
    },
  )
}
