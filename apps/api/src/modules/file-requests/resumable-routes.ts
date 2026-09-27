import { createHash } from "node:crypto"
import { link, stat } from "node:fs/promises"
import path from "node:path"
import type { Readable } from "node:stream"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import {
  FILE_REQUEST_RATE_LIMIT_PER_MINUTE,
  admitFile,
  checkFileRequestAvailability,
  checkSubmitter,
} from "@arciin/shared"

import { getUploadLimits } from "@/services/config/upload-limits"
import {
  publicFileRequestError,
  resolveFileRequestByToken,
  verifyAccessCode,
  type ResolvedFileRequest,
} from "@/services/file-requests/file-request-access"
import { commitFileRequestFile } from "@/services/file-requests/file-request-commit"
import {
  MAX_ACTIVE_SESSIONS_PER_REQUEST,
  MAX_ACTIVE_SESSIONS_PER_SUBMITTER,
  MAX_CHUNK_REQUESTS_PER_MINUTE,
  capacityDecision,
  expectedChunkLength,
  isSafeUploadId,
  placeChunk,
  resolveChunkSizeBytes,
  resolveSessionLifetimeMs,
} from "@/services/file-requests/resumable-policy"
import {
  ChunkTooLargeError,
  ChunkTooShortError,
  createPartialFile,
  partialPath,
  removePartial,
  sha256OfFile,
  trimPartial,
  writeChunkAt,
} from "@/services/file-requests/resumable-storage"
import { hashToken } from "@/services/security/auth"
import { clientIpFromRequest } from "@/services/security/client-ip"
import { resolveEffectiveStorageRoot } from "@/services/storage/effective-storage-root"
import { createObjectStoragePath, probeStorageRoot } from "@/services/storage/local-storage"

/**
 * Resumable File Request uploads.
 *
 * A multi-gigabyte file used to travel as one multipart request. Behind
 * Cloudflare that cannot work (a proxied request body is capped far below a
 * gigabyte), on the LAN the web proxy held the whole body in memory, and on
 * any network one dropped connection threw the transfer away.
 *
 * Now a file is a session plus fixed-size chunks:
 *
 *   POST   /public/file-requests/:token/uploads                    create or resume
 *   GET    /public/file-requests/:token/uploads/:id                progress
 *   PUT    /public/file-requests/:token/uploads/:id/chunks?offset=N one chunk
 *   POST   /public/file-requests/:token/uploads/:id/complete       verify + commit
 *   DELETE /public/file-requests/:token/uploads/:id                cancel
 *
 * Every call carries the request token, and a session is only ever looked up
 * together with the request it belongs to: an upload id on its own authorises
 * nothing. The destination is the request's folder; no field the client sends
 * can change it.
 */

const ACTIVE = ["UPLOADING", "VERIFYING"] as const

/**
 * How free space is measured. Replaceable so tests can simulate a nearly full
 * disk without filling one; production always uses statfs of the storage root.
 */
export const capacityProbe = {
  read: (storageRoot: string) => probeStorageRoot(storageRoot),
}
/** A finalize that has been VERIFYING this long is presumed to have died and may be retried. */
const STALE_VERIFY_MS = 10 * 60 * 1000

const createSchema = z.object({
  filename: z.string().min(1).max(1024),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  mimeType: z.string().max(255).optional().nullable(),
  lastModified: z.number().int().min(0).optional().nullable(),
  submissionId: z.string().min(1).max(64).optional().nullable(),
  submitterName: z.string().max(200).optional().nullable(),
  submitterEmail: z.string().max(320).optional().nullable(),
  accessCode: z.string().max(64).optional().nullable(),
})

type Session = NonNullable<Awaited<ReturnType<FastifyInstance["prisma"]["resumableUpload"]["findFirst"]>>>

function sendError(reply: FastifyReply, status: number, code: string, message: string, details?: Record<string, unknown>) {
  reply.status(status).send({ error: { code, message, ...(details ? { details } : {}) } })
}

