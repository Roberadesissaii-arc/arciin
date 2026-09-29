/**
 * File Requests — owner management and the public upload endpoint.
 *
 * The public half of this file is the only place in Arciin where an
 * unauthenticated caller causes a write. Two rules hold it together:
 *
 *   1. The destination comes from the resolved request row. The public client
 *      never names a folder, library, instance or owner. A client that could
 *      would be able to write into any folder on the instance.
 *
 *   2. Nothing about the destination flows back. The public payload is built by
 *      listing what goes in (`toPublicFileRequest`), not by deleting what must
 *      stay out, because an omission in a redact-list leaks silently.
 */

import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"

import {
  FILE_REQUEST_DEFAULTS,
  FILE_REQUEST_MAX_CONCURRENCY,
  FILE_REQUEST_RATE_LIMIT_PER_MINUTE,
  checkSubmitter,
  toPublicFileRequest,
} from "@arciin/shared"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { commitFileRequestFile } from "@/services/file-requests/file-request-commit"
import { loadIncomingForUser, publishIncoming } from "@/services/file-requests/incoming-uploads"
import { resolveChunkSizeBytes } from "@/services/file-requests/resumable-policy"
import { getUploadLimits } from "@/services/config/upload-limits"
import { registerResumableFileRequestRoutes } from "@/modules/file-requests/resumable-routes"
import {
  generateFileRequestToken,
  hashAccessCode,
  publicFileRequestError,
  resolveFileRequestByToken,
  verifyAccessCode,
} from "@/services/file-requests/file-request-access"
import { clientIpFromRequest } from "@/services/security/client-ip"
import { requireSessionRole } from "@/services/security/auth"
import { resolveEffectiveStorageRoot } from "@/services/storage/effective-storage-root"
import {
  removeTempFile,
  writeMultipartToTemp,
} from "@/services/storage/local-storage"
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  hashRequestFingerprint,
} from "@/services/uploads/idempotency-store"
import { canonicalUploadRequest, isValidIdempotencyKey } from "@arciin/shared"

const createFileRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().max(2000).optional(),
  destinationFolderId: z.string().min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  maxFileCount: z.number().int().min(1).max(10_000).nullable().optional(),
  maxTotalBytes: z.number().int().min(1).nullable().optional(),
  maxFileSizeBytes: z.number().int().min(1).nullable().optional(),
  allowedExtensions: z.array(z.string().max(16)).max(64).optional(),
  allowedMediaTypes: z
    .array(z.enum(["VIDEO", "IMAGE", "AUDIO", "DOCUMENT", "ARCHIVE", "APPLICATION", "CODE", "OTHER"]))
    .max(16)
    .optional(),
  requireName: z.boolean().optional(),
  requireEmail: z.boolean().optional(),
  allowAnonymous: z.boolean().optional(),
  allowSubmitterViewOwn: z.boolean().optional(),
  notifyOwner: z.boolean().optional(),
  accessCode: z.string().trim().min(4).max(64).optional(),
})

/**
 * Salted hash of the client IP, for rate-limiting and repeat-abuse recognition.
 * The salt is instance-scoped, so the stored value cannot be reversed with a
 * rainbow table of the IPv4 space — which a bare sha256(ip) trivially can be.
 */
function abuseIdentifier(request: FastifyRequest, salt: string): string {
  return createHash("sha256").update(`${salt}:${clientIpFromRequest(request)}`).digest("hex")
}

