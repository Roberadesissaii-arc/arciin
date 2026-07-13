import path from "node:path"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { JOB_TYPES, assetSupportsDocumentThumbnail } from "@arciin/shared"

import { buildRealtimeEvent } from "@/services/events/publish-event"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { mediaQueue } from "@/services/jobs/queues"
import { enqueueGenerateThumbnailJob } from "@/services/media/thumbnail-jobs"
import { loadUserPreferences } from "@/services/user/preferences"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { serializeUpload } from "@/services/serializers"
import { analyzeStoredFile } from "@/services/classification/media-classification"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import { syncAssetToJellyfinMirror, assetIsInJellyfinFolder } from "@/services/integrations/jellyfin"
import {
  assetIsInPlexFolder,
  resolveUploadFolderId,
  syncAssetToPlexMirror,
} from "@/services/integrations/plex"
import { getUploadLimits, UploadTooLargeError } from "@/services/config/upload-limits"
import { appendUploadLog } from "@/services/logs/upload-log"
import { resolveEffectiveStorageRoot } from "@/services/storage/effective-storage-root"
import { resolveClientChannel } from "@/services/security/client-channel"
import {
  createObjectStoragePath,
  moveTempToObject,
  removeTempFile,
  writeMultipartToTemp,
} from "@/services/storage/local-storage"

function libraryKindForMediaType(mediaType: string) {
  switch (mediaType) {
    case "VIDEO":
      return "VIDEO"
    case "IMAGE":
      return "IMAGE"
    case "AUDIO":
      return "AUDIO"
    case "DOCUMENT":
      return "DOCUMENT"
    case "APPLICATION":
      return "INBOX"
    case "CODE":
      return "INBOX"
    default:
      return "INBOX"
  }
}

async function resolveUploadTargetLibrary(
  prisma: FastifyInstance["prisma"],
  mediaType: string,
  targetLibraryId?: string,
) {
  if (targetLibraryId) {
    return prisma.library.findUnique({ where: { id: targetLibraryId } })
  }

  return (
    (await prisma.library.findFirst({
      where: { kind: libraryKindForMediaType(mediaType) },
    })) ??
    (await prisma.library.findFirst({
      where: { kind: "INBOX" },
    }))
  )
}

