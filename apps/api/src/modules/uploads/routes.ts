import path from "node:path"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { JOB_TYPES } from "@arciin/shared"

import { buildRealtimeEvent } from "@/services/events/publish-event"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { mediaQueue } from "@/services/jobs/queues"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { serializeUpload } from "@/services/serializers"
import { analyzeStoredFile } from "@/services/classification/media-classification"
import { resolveUploadFolderId, syncAssetToPlexMirror } from "@/services/integrations/plex"
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
    default:
      return "INBOX"
  }
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

      const queryParsed = z
        .object({
          targetLibraryId: z.string().uuid().optional(),
          targetFolderId: z.string().uuid().optional(),
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

      const instance = await fastify.prisma.instanceConfig.findFirst()
      const storageRoot = instance?.storageRoot
      const tempResult = await writeMultipartToTemp(file, storageRoot)

      const analysis = await analyzeStoredFile(
        tempResult.tempPath,
        file.filename,
        file.mimetype
      )

      // If caller specifies a library, use it — otherwise classify by media type
      const targetLibrary = (
        targetLibraryId
          ? await fastify.prisma.library.findUnique({ where: { id: targetLibraryId } })
          : null
      ) ?? await fastify.prisma.library.findFirst({
        where: { kind: libraryKindForMediaType(analysis.mediaType) },
      }) ?? await fastify.prisma.library.findFirst({
        where: { kind: "INBOX" },
      })

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
          completedAt: requiresProcessing ? null : new Date(),
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
          const thumbnailJob = await fastify.prisma.job.create({
            data: {
              type: JOB_TYPES.generateThumbnail,
              status: "QUEUED",
              progress: 0,
              payload: {
                assetId: asset.id,
                uploadId: upload.id,
                userId: request.auth.user.id,
              },
            },
          })

          await mediaQueue.add(JOB_TYPES.generateThumbnail, {
            assetId: asset.id,
            uploadId: upload.id,
            userId: request.auth.user.id,
            jobRecordId: thumbnailJob.id,
          })
        }
      }

      await syncAssetToPlexMirror(fastify.prisma, asset.id).catch(() => {})

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
        },
      })

      // Always emit asset.created so the Events monitor shows every upload
      await fastify.publishRealtimeEvent(
        buildRealtimeEvent("asset.created", {
          userId: request.auth.user.id,
          libraryId: targetLibrary.id,
          assetId: asset.id,
          message: `${file.filename} added to ${targetLibrary.name}.`,
          data: { mediaType: analysis.mediaType, destination: targetLibrary.name },
        })
      )

      if (!requiresProcessing) {
        await fastify.publishRealtimeEvent(
          buildRealtimeEvent("upload.completed", {
            userId: request.auth.user.id,
            libraryId: targetLibrary.id,
            uploadId: upload.id,
            assetId: asset.id,
            progress: 100,
            message: `${file.filename} uploaded successfully.`,
            data: {
              fileName: file.filename,
              sizeBytes: tempResult.sizeBytes,
              destination: targetLibrary.name,
            },
          })
        )
      }

      reply.status(201).send({
        data: serializeUpload(upload),
      })
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

      reply.send({
        data: {
          success: true,
        },
      })
    }
  )
}