function serializeOwnerFileRequest(
  fr: {
    id: string
    title: string
    message: string | null
    status: string
    tokenPrefix: string
    expiresAt: Date | null
    revokedAt: Date | null
    createdAt: Date
    currentFileCount: number
    currentBytes: bigint
    maxFileCount: number | null
    maxTotalBytes: bigint | null
    maxFileSizeBytes: bigint | null
    allowedExtensions: string[]
    allowedMediaTypes: string[]
    requireName: boolean
    requireEmail: boolean
    allowAnonymous: boolean
    allowSubmitterViewOwn: boolean
    notifyOwner: boolean
    accessCodeHash: string | null
    destinationFolder?: { id: string; name: string; pathCache: string } | null
    destinationLibrary?: { id: string; name: string; slug: string } | null
    _count?: { submissions: number }
  },
) {
  return {
    id: fr.id,
    title: fr.title,
    message: fr.message,
    status: fr.status,
    tokenPrefix: fr.tokenPrefix,
    expiresAt: fr.expiresAt?.toISOString() ?? null,
    revokedAt: fr.revokedAt?.toISOString() ?? null,
    createdAt: fr.createdAt.toISOString(),
    submissionCount: fr._count?.submissions ?? 0,
    fileCount: fr.currentFileCount,
    totalBytes: Number(fr.currentBytes),
    maxFileCount: fr.maxFileCount,
    maxTotalBytes: fr.maxTotalBytes == null ? null : Number(fr.maxTotalBytes),
    maxFileSizeBytes: fr.maxFileSizeBytes == null ? null : Number(fr.maxFileSizeBytes),
    allowedExtensions: fr.allowedExtensions,
    allowedMediaTypes: fr.allowedMediaTypes,
    requireName: fr.requireName,
    requireEmail: fr.requireEmail,
    allowAnonymous: fr.allowAnonymous,
    allowSubmitterViewOwn: fr.allowSubmitterViewOwn,
    notifyOwner: fr.notifyOwner,
    hasAccessCode: Boolean(fr.accessCodeHash),
    destination: fr.destinationFolder
      ? {
          folderName: fr.destinationFolder.name,
          libraryName: fr.destinationLibrary?.name ?? null,
          librarySlug: fr.destinationLibrary?.slug ?? null,
          folderId: fr.destinationFolder.id,
        }
      : null,
  }
}