function sessionView(session: Session) {
  return {
    uploadId: session.id,
    status: session.status,
    fileName: session.filename,
    totalBytes: Number(session.sizeBytes),
    uploadedBytes: Number(session.receivedBytes),
    chunkSize: session.chunkSize,
    expiresAt: session.expiresAt.toISOString(),
  }
}

function abuseIdentifier(request: FastifyRequest, salt: string): string {
  return createHash("sha256").update(`${salt}:${clientIpFromRequest(request)}`).digest("hex")
}

/**
 * The request behind an *existing* session.
 *
 * Revoked, deleted or destination-less requests stop everything. An expired
 * request, or one that has since hit its limits, does not stop a transfer
 * that began while it was valid: that transfer runs until the session's own
 * finite expiry, and the limits are re-checked at completion.
 */
async function resolveForSession(fastify: FastifyInstance, rawToken: string) {
  const request = await fastify.prisma.fileRequest.findUnique({
    where: { tokenHash: hashToken(rawToken.trim()) },
    include: { destinationFolder: true, destinationLibrary: true },
  })
  const availability = checkFileRequestAvailability({
    exists: Boolean(request),
    status: request?.status,
    revokedAt: request?.revokedAt,
    expiresAt: request?.expiresAt,
    maxFileCount: request?.maxFileCount,
    maxTotalBytes: request?.maxTotalBytes,
    currentFileCount: request?.currentFileCount,
    currentBytes: request?.currentBytes,
    destinationFolder: request?.destinationFolder ?? null,
    destinationLibrary: request?.destinationLibrary ?? null,
  })
  if (availability.available || availability.code === "EXPIRED" || availability.code === "LIMIT_REACHED") {
    return { ok: true as const, request: request as ResolvedFileRequest }
  }
  return { ok: false as const, code: availability.code }
}

