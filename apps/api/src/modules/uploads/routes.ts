import path from "node:path"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  JOB_TYPES,
  UPLOAD_ACCEPTED_PROGRESS,
  apiOwnsCompletionEvent,
  assetSupportsDocumentThumbnail,
  requiresWorkerProcessing,
} from "@arciin/shared"

import { commitUpload } from "@/services/uploads/commit-upload"
import { dispatchPendingForUpload } from "@/services/uploads/outbox-dispatch"

import { buildRealtimeEvent } from "@/services/events/publish-event"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { mediaQueue } from "@/services/jobs/queues"
import { loadUserPreferences } from "@/services/user/preferences"
import { folderAccessGranted } from "@/services/folders/folder-lock"
import {
  UPLOAD_READ_SCOPES,
  canMutateUploadSession,
  canReadUploadSession,
  uploadListWhere,
  type UploadPrincipal,
} from "@/services/uploads/upload-access"
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

/** Map the authenticated request onto the shared upload-access principal. */
function principalFromRequest(request: {
  auth?: { user: { id: string; role: string }; apiKeyScopes?: string[] | null; session?: unknown }
}): UploadPrincipal {
  const auth = request.auth!
  return {
    userId: auth.user.id,
    role: auth.user.role as UploadPrincipal["role"],
    // A browser session is governed by role alone; an API key is additionally
    // capped by its own scopes.
    apiKeyScopes: auth.session ? null : (auth.apiKeyScopes ?? []),
  }
}

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

      // Validate the destination folder before a single byte is committed to
      // permanent storage. An unchecked id previously produced either an
      // invisible asset (deleted / foreign folder) or an FK violation *after*
      // the object was already written.
      let targetFolder: Awaited<
        ReturnType<typeof fastify.prisma.folder.findFirst>
      > = null

      if (targetFolderId) {
        targetFolder = await fastify.prisma.folder.findFirst({
          where: { id: targetFolderId, deletedAt: null },
        })

        if (!targetFolder) {
          reply.status(404).send({
            error: {
              code: "FOLDER_NOT_FOUND",
              message: "The destination folder does not exist or has been deleted.",
            },
          })
          return
        }

        if (!folderAccessGranted(request, request.auth.user.id, targetFolder, request.auth.session ?? null)) {
          reply.status(403).send({
            error: {
              code: "FOLDER_LOCKED",
              message: "You do not have access to the destination folder.",
            },
          })
          return
        }
      }

      let tempPath: string | null = null

      try {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const storageRoot = resolveEffectiveStorageRoot(instance?.storageRoot)
      const tempResult = await writeMultipartToTemp(file, storageRoot)
      tempPath = tempResult.tempPath

      const analysis = await analyzeStoredFile(
        tempResult.tempPath,
        file.filename,
        file.mimetype,
        request.log,
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

      // The folder must belong to the library the asset is actually filed
      // under, or the asset becomes unreachable from both library views.
      if (targetFolder && targetFolder.libraryId !== targetLibrary.id) {
        await removeTempFile(tempResult.tempPath)
        reply.status(400).send({
          error: {
            code: "FOLDER_LIBRARY_MISMATCH",
            message:
              "The destination folder belongs to a different library than this upload's target library.",
          },
        })
        return
      }

      const existingStorageObject = await fastify.prisma.storageObject.findFirst({
        where: {
          checksumSha256: tempResult.checksumSha256,
          storageLocationId: targetLibrary.storageLocationId,
        },
        select: { id: true },
      })

      // The bytes are moved into place here, but the StorageObject *row* is
      // created inside the commit transaction below. Writing the row first was
      // how a failed asset insert left an object nothing referenced.
      let objectKey = ""
      let physicalPath = ""

      if (!existingStorageObject) {
        const objectPath = createObjectStoragePath(
          tempResult.checksumSha256,
          analysis.extension || path.extname(file.filename),
          storageRoot
        )

        await moveTempToObject(tempResult.tempPath, objectPath.physicalPath)
        tempPath = null
        objectKey = objectPath.objectKey
        physicalPath = objectPath.physicalPath
      } else {
        // Content-addressed: identical bytes are already stored under this
        // checksum. Only the redundant temp copy is removed — never the object,
        // which existing assets reference.
        await removeTempFile(tempResult.tempPath)
        tempPath = null
      }

      const resolvedFolderId = await resolveUploadFolderId(
        fastify.prisma,
        targetLibrary.id,
        targetLibrary.slug,
        targetFolderId,
      )

      if (clientChannel === "api" && resolvedFolderId) {
        await fastify.prisma.folder.updateMany({
          where: { id: resolvedFolderId, isRemote: false },
          data: { isRemote: true },
        })
      }

      const requiresProcessing = requiresWorkerProcessing(analysis.mediaType)

      // Document thumbnails are a user preference, so the decision is made here
      // and handed to the planner rather than discovered inside it.
      let wantsDocumentThumbnail = false
      if (!requiresProcessing) {
        const prefs = await loadUserPreferences(fastify.prisma, request.auth.user.id)
        wantsDocumentThumbnail =
          prefs.media.documentThumbnails &&
          assetSupportsDocumentThumbnail(
            analysis.mediaType,
            analysis.mimeType,
            analysis.extension,
            file.filename,
          )
      }

      // One transaction for the object reference, the asset, the session, the
      // Job rows and the outbox entries. Before this, a failure between any two
      // of those left an upload nobody could interpret — and a `queue.add` that
      // threw stranded the asset in PROCESSING forever, which is how 1,278
      // sessions were lost. The queue is now written to Postgres first and
      // handed to Redis afterwards, where failing is recoverable.
      const committed = await commitUpload(fastify.prisma, {
        storage: {
          existingStorageObjectId: existingStorageObject?.id ?? null,
          storageLocationId: targetLibrary.storageLocationId,
          objectKey,
          physicalPath,
          sizeBytes: tempResult.sizeBytes,
          checksumSha256: tempResult.checksumSha256,
          mimeType: analysis.mimeType,
        },
        asset: {
          libraryId: targetLibrary.id,
          folderId: resolvedFolderId ?? null,
          ownerId: request.auth.user.id,
          filename: `${tempResult.checksumSha256}.${analysis.extension || "bin"}`,
          originalFilename: file.filename,
          mimeType: analysis.mimeType,
          mediaType: analysis.mediaType,
          extension: analysis.extension || "bin",
          durationSeconds: analysis.durationSeconds,
          width: analysis.width,
          height: analysis.height,
          codec: analysis.codec,
          uploadClient: clientChannel,
        },
        uploadSession: {
          userId: request.auth.user.id,
          originalFilename: file.filename,
          targetLibraryId: targetLibrary.id,
          targetFolderId: resolvedFolderId ?? null,
        },
        jobNames: {
          extractMetadata: JOB_TYPES.extractMetadata,
          generateThumbnail: JOB_TYPES.generateThumbnail,
        },
        wantsDocumentThumbnail,
      })

      const asset = { id: committed.assetId }

      const upload = (await fastify.prisma.uploadSession.findUniqueOrThrow({
        where: { id: committed.uploadSessionId },
        include: { targetLibrary: true },
      }))!

      // Best-effort: the jobs are already durable, so a Redis failure here only
      // delays processing until the reconciler runs.
      await dispatchPendingForUpload(
        fastify.prisma,
        { media: mediaQueue },
        committed.pendingJobs,
        request.log,
      )

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
          // The activity row is written now so the feed is accurate, but the
          // completion toast belongs to whoever finishes the work. Without this
          // flag the user gets one toast here and a second from the worker.
          pendingProcessing: requiresProcessing,
        },
      })

      await fastify.publishRealtimeEvent(
        buildRealtimeEvent("upload.started", {
          userId: request.auth.user.id,
          libraryId: targetLibrary.id,
          uploadId: upload.id,
          progress: requiresProcessing ? UPLOAD_ACCEPTED_PROGRESS : 100,
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

      // Exactly one `upload.completed` per upload. When a worker job still has
      // to run, the worker owns that event — emitting a second one here is what
      // produced duplicate completion toasts once the two were more than the
      // 20s toast-dedupe window apart.
      if (apiOwnsCompletionEvent(analysis.mediaType)) {
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
              origin: "upload",
              client: clientChannel,
            },
          })
        )
      }

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
      // uploads:create is intentionally NOT accepted here: permission to
      // upload is not permission to read other people's upload history.
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        [...UPLOAD_READ_SCOPES],
      ),
    },
    async (request, reply) => {
      if (!request.auth) return

      // Scoped by the shared policy: OWNER/ADMIN see the instance, everyone
      // else sees only their own. An API key without a read scope is refused
      // even though it passed the preHandler (which accepts uploads:create).
      const where = uploadListWhere(principalFromRequest(request))

      if (!where) {
        reply.status(403).send({
          error: {
            code: "FORBIDDEN",
            message: "This API key is missing a required scope.",
          },
        })
        return
      }

      const uploads = await fastify.prisma.uploadSession.findMany({
        where,
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
      // uploads:create is intentionally NOT accepted here: permission to
      // upload is not permission to read other people's upload history.
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        [...UPLOAD_READ_SCOPES],
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

      // 404 for both "absent" and "not yours" — a 403 would confirm the id
      // exists and turn this endpoint into an existence oracle.
      if (!upload || !canReadUploadSession(principalFromRequest(request), upload)) {
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

      if (!canMutateUploadSession(principalFromRequest(request), upload)) {
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

      if (!canMutateUploadSession(principalFromRequest(request), upload)) {
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