export async function registerFileRequestRoutes(fastify: FastifyInstance) {
  // Own scope: the chunk routes install a raw-stream octet-stream parser.
  await fastify.register(registerResumableFileRequestRoutes)

  // -------------------------------------------------------------------------
  // Owner management
  // -------------------------------------------------------------------------

  /**
   * Uploads arriving right now into folders this user's requests point at.
   * Session-authenticated and scoped to requests the caller created, like
   * every other owner route here; carries counts and bytes only.
   */
  fastify.get(
    "/file-requests/incoming",
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      if (!request.auth) return
      const query = z
        .object({ libraryId: z.string().min(1).max(64).optional(), folderId: z.string().min(1).max(64).optional() })
        .safeParse(request.query ?? {})
      if (!query.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid filter." } })
        return
      }
      const folders = await loadIncomingForUser(fastify, { userId: request.auth.user.id, ...query.data })
      reply.header("Cache-Control", "no-store")
      reply.send({ data: { folders } })
    },
  )

  fastify.get(
    "/file-requests",
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      if (!request.auth) return

      const requests = await fastify.prisma.fileRequest.findMany({
        where: { createdByUserId: request.auth.user.id },
        include: {
          destinationFolder: { select: { id: true, name: true, pathCache: true } },
          destinationLibrary: { select: { id: true, name: true, slug: true } },
          _count: { select: { submissions: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      })

      reply.send({ data: requests.map(serializeOwnerFileRequest) })
    },
  )

  fastify.post(
    "/file-requests",
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      if (!request.auth) return

      const parsed = createFileRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid file request payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const input = parsed.data

      // The owner's own folder id *is* trusted input here — but only after we
      // confirm it exists, is not deleted, and belongs to this instance.
      const folder = await fastify.prisma.folder.findFirst({
        where: { id: input.destinationFolderId, deletedAt: null },
        include: { library: true },
      })

      if (!folder) {
        reply.status(404).send({
          error: {
            code: "FOLDER_NOT_FOUND",
            message: "The destination folder does not exist or has been deleted.",
          },
        })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({
          error: { code: "INSTANCE_NOT_CONFIGURED", message: "This instance is not configured." },
        })
        return
      }

      const token = generateFileRequestToken()
      const expiresInDays = input.expiresInDays ?? FILE_REQUEST_DEFAULTS.expiresInDays
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

      const created = await fastify.prisma.fileRequest.create({
        data: {
          instanceId: instance.id,
          createdByUserId: request.auth.user.id,
          destinationLibraryId: folder.libraryId,
          destinationFolderId: folder.id,
          tokenHash: token.tokenHash,
          tokenPrefix: token.tokenPrefix,
          title: input.title,
          message: input.message ?? null,
          expiresAt,
          allowAnonymous: input.allowAnonymous ?? FILE_REQUEST_DEFAULTS.allowAnonymous,
          requireName: input.requireName ?? FILE_REQUEST_DEFAULTS.requireName,
          requireEmail: input.requireEmail ?? FILE_REQUEST_DEFAULTS.requireEmail,
          allowSubmitterViewOwn:
            input.allowSubmitterViewOwn ?? FILE_REQUEST_DEFAULTS.allowSubmitterViewOwn,
          notifyOwner: input.notifyOwner ?? FILE_REQUEST_DEFAULTS.notifyOwner,
          accessCodeHash: input.accessCode ? await hashAccessCode(input.accessCode) : null,
          allowedExtensions: (input.allowedExtensions ?? []).map((e) =>
            e.toLowerCase().replace(/^\./, ""),
          ),
          allowedMediaTypes: input.allowedMediaTypes ?? [],
          // `undefined` means "use the default"; an explicit null means "no limit".
          maxFileCount:
            input.maxFileCount === undefined ? FILE_REQUEST_DEFAULTS.maxFileCount : input.maxFileCount,
          maxTotalBytes:
            input.maxTotalBytes === undefined
              ? FILE_REQUEST_DEFAULTS.maxTotalBytes
              : input.maxTotalBytes == null
                ? null
                : BigInt(input.maxTotalBytes),
          maxFileSizeBytes:
            input.maxFileSizeBytes === undefined
              ? FILE_REQUEST_DEFAULTS.maxFileSizeBytes
              : input.maxFileSizeBytes == null
                ? null
                : BigInt(input.maxFileSizeBytes),
        },
        include: {
          destinationFolder: { select: { id: true, name: true, pathCache: true } },
          destinationLibrary: { select: { id: true, name: true, slug: true } },
          _count: { select: { submissions: true } },
        },
      })

      await recordAndBroadcastActivity(fastify, {
        userId: request.auth.user.id,
        type: "file_request.created",
        title: "File request created",
        message: `“${created.title}” collects uploads into ${folder.name}.`,
        entityType: "file_request",
        entityId: created.id,
        metadata: { folderName: folder.name, libraryName: folder.library.name },
      })

      reply.status(201).send({
        data: {
          ...serializeOwnerFileRequest(created),
          // Shown once. Only the hash is stored, so this is unrecoverable after
          // the response — same contract as an API key.
          token: token.rawToken,
        },
      })
    },
  )

  fastify.post(
    "/file-requests/:id/revoke",
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      if (!request.auth) return
      const params = z.object({ id: z.string() }).parse(request.params)

      const updated = await fastify.prisma.fileRequest.updateMany({
        where: { id: params.id, createdByUserId: request.auth.user.id, revokedAt: null },
        data: { revokedAt: new Date(), status: "REVOKED" },
      })

      if (updated.count === 0) {
        // 404 rather than 403: a 403 would confirm the id belongs to someone.
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "File request not found." },
        })
        return
      }

      // Uploads still open on this link stop counting as incoming now; the
      // sessions themselves are closed on their next request or by cleanup.
      const revoked = await fastify.prisma.fileRequest.findUnique({
        where: { id: params.id },
        select: { createdByUserId: true, destinationFolderId: true, destinationLibraryId: true },
      })
      if (revoked) {
        await publishIncoming(fastify, {
          phase: "ended",
          uploadId: `revoke:${params.id}`,
          ownerUserId: revoked.createdByUserId,
          folderId: revoked.destinationFolderId,
          libraryId: revoked.destinationLibraryId,
        })
      }

      reply.send({ data: { success: true } })
    },
  )

  fastify.post(
    "/file-requests/:id/extend",
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      if (!request.auth) return
      const params = z.object({ id: z.string() }).parse(request.params)
      const body = z.object({ days: z.number().int().min(1).max(365) }).parse(request.body ?? {})

      const existing = await fastify.prisma.fileRequest.findFirst({
        where: { id: params.id, createdByUserId: request.auth.user.id },
      })
      if (!existing) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "File request not found." } })
        return
      }

      // Extend from now when already expired, otherwise from the current expiry.
      const base =
        existing.expiresAt && existing.expiresAt.getTime() > Date.now()
          ? existing.expiresAt
          : new Date()

      const updated = await fastify.prisma.fileRequest.update({
        where: { id: existing.id },
        data: {
          expiresAt: new Date(base.getTime() + body.days * 24 * 60 * 60 * 1000),
          status: existing.revokedAt ? "REVOKED" : "ACTIVE",
        },
        include: {
          destinationFolder: { select: { id: true, name: true, pathCache: true } },
          destinationLibrary: { select: { id: true, name: true, slug: true } },
          _count: { select: { submissions: true } },
        },
      })

      reply.send({ data: serializeOwnerFileRequest(updated) })
    },
  )

  fastify.get(
    "/file-requests/:id/submissions",
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER"]) },
    async (request, reply) => {
      if (!request.auth) return
      const params = z.object({ id: z.string() }).parse(request.params)

      const owned = await fastify.prisma.fileRequest.findFirst({
        where: { id: params.id, createdByUserId: request.auth.user.id },
        select: { id: true },
      })
      if (!owned) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "File request not found." } })
        return
      }

      const submissions = await fastify.prisma.fileRequestSubmission.findMany({
        where: { fileRequestId: owned.id },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          assets: {
            where: { deletedAt: null },
            select: {
              id: true,
              originalFilename: true,
              mediaType: true,
              sizeBytes: true,
              status: true,
            },
          },
        },
      })

      reply.send({
        data: submissions.map((s) => ({
          id: s.id,
          status: s.status,
          submitterName: s.submitterName,
          submitterEmail: s.submitterEmail,
          fileCount: s.fileCount,
          totalBytes: Number(s.totalBytes),
          createdAt: s.createdAt.toISOString(),
          completedAt: s.completedAt?.toISOString() ?? null,
          assets: s.assets.map((a) => ({
            id: a.id,
            originalFilename: a.originalFilename,
            mediaType: a.mediaType,
            sizeBytes: Number(a.sizeBytes),
            status: a.status,
          })),
        })),
      })
    },
  )

  // -------------------------------------------------------------------------
  // Public — no authentication
  // -------------------------------------------------------------------------

  fastify.get("/public/file-requests/:token", async (request, reply) => {
    const params = z.object({ token: z.string().min(8).max(200) }).parse(request.params)

    const resolved = await resolveFileRequestByToken(fastify, params.token)
    if (!resolved.ok) {
      const { status, body } = publicFileRequestError(resolved.code)
      reply.status(status).send(body)
      return
    }

    // No caching: quotas and revocation must take effect immediately, and an
    // intermediary must never hold a copy of a private upload page.
    reply.header("Cache-Control", "no-store")
    // Upload terms, so the page can say the limit before a file is chosen and
    // chunk exactly as the server expects. The smaller of the request's own
    // limit and the instance-wide one (Settings → Storage).
    const instanceMax = getUploadLimits().maxUploadSizeBytes
    const requestMax = resolved.request.maxFileSizeBytes == null ? null : Number(resolved.request.maxFileSizeBytes)
    reply.send({
      data: {
        ...toPublicFileRequest(resolved.request),
        upload: {
          resumable: true,
          chunkSize: resolveChunkSizeBytes(),
          maximumUploadBytes: requestMax == null ? instanceMax : Math.min(requestMax, instanceMax),
        },
      },
    })
  })

  fastify.post("/public/file-requests/:token/submissions", async (request, reply) => {
    const params = z.object({ token: z.string().min(8).max(200) }).parse(request.params)

    const resolved = await resolveFileRequestByToken(fastify, params.token)
    if (!resolved.ok) {
      const { status, body } = publicFileRequestError(resolved.code)
      reply.status(status).send(body)
      return
    }

    const fileRequest = resolved.request
    const instance = await fastify.prisma.instanceConfig.findFirst()
    const abuseHash = abuseIdentifier(request, instance?.id ?? "arciin")

    // Rate limit before touching multipart: reading the stream first would let
    // an attacker spend our disk and bandwidth budget regardless of the limit.
    const rateKey = `arciin:frq:rate:${fileRequest.id}:${abuseHash}:${Math.floor(Date.now() / 60_000)}`
    const hits = await fastify.redis.incr(rateKey).catch(() => 0)
    if (hits === 1) await fastify.redis.expire(rateKey, 120).catch(() => {})
    if (hits > FILE_REQUEST_RATE_LIMIT_PER_MINUTE) {
      reply.status(429).send({
        error: { code: "RATE_LIMITED", message: "Too many uploads. Try again shortly." },
      })
      return
    }

    const concurrencyKey = `arciin:frq:inflight:${fileRequest.id}`
    const inflight = await fastify.redis.incr(concurrencyKey).catch(() => 0)
    if (inflight === 1) await fastify.redis.expire(concurrencyKey, 300).catch(() => {})
    if (inflight > FILE_REQUEST_MAX_CONCURRENCY) {
      await fastify.redis.decr(concurrencyKey).catch(() => {})
      reply.status(429).send({
        error: { code: "TOO_MANY_CONCURRENT", message: "Too many uploads in progress. Try again shortly." },
      })
      return
    }

    let tempPath: string | null = null
    let idempotencyKey: string | null = null
    const idempotencyScope = `file-request:${fileRequest.id}`

    try {
      const file = await request.file()
      if (!file) {
        reply.status(400).send({
          error: { code: "UPLOAD_REQUIRED", message: "A file is required." },
        })
        return
      }

      // Multipart text fields arrive alongside the file part.
      const fields = file.fields as Record<string, { value?: unknown } | undefined>
      const fieldValue = (name: string): string | null => {
        const raw = fields?.[name]?.value
        return typeof raw === "string" && raw.trim() ? raw.trim() : null
      }

      const accessOk = await verifyAccessCode(fileRequest.accessCodeHash, fieldValue("accessCode"))
      if (!accessOk) {
        reply.status(401).send({
          error: { code: "ACCESS_CODE_INVALID", message: "That access code is not correct." },
        })
        return
      }

      const submitter = checkSubmitter({
        requireName: fileRequest.requireName,
        requireEmail: fileRequest.requireEmail,
        allowAnonymous: fileRequest.allowAnonymous,
        name: fieldValue("submitterName"),
        email: fieldValue("submitterEmail"),
        authenticated: Boolean(request.auth),
      })
      if (!submitter.ok) {
        reply.status(400).send({ error: { code: submitter.code, message: submitter.message } })
        return
      }

      const rawKey =
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : null
      if (rawKey) {
        if (!isValidIdempotencyKey(rawKey)) {
          reply.status(400).send({
            error: {
              code: "IDEMPOTENCY_KEY_INVALID",
              message: "Idempotency-Key must be 8–255 characters of A–Z, a–z, 0–9, . _ : or -.",
            },
          })
          return
        }
        idempotencyKey = rawKey
      }

      const storageRoot = resolveEffectiveStorageRoot(instance?.storageRoot)
      const tempResult = await writeMultipartToTemp(file, storageRoot)
      tempPath = tempResult.tempPath

      // The key check happens after the bytes land because the fingerprint
      // includes the checksum: without it, two genuinely different files of the
      // same name and size under one key would look like the same request.
      if (idempotencyKey) {
        const requestHash = hashRequestFingerprint(
          canonicalUploadRequest({
            scope: idempotencyScope,
            filename: file.filename,
            sizeBytes: tempResult.sizeBytes,
            checksumSha256: tempResult.checksumSha256,
            targetFolderId: fileRequest.destinationFolderId,
            targetLibraryId: fileRequest.destinationLibraryId,
          }),
        )

        const decision = await beginIdempotentRequest(fastify.prisma, {
          scope: idempotencyScope,
          key: idempotencyKey,
          requestHash,
        })

        if (decision.action === "replay") {
          await removeTempFile(tempResult.tempPath)
          tempPath = null
          reply.status(decision.responseCode).send(decision.responseBody)
          return
        }
        if (decision.action === "conflict") {
          await removeTempFile(tempResult.tempPath)
          tempPath = null
          reply.status(409).send({ error: { code: decision.code, message: decision.message } })
          return
        }
        if (decision.action === "in_flight") {
          await removeTempFile(tempResult.tempPath)
          tempPath = null
          reply.status(409).send({ error: { code: decision.code, message: decision.message } })
          return
        }
      }

      const result = await commitFileRequestFile(fastify, {
        fileRequest,
        storageRoot,
        tempPath: tempResult.tempPath,
        filename: file.filename,
        clientMimeType: file.mimetype,
        sizeBytes: tempResult.sizeBytes,
        checksumSha256: tempResult.checksumSha256,
        submissionId: fieldValue("submissionId"),
        submitter: { name: submitter.name, email: submitter.email },
        abuseHash,
        log: request.log,
      })
      // Moved into storage on success, removed on rejection: not ours to clean.
      tempPath = null

      if (!result.ok) {
        reply.status(result.status).send({ error: { code: result.code, message: result.message } })
        return
      }

      const responseBody = {
        data: {
          submissionId: result.submissionId,
          fileName: result.fileName,
          sizeBytes: result.sizeBytes,
          status: result.status,
        },
      }

      if (idempotencyKey) {
        await completeIdempotentRequest(fastify.prisma, {
          scope: idempotencyScope,
          key: idempotencyKey,
          responseCode: 201,
          responseBody,
        })
      }

      reply.status(201).send(responseBody)
    } catch (error) {
      if (tempPath) await removeTempFile(tempPath).catch(() => {})
      if (idempotencyKey) {
        await failIdempotentRequest(fastify.prisma, {
          scope: idempotencyScope,
          key: idempotencyKey,
        })
      }

      request.log.error({ err: error, fileRequestId: fileRequest.id }, "file request upload failed")

      // Deliberately generic: a public caller gets no stack, no path, no id.
      reply.status(500).send({
        error: { code: "UPLOAD_FAILED", message: "The upload could not be completed." },
      })
    } finally {
      await fastify.redis.decr(concurrencyKey).catch(() => {})
    }
  })

  fastify.post(
    "/public/file-requests/:token/submissions/:submissionId/complete",
    async (request, reply) => {
      const params = z
        .object({ token: z.string().min(8).max(200), submissionId: z.string().min(1) })
        .parse(request.params)

      const resolved = await resolveFileRequestByToken(fastify, params.token)
      if (!resolved.ok) {
        const { status, body } = publicFileRequestError(resolved.code)
        reply.status(status).send(body)
        return
      }

      // Scoped by the resolved request, so a submission id from another request
      // resolves to nothing rather than to someone else's submission.
      const submission = await fastify.prisma.fileRequestSubmission.findFirst({
        where: { id: params.submissionId, fileRequestId: resolved.request.id },
      })

      if (!submission) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Submission not found." } })
        return
      }

      const completed = await fastify.prisma.fileRequestSubmission.update({
        where: { id: submission.id },
        data: {
          status: submission.status === "FAILED" ? "FAILED" : "COMPLETED",
          completedAt: submission.completedAt ?? new Date(),
        },
      })

      // Exactly one owner notification per submission. `notifiedAt` is claimed
      // with a conditional update so a double-submit cannot produce two.
      if (resolved.request.notifyOwner) {
        const claimed = await fastify.prisma.fileRequestSubmission.updateMany({
          where: { id: submission.id, notifiedAt: null },
          data: { notifiedAt: new Date() },
        })

        if (claimed.count === 1) {
          const who = completed.submitterName || completed.submitterEmail || "Someone"
          await recordAndBroadcastActivity(fastify, {
            userId: resolved.request.createdByUserId,
            type: "file_request.submission",
            title: "Files received",
            message: `${who} uploaded ${completed.fileCount} file${
              completed.fileCount === 1 ? "" : "s"
            } to “${resolved.request.title}”.`,
            entityType: "file_request",
            entityId: resolved.request.id,
            metadata: {
              submissionId: completed.id,
              fileCount: completed.fileCount,
              totalBytes: Number(completed.totalBytes),
            },
          })
        }
      }

      reply.send({
        data: {
          submissionId: completed.id,
          fileCount: completed.fileCount,
          totalBytes: Number(completed.totalBytes),
          status: completed.status,
        },
      })
    },
  )
}