export async function registerUploadRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/uploads",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["uploads:create"],
      ),
    },
    async (request, reply) => {
      const file = await request.file()

      if (!file || !request.auth) {
        reply.status(400).send({
          error: {
            code: "UPLOAD_REQUIRED",
            message: "A file upload is required.",
          },
        })
        return
      }

      const clientChannel = resolveClientChannel(request)

      const { uploadRateLimitPerMinute } = getUploadLimits()
      if (
        await checkEndpointRateLimit(request, reply, {
          key: `upload:user:${request.auth.user.id}`,
          limit: uploadRateLimitPerMinute,
          windowSec: 60,
          perIp: false,
        })
      ) {
        return
      }

      const queryParsed = z
        .object({
          // Prisma uses cuid() for Library/Folder ids — not UUIDs.
          targetLibraryId: z.string().cuid().optional(),
          targetFolderId: z.string().cuid().optional(),
        })
        .safeParse(request.query ?? {})

      if (!queryParsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid upload query parameters.",
            details: queryParsed.error.flatten(),
          },
        })
        return
      }

      const { targetLibraryId, targetFolderId } = queryParsed.data

      let tempPath: string | null = null

      try {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const storageRoot = resolveEffectiveStorageRoot(instance?.storageRoot)
      const tempResult = await writeMultipartToTemp(file, storageRoot)
      tempPath = tempResult.tempPath

      const analysis = await analyzeStoredFile(
        tempResult.tempPath,
        file.filename,
        file.mimetype
      )

      const targetLibrary = await resolveUploadTargetLibrary(
        fastify.prisma,
        analysis.mediaType,
        targetLibraryId,
      )

      if (!targetLibrary) {
        await removeTempFile(tempResult.tempPath)
        reply.status(409).send({
          error: {
            code: "LIBRARY_NOT_CONFIGURED",
            message: "No destination library is configured for uploads.",
          },
        })
        return
      }

      const existingStorageObject = await fastify.prisma.storageObject.findFirst({
        where: {
          checksumSha256: tempResult.checksumSha256,
          storageLocationId: targetLibrary.storageLocationId,
        },
      })

      let storageObject = existingStorageObject

      if (!storageObject) {
        const objectPath = createObjectStoragePath(
          tempResult.checksumSha256,
          analysis.extension || path.extname(file.filename),
          storageRoot
        )

        await moveTempToObject(tempResult.tempPath, objectPath.physicalPath)

        storageObject = await fastify.prisma.storageObject.create({
          data: {
            storageLocationId: targetLibrary.storageLocationId,
            objectKey: objectPath.objectKey,
            physicalPath: objectPath.physicalPath,
            sizeBytes: BigInt(tempResult.sizeBytes),
            checksumSha256: tempResult.checksumSha256,
            mimeType: analysis.mimeType,
          },
        })
      } else {
        await removeTempFile(tempResult.tempPath)
      }

      const resolvedFolderId = await resolveUploadFolderId(
        fastify.prisma,
        targetLibrary.id,
        targetLibrary.slug,
        targetFolderId,
      )

      const requiresProcessing = analysis.mediaType === "VIDEO" || analysis.mediaType === "IMAGE" || analysis.mediaType === "AUDIO"

      const asset = await fastify.prisma.asset.create({
        data: {
          libraryId: targetLibrary.id,
          folderId: resolvedFolderId ?? null,
          storageObjectId: storageObject.id,
          ownerId: request.auth.user.id,
          filename: `${tempResult.checksumSha256}.${analysis.extension || "bin"}`,
          originalFilename: file.filename,
          mimeType: analysis.mimeType,
          mediaType: analysis.mediaType,
          extension: analysis.extension || "bin",
          sizeBytes: BigInt(tempResult.sizeBytes),
          checksumSha256: tempResult.checksumSha256,
          durationSeconds: analysis.durationSeconds,
          width: analysis.width,
          height: analysis.height,
          codec: analysis.codec,
          status: requiresProcessing ? "PROCESSING" : "READY",
          uploadClient: clientChannel,
        },
      })

      const upload = await fastify.prisma.uploadSession.create({
        data: {
          userId: request.auth.user.id,
          originalFilename: file.filename,
          mimeType: analysis.mimeType,
          sizeBytes: BigInt(tempResult.sizeBytes),
          status: requiresProcessing ? "PROCESSING" : "READY",
          progress: 100,
          targetLibraryId: targetLibrary.id,
          detectedMediaType: analysis.mediaType,
          assetId: asset.id,
          completedAt: new Date(),
        },
        include: {
          targetLibrary: true,
        },
      })

      if (requiresProcessing) {
        const extractMetadataJob = await fastify.prisma.job.create({
          data: {
            type: JOB_TYPES.extractMetadata,
            status: "QUEUED",
            progress: 0,
            payload: {
              assetId: asset.id,
              uploadId: upload.id,
              userId: request.auth.user.id,
            },
          },
        })

        await mediaQueue.add(JOB_TYPES.extractMetadata, {
          assetId: asset.id,
          uploadId: upload.id,
          userId: request.auth.user.id,
          jobRecordId: extractMetadataJob.id,
        })

        if (analysis.mediaType === "VIDEO" || analysis.mediaType === "IMAGE") {
          await enqueueGenerateThumbnailJob(fastify.prisma, mediaQueue, {
            assetId: asset.id,
            uploadId: upload.id,
            userId: request.auth.user.id,
          })
        }
      }

      if (!requiresProcessing) {
        const prefs = await loadUserPreferences(
          fastify.prisma,
          request.auth.user.id,
        )
        if (
          prefs.media.documentThumbnails &&
          assetSupportsDocumentThumbnail(
            analysis.mediaType,
            analysis.mimeType,
            analysis.extension,
            file.filename,
          )
        ) {
          await enqueueGenerateThumbnailJob(fastify.prisma, mediaQueue, {
            assetId: asset.id,
            uploadId: upload.id,
            userId: request.auth.user.id,
          })
        }
      }

      try {
        const folderForMirror = resolvedFolderId
          ? await fastify.prisma.folder.findUnique({ where: { id: resolvedFolderId } })
          : null
        const deferMirrorUntilReady = analysis.mediaType === "VIDEO"
        if (!deferMirrorUntilReady && folderForMirror && assetIsInPlexFolder(folderForMirror)) {
          await syncAssetToPlexMirror(fastify.prisma, asset.id)
        } else if (
          !deferMirrorUntilReady &&
          folderForMirror &&
          assetIsInJellyfinFolder(folderForMirror)
        ) {
          await syncAssetToJellyfinMirror(fastify.prisma, asset.id)
        }
      } catch (mirrorErr) {
        request.log.warn(
          { err: mirrorErr, assetId: asset.id, fileName: file.filename },
          "connector mirror failed after upload",
        )
      }

      await recordAndBroadcastActivity(fastify, {
        userId: request.auth.user.id,
        type: "upload.completed",
        title: "Upload stored",
        message: `${file.filename} routed to ${targetLibrary.name}.`,
        entityType: "asset",
        entityId: asset.id,
        metadata: {
          mediaType: analysis.mediaType,
          libraryId: targetLibrary.id,
          destination: targetLibrary.name,
          fileName: file.filename,
          client: clientChannel,
        },
      })

      await fastify.publishRealtimeEvent(
        buildRealtimeEvent("upload.started", {
          userId: request.auth.user.id,
          libraryId: targetLibrary.id,
          uploadId: upload.id,
          progress: requiresProcessing ? 88 : 100,
          message: `${file.filename} received on the server.`,
          data: {
            fileName: file.filename,
            sizeBytes: tempResult.sizeBytes,
            destination: targetLibrary.name,
            origin: "upload",
            client: clientChannel,
          },
        })
      )

      // Always emit asset.created so library grids can refresh immediately.
      await fastify.publishRealtimeEvent(
        buildRealtimeEvent("asset.created", {
          userId: request.auth.user.id,
          libraryId: targetLibrary.id,
          assetId: asset.id,
          message: `${file.filename} added to ${targetLibrary.name}.`,
          data: {
            mediaType: analysis.mediaType,
            destination: targetLibrary.name,
            fileName: file.filename,
            client: clientChannel,
          },
        })
      )

      await fastify.publishRealtimeEvent(
        buildRealtimeEvent("upload.completed", {
          userId: request.auth.user.id,
          libraryId: targetLibrary.id,
          uploadId: upload.id,
          assetId: asset.id,
          progress: requiresProcessing ? 88 : 100,
          message: requiresProcessing
            ? `${file.filename} uploaded — finishing media processing…`
            : `${file.filename} uploaded successfully.`,
          data: {
            fileName: file.filename,
            sizeBytes: tempResult.sizeBytes,
            destination: targetLibrary.name,
            origin: "upload",
            client: clientChannel,
          },
        })
      )

      reply.status(201).send({
        data: serializeUpload(upload),
      })
      } catch (err) {
        if (tempPath) {
          await removeTempFile(tempPath).catch(() => {})
        }

        const message =
          err instanceof Error ? err.message : "Upload failed due to an unexpected error."
        const code =
          err && typeof err === "object" && "code" in err && typeof err.code === "string"
            ? err.code
            : "UPLOAD_FAILED"

        await appendUploadLog({
          level: "error",
          fileName: file.filename,
          message,
          code,
          userId: request.auth.user.id,
          libraryId: targetLibraryId,
          folderId: targetFolderId,
          details:
            err instanceof Error
              ? { name: err.name, stack: err.stack?.split("\n").slice(0, 8) }
              : err,
        })

        request.log.error({ err, fileName: file.filename }, "upload failed")

        const status = err instanceof UploadTooLargeError ? 413 : 500
        reply.status(status).send({
          error: {
            code,
            message,
          },
        })
      }
    }
  )

  fastify.get(
    "/uploads",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read", "activity:read", "uploads:create"],
      ),
    },
    async (_request, reply) => {
      const uploads = await fastify.prisma.uploadSession.findMany({
        include: {
          targetLibrary: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
      })

      reply.send({
        data: uploads.map(serializeUpload),
      })
    }
  )

  fastify.get(
    "/uploads/:uploadId",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read", "activity:read", "uploads:create"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ uploadId: z.string() }).parse(request.params)
      const upload = await fastify.prisma.uploadSession.findUnique({
        where: {
          id: params.uploadId,
        },
        include: {
          targetLibrary: true,
        },
      })

      if (!upload) {
        reply.status(404).send({
          error: {
            code: "UPLOAD_NOT_FOUND",
            message: "Upload session not found.",
          },
        })
        return
      }

      reply.send({
        data: serializeUpload(upload),
      })
    }
  )

  fastify.post(
    "/uploads/:uploadId/complete",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["uploads:create"],
      ),
    },
    async (request, reply) => {
      if (!request.auth) return
      const params = z.object({ uploadId: z.string() }).parse(request.params)
      const upload = await fastify.prisma.uploadSession.findUnique({
        where: {
          id: params.uploadId,
        },
        include: {
          targetLibrary: true,
        },
      })

      if (!upload) {
        reply.status(404).send({
          error: {
            code: "UPLOAD_NOT_FOUND",
            message: "Upload session not found.",
          },
        })
        return
      }

      // Only the uploader, admins, or owners may act on a session.
      const role = request.auth.user.role
      if (upload.userId !== request.auth.user.id && role !== "OWNER" && role !== "ADMIN") {
        reply.status(403).send({
          error: { code: "FORBIDDEN", message: "You do not have access to this upload." },
        })
        return
      }

      reply.send({
        data: serializeUpload(upload),
      })
    }
  )

  fastify.post(
    "/uploads/:uploadId/cancel",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["uploads:create"],
      ),
    },
    async (request, reply) => {
      if (!request.auth) return
      const params = z.object({ uploadId: z.string() }).parse(request.params)

      const upload = await fastify.prisma.uploadSession.findUnique({
        where: { id: params.uploadId },
      })

      if (!upload) {
        reply.status(404).send({
          error: { code: "UPLOAD_NOT_FOUND", message: "Upload session not found." },
        })
        return
      }

      // Only the uploader, admins, or owners may cancel a session.
      const role = request.auth.user.role
      if (upload.userId !== request.auth.user.id && role !== "OWNER" && role !== "ADMIN") {
        reply.status(403).send({
          error: { code: "FORBIDDEN", message: "You do not have access to this upload." },
        })
        return
      }

      await fastify.prisma.uploadSession.update({
        where: {
          id: params.uploadId,
        },
        data: {
          status: "FAILED",
          error: "Cancelled by user.",
        },
      })

      const activeKey = `import:active:${upload.userId}`
      const remaining = await fastify.redis.decr(activeKey).catch(() => 0)
      if (remaining < 0) {
        await fastify.redis.set(activeKey, "0").catch(() => {})
      }

      await fastify.publishRealtimeEvent(
        buildRealtimeEvent("upload.failed", {
          userId: upload.userId,
          uploadId: upload.id,
          message: "Cancelled by user.",
          data: {
            fileName: upload.originalFilename,
            origin: "upload",
          },
        }),
      )

      reply.send({
        data: {
          success: true,
        },
      })
    }
  )
}