export async function registerResumableFileRequestRoutes(fastify: FastifyInstance) {
  // Chunk bodies arrive as a raw stream and are written straight to disk. A
  // scoped parser: no other route sees application/octet-stream this way.
  fastify.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload))

  const storageRootOf = async () => {
    const instance = await fastify.prisma.instanceConfig.findFirst()
    return { instance, storageRoot: resolveEffectiveStorageRoot(instance?.storageRoot) }
  }

  async function loadSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ fileRequest: ResolvedFileRequest; session: Session; storageRoot: string } | null> {
    const params = z
      .object({ token: z.string().min(8).max(200), uploadId: z.string().min(1).max(64) })
      .safeParse(request.params)
    if (!params.success || !isSafeUploadId(params.data.uploadId)) {
      sendError(reply, 404, "UPLOAD_NOT_FOUND", "This upload does not exist.")
      return null
    }
    const resolved = await resolveForSession(fastify, params.data.token)
    const { storageRoot } = await storageRootOf()
    if (!resolved.ok) {
      // A revoked request ends its uploads now, not when they expire.
      if (resolved.code === "REVOKED") {
        const hash = hashToken(params.data.token.trim())
        const fr = await fastify.prisma.fileRequest.findUnique({ where: { tokenHash: hash }, select: { id: true } })
        if (fr) {
          const cancelled = await fastify.prisma.resumableUpload.updateMany({
            where: { id: params.data.uploadId, fileRequestId: fr.id, status: { in: [...ACTIVE] } },
            data: { status: "CANCELLED", errorCode: "REQUEST_REVOKED" },
          })
          if (cancelled.count) await removePartial(storageRoot, params.data.uploadId)
        }
      }
      const { status, body } = publicFileRequestError(resolved.code)
      reply.status(status).send(body)
      return null
    }
    // Looked up *with* the request: an id from another request is not found.
    const session = await fastify.prisma.resumableUpload.findFirst({
      where: { id: params.data.uploadId, fileRequestId: resolved.request.id },
    })
    if (!session) {
      sendError(reply, 404, "UPLOAD_NOT_FOUND", "This upload does not exist.")
      return null
    }
    if (session.status === "UPLOADING" && session.expiresAt.getTime() <= Date.now()) {
      await fastify.prisma.resumableUpload.updateMany({
        where: { id: session.id, status: "UPLOADING" },
        data: { status: "EXPIRED" },
      })
      await removePartial(storageRoot, session.id)
      sendError(reply, 410, "UPLOAD_SESSION_EXPIRED", "This upload expired before it finished. Start it again.")
      return null
    }
    return { fileRequest: resolved.request, session, storageRoot }
  }

  // ---------------------------------------------------------------------------
  // Create, or resume a matching session
  // ---------------------------------------------------------------------------
  fastify.post("/public/file-requests/:token/uploads", async (request, reply) => {
    const params = z.object({ token: z.string().min(8).max(200) }).safeParse(request.params)
    if (!params.success) return sendError(reply, 404, "NOT_FOUND", "This upload link is not available.")

    const resolved = await resolveFileRequestByToken(fastify, params.data.token)
    if (!resolved.ok) {
      const { status, body } = publicFileRequestError(resolved.code)
      reply.status(status).send(body)
      return
    }
    const fileRequest = resolved.request

    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Describe the file: filename and sizeBytes.")
    }
    const input = parsed.data

    const { instance, storageRoot } = await storageRootOf()
    const abuseHash = abuseIdentifier(request, instance?.id ?? "arciin")

    // Same per-submitter budget as the single-request upload: starting a file costs one.
    const rateKey = `arciin:frq:rate:${fileRequest.id}:${abuseHash}:${Math.floor(Date.now() / 60_000)}`
    const hits = await fastify.redis.incr(rateKey).catch(() => 0)
    if (hits === 1) await fastify.redis.expire(rateKey, 120).catch(() => {})
    if (hits > FILE_REQUEST_RATE_LIMIT_PER_MINUTE) {
      return sendError(reply, 429, "RATE_LIMITED", "Too many uploads. Try again shortly.")
    }

    if (!(await verifyAccessCode(fileRequest.accessCodeHash, input.accessCode ?? null))) {
      return sendError(reply, 401, "ACCESS_CODE_INVALID", "That access code is not correct.")
    }

    const submitter = checkSubmitter({
      requireName: fileRequest.requireName,
      requireEmail: fileRequest.requireEmail,
      allowAnonymous: fileRequest.allowAnonymous,
      name: input.submitterName ?? null,
      email: input.submitterEmail ?? null,
      authenticated: false,
    })
    if (!submitter.ok) return sendError(reply, 400, submitter.code, submitter.message)

    // The instance-wide ceiling (Settings → Storage) and the request's own.
    const instanceMax = getUploadLimits().maxUploadSizeBytes
    if (input.sizeBytes > instanceMax) {
      return sendError(reply, 413, "UPLOAD_TOO_LARGE", "That file is larger than this server accepts.", {
        maximumUploadBytes: instanceMax,
      })
    }

    const active = await fastify.prisma.resumableUpload.findMany({
      where: { fileRequestId: fileRequest.id, status: { in: [...ACTIVE] }, expiresAt: { gt: new Date() } },
      select: { id: true, sizeBytes: true, receivedBytes: true, abuseIdentifierHash: true },
    })

    // Preliminary admission on the declared name and size. Content-based rules
    // (detected type) run again at completion, on the real bytes.
    const pendingBytes = active.reduce((sum, s) => sum + s.sizeBytes, 0n)
    const admission = admitFile({
      filename: input.filename,
      sizeBytes: input.sizeBytes,
      maxFileSizeBytes: fileRequest.maxFileSizeBytes,
      maxFileCount: fileRequest.maxFileCount,
      maxTotalBytes: fileRequest.maxTotalBytes,
      currentFileCount: fileRequest.currentFileCount + active.length,
      currentBytes: fileRequest.currentBytes + pendingBytes,
      allowedExtensions: fileRequest.allowedExtensions,
    })

    // Resume: the same person re-selecting the same file continues its session.
    const safeName = admission.allowed ? admission.safeFilename : null
    if (safeName) {
      const existing = await fastify.prisma.resumableUpload.findFirst({
        where: {
          fileRequestId: fileRequest.id,
          abuseIdentifierHash: abuseHash,
          filename: safeName,
          sizeBytes: BigInt(input.sizeBytes),
          lastModified: input.lastModified != null ? BigInt(input.lastModified) : null,
          status: "UPLOADING",
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      })
      if (existing) {
        reply.header("Cache-Control", "no-store")
        return reply.status(200).send({ data: { ...sessionView(existing), resumed: true } })
      }
    }

    if (!admission.allowed) {
      const status =
        admission.code === "FILE_TOO_LARGE"
          ? 413
          : admission.code === "FILE_COUNT_EXCEEDED" || admission.code === "TOTAL_BYTES_EXCEEDED"
            ? 409
            : admission.code === "INVALID_FILENAME"
              ? 400
              : 415
      return sendError(reply, status, admission.code === "FILE_TOO_LARGE" ? "UPLOAD_TOO_LARGE" : admission.code, admission.message)
    }

    if (active.length >= MAX_ACTIVE_SESSIONS_PER_REQUEST) {
      return sendError(reply, 429, "TOO_MANY_UPLOADS", "Too many uploads are in progress on this link. Try again shortly.")
    }
    if (active.filter((s) => s.abuseIdentifierHash === abuseHash).length >= MAX_ACTIVE_SESSIONS_PER_SUBMITTER) {
      return sendError(reply, 429, "TOO_MANY_UPLOADS", "Finish or cancel an upload before starting another.")
    }

    const chunkSize = resolveChunkSizeBytes()
    const expiresAt = new Date(Date.now() + resolveSessionLifetimeMs())

    // Capacity is checked and the session recorded under one lock, so two
    // uploads starting together cannot both count the same free space.
    const created = await fastify.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arciin:resumable-capacity'))`
      const open = await tx.resumableUpload.findMany({
        where: { status: { in: [...ACTIVE] }, expiresAt: { gt: new Date() } },
        select: { sizeBytes: true, receivedBytes: true },
      })
      const outstanding = open.reduce((sum, s) => sum + Number(s.sizeBytes - s.receivedBytes), 0)
      const disk = await capacityProbe.read(storageRoot)
      const capacity = capacityDecision({
        requestedBytes: input.sizeBytes,
        availableBytes: disk.availableBytes,
        outstandingBytes: outstanding,
        totalBytes: disk.totalBytes,
      })
      if (!capacity.ok) return { ok: false as const, capacity }
      const session = await tx.resumableUpload.create({
        data: {
          fileRequestId: fileRequest.id,
          submissionId: input.submissionId ?? null,
          filename: safeName!,
          mimeType: input.mimeType ?? null,
          sizeBytes: BigInt(input.sizeBytes),
          lastModified: input.lastModified != null ? BigInt(input.lastModified) : null,
          chunkSize,
          submitterName: submitter.name,
          submitterEmail: submitter.email,
          abuseIdentifierHash: abuseHash,
          expiresAt,
        },
      })
      return { ok: true as const, session }
    })

    if (!created.ok) {
      return sendError(reply, 507, "INSUFFICIENT_STORAGE", "This server does not have enough free space for that file.", {
        requiredBytes: created.capacity.requiredBytes,
        availableBytes: created.capacity.availableBytes,
      })
    }

    await createPartialFile(storageRoot, created.session.id)
    reply.header("Cache-Control", "no-store")
    reply.status(201).send({ data: { ...sessionView(created.session), resumed: false } })
  })

  // ---------------------------------------------------------------------------
  // Progress — the browser asks this before resuming
  // ---------------------------------------------------------------------------
  fastify.get("/public/file-requests/:token/uploads/:uploadId", async (request, reply) => {
    const loaded = await loadSession(request, reply)
    if (!loaded) return
    reply.header("Cache-Control", "no-store")
    reply.send({ data: sessionView(loaded.session) })
  })

  // ---------------------------------------------------------------------------
  // One chunk, written at its offset
  // ---------------------------------------------------------------------------
  fastify.put("/public/file-requests/:token/uploads/:uploadId/chunks", async (request, reply) => {
    const body = request.body as Readable | undefined
    const drain = async () => {
      if (body && typeof (body as Readable).resume === "function") (body as Readable).resume()
    }

    const loaded = await loadSession(request, reply)
    if (!loaded) return drain()
    const { session, storageRoot } = loaded

    if (session.status !== "UPLOADING") {
      await drain()
      return sendError(reply, 409, "UPLOAD_NOT_ACCEPTING", "This upload is not accepting data.", { status: session.status })
    }

    const rateKey = `arciin:frq:chunks:${session.id}:${Math.floor(Date.now() / 60_000)}`
    const hits = await fastify.redis.incr(rateKey).catch(() => 0)
    if (hits === 1) await fastify.redis.expire(rateKey, 120).catch(() => {})
    if (hits > MAX_CHUNK_REQUESTS_PER_MINUTE) {
      await drain()
      return sendError(reply, 429, "RATE_LIMITED", "Too many requests for this upload. Slow down.")
    }

    const offsetRaw = (request.query as { offset?: string } | undefined)?.offset
    const offset = offsetRaw != null && /^\d+$/.test(offsetRaw) ? Number(offsetRaw) : Number.NaN
    const total = Number(session.sizeBytes)
    const received = Number(session.receivedBytes)
    const placement = placeChunk({ offset, receivedBytes: received, totalBytes: total, chunkSize: session.chunkSize })

    if (placement.kind === "duplicate") {
      // Already have it: the earlier response was lost. Acknowledge, write nothing.
      await drain()
      return reply.send({ data: { uploadedBytes: received, totalBytes: total, duplicate: true } })
    }
    if (placement.kind === "invalid") {
      await drain()
      return sendError(reply, 409, "INVALID_UPLOAD_OFFSET", "That chunk does not continue the upload.", {
        expectedOffset: placement.expectedOffset,
      })
    }

    const expected = expectedChunkLength(total, offset, session.chunkSize)
    const declared = Number(request.headers["content-length"])
    if (Number.isFinite(declared) && declared !== expected) {
      await drain()
      return sendError(reply, 400, "INVALID_CHUNK_SIZE", `Chunk at ${offset} must be exactly ${expected} bytes.`, {
        expectedBytes: expected,
      })
    }
    if (!body || typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function") {
      return sendError(reply, 415, "INVALID_CHUNK_BODY", "Send the chunk as application/octet-stream.")
    }

    let written: { bytes: number; sha256: string }
    try {
      written = await writeChunkAt({ file: partialPath(storageRoot, session.id), offset, expectedLength: expected, body })
    } catch (error) {
      if (error instanceof ChunkTooLargeError || error instanceof ChunkTooShortError) {
        return sendError(reply, 400, "INVALID_CHUNK_SIZE", `Chunk at ${offset} must be exactly ${expected} bytes.`, {
          expectedBytes: expected,
        })
      }
      request.log.warn({ err: error, uploadId: session.id }, "chunk write failed")
      return sendError(reply, 500, "UPLOAD_FAILED", "That chunk could not be stored. Retry it.")
    }

    // Optional per-chunk checksum from the client catches a chunk damaged in
    // transit before it is counted, so only that chunk is resent.
    const claimed = request.headers["x-chunk-sha256"]
    if (typeof claimed === "string" && claimed.toLowerCase() !== written.sha256) {
      return sendError(reply, 422, "CHUNK_CHECKSUM_MISMATCH", "That chunk arrived damaged. Resend it.", {
        expectedOffset: received,
      })
    }

    // Advance only from the offset this chunk was written at, so two copies of
    // the same chunk racing each other cannot both count.
    const advanced = await fastify.prisma.resumableUpload.updateMany({
      where: { id: session.id, status: "UPLOADING", receivedBytes: BigInt(offset) },
      data: { receivedBytes: BigInt(offset + written.bytes) },
    })
    const current = advanced.count
      ? offset + written.bytes
      : Number(
          (await fastify.prisma.resumableUpload.findUnique({ where: { id: session.id }, select: { receivedBytes: true } }))
            ?.receivedBytes ?? received,
        )
    reply.send({ data: { uploadedBytes: current, totalBytes: total } })
  })

  // ---------------------------------------------------------------------------
  // Complete: verify, then commit — in that order
  // ---------------------------------------------------------------------------
  fastify.post("/public/file-requests/:token/uploads/:uploadId/complete", async (request, reply) => {
    const loaded = await loadSession(request, reply)
    if (!loaded) return
    const { fileRequest, storageRoot } = loaded
    let session = loaded.session

    if (session.status === "COMPLETE") {
      // Idempotent: a lost response to a successful completion is safe to repeat.
      return reply.send({ data: { ...sessionView(session), assetCreated: Boolean(session.assetId) } })
    }
    if (session.status !== "UPLOADING" && session.status !== "VERIFYING") {
      return sendError(reply, 409, "UPLOAD_NOT_ACCEPTING", "This upload cannot be completed.", { status: session.status })
    }
    if (session.receivedBytes < session.sizeBytes) {
      return sendError(reply, 409, "UPLOAD_INCOMPLETE", "Not every chunk has arrived yet.", {
        uploadedBytes: Number(session.receivedBytes),
        totalBytes: Number(session.sizeBytes),
      })
    }

    const claim = await fastify.prisma.resumableUpload.updateMany({
      where: {
        id: session.id,
        OR: [
          { status: "UPLOADING" },
          { status: "VERIFYING", updatedAt: { lt: new Date(Date.now() - STALE_VERIFY_MS) } },
        ],
      },
      data: { status: "VERIFYING" },
    })
    if (!claim.count) {
      return sendError(reply, 409, "UPLOAD_VERIFYING", "This upload is already being finalised.")
    }
    session = (await fastify.prisma.resumableUpload.findUnique({ where: { id: session.id } }))!

    const file = partialPath(storageRoot, session.id)
    const size = Number(session.sizeBytes)

    try {
      // Recovery after a crash mid-finalize. The checksum is recorded before
      // anything is moved, so a retry can tell what already happened.
      if (session.checksumSha256) {
        // Committed, but the process died before marking the session: finish
        // the bookkeeping instead of creating a second asset.
        const committed = await fastify.prisma.asset.findFirst({
          where: {
            fileRequestId: fileRequest.id,
            checksumSha256: session.checksumSha256,
            originalFilename: session.filename,
            createdAt: { gte: session.createdAt },
          },
          select: { id: true, fileRequestSubmissionId: true },
        })
        if (committed) {
          const done = await fastify.prisma.resumableUpload.update({
            where: { id: session.id },
            data: { status: "COMPLETE", assetId: committed.id, submissionId: committed.fileRequestSubmissionId },
          })
          await removePartial(storageRoot, session.id)
          return reply.send({ data: { ...sessionView(done), recovered: true } })
        }
        // Moved into object storage but not committed: link the verified object
        // back so the commit below can finish; placement then reuses it.
        const partialExists = await stat(file).then(() => true, () => false)
        if (!partialExists) {
          const object = await fastify.prisma.storageObject.findFirst({
            where: { checksumSha256: session.checksumSha256 },
            select: { physicalPath: true },
          })
          const candidate =
            object?.physicalPath ??
            createObjectStoragePath(session.checksumSha256, path.extname(session.filename), storageRoot).physicalPath
          await link(candidate, file).catch(() => {})
        }
      }

      const actualSize = await trimPartial(file, size)
      if (actualSize !== size) {
        await fastify.prisma.resumableUpload.update({ where: { id: session.id }, data: { status: "UPLOADING" } })
        return sendError(reply, 409, "UPLOAD_INCOMPLETE", "The assembled file is the wrong size.", {
          uploadedBytes: actualSize,
          totalBytes: size,
        })
      }

      const checksum = await sha256OfFile(file)
      const body = z
        .object({
          sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
          // Files uploaded in parallel join whichever submission finished first,
          // so the owner is notified once per drop. Checked against this
          // request inside commitFileRequestFile.
          submissionId: z.string().min(1).max(64).optional(),
        })
        .safeParse(request.body ?? {})
      if (body.success && body.data.sha256 && body.data.sha256.toLowerCase() !== checksum) {
        await fastify.prisma.resumableUpload.update({
          where: { id: session.id },
          data: { status: "FAILED", errorCode: "CHECKSUM_MISMATCH" },
        })
        await removePartial(storageRoot, session.id)
        return sendError(reply, 422, "CHECKSUM_MISMATCH", "The file on the server does not match the one you sent. Upload it again.")
      }
      await fastify.prisma.resumableUpload.update({ where: { id: session.id }, data: { checksumSha256: checksum } })

      const result = await commitFileRequestFile(fastify, {
        fileRequest,
        storageRoot,
        tempPath: file,
        filename: session.filename,
        clientMimeType: session.mimeType,
        sizeBytes: size,
        checksumSha256: checksum,
        submissionId: (body.success ? body.data.submissionId : undefined) ?? session.submissionId,
        submitter: { name: session.submitterName, email: session.submitterEmail },
        abuseHash: session.abuseIdentifierHash,
        log: request.log,
      })

      if (!result.ok) {
        await fastify.prisma.resumableUpload.update({
          where: { id: session.id },
          data: { status: "FAILED", errorCode: result.code },
        })
        await removePartial(storageRoot, session.id)
        return sendError(reply, result.status, result.code, result.message)
      }

      const done = await fastify.prisma.resumableUpload.update({
        where: { id: session.id },
        data: { status: "COMPLETE", assetId: result.assetId, submissionId: result.submissionId },
      })
      reply.status(200).send({
        data: {
          ...sessionView(done),
          submissionId: result.submissionId,
          fileName: result.fileName,
          sizeBytes: result.sizeBytes,
          processing: result.status,
          checksumSha256: checksum,
        },
      })
    } catch (error) {
      request.log.error({ err: error, uploadId: session.id }, "resumable finalize failed")
      // Leave it resumable: the partial is intact and the completion can be retried.
      await fastify.prisma.resumableUpload
        .updateMany({ where: { id: session.id, status: "VERIFYING" }, data: { status: "UPLOADING" } })
        .catch(() => {})
      sendError(reply, 500, "UPLOAD_FAILED", "The upload could not be finalised. Try completing it again.")
    }
  })

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------
  fastify.delete("/public/file-requests/:token/uploads/:uploadId", async (request, reply) => {
    const loaded = await loadSession(request, reply)
    if (!loaded) return
    const cancelled = await fastify.prisma.resumableUpload.updateMany({
      where: { id: loaded.session.id, status: "UPLOADING" },
      data: { status: "CANCELLED" },
    })
    if (cancelled.count) await removePartial(loaded.storageRoot, loaded.session.id)
    reply.send({ data: { uploadId: loaded.session.id, status: cancelled.count ? "CANCELLED" : loaded.session.status } })
  })
}
