import { randomBytes } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { Job } from "bullmq"
import { z } from "zod"

import {
  IMPORT_BATCH_MAX_ITEMS,
  IMPORT_MAX_ACTIVE_PER_USER,
  IMPORT_MAX_WAITING_PER_USER,
  JOB_TYPES,
  acquireImportSlot,
  normalizeImportUrl,
  queueWaitingImport,
  releaseImportSlot,
  waitingImportCount,
  type ImportCandidate,
  type ImportCandidateCategory,
  type ImportInspection,
  type ImportInspectionKind,
} from "@arciin/shared"

import { buildRealtimeEvent } from "@/services/events/publish-event"
import { inspectQueue, mediaQueue } from "@/services/jobs/queues"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import { serializeUpload } from "@/services/serializers"
import {
  BlockedImportUrlError,
  assertPublicUrlResolvesOffHost,
  isImportablePublicUrl,
} from "@/services/imports/url-guard"
import { fetchRemoteThumbnail, type ThumbnailFailure, type ThumbnailMime } from "@/services/imports/thumbnail-proxy"

/** Replaceable so tests never reach the network. */
export const thumbnailFetcher = { fetch: (url: string) => fetchRemoteThumbnail(url) }

/**
 * Proxied thumbnails, briefly: a picker re-renders, a dialog reopens.
 * Bounded by entries and bytes; failures are cached too so a dead image is
 * not fetched again on every render.
 */
type ThumbnailCacheEntry = { body: Buffer; contentType: ThumbnailMime } | { failure: ThumbnailFailure }
const THUMBNAIL_CACHE_TTL_MS = 10 * 60_000
const THUMBNAIL_CACHE_MAX_ENTRIES = 200
const THUMBNAIL_CACHE_MAX_BYTES = 32 * 1024 * 1024
export const thumbnailCache = (() => {
  const map = new Map<string, { at: number; entry: ThumbnailCacheEntry }>()
  let bytes = 0
  const size = (e: ThumbnailCacheEntry) => ("body" in e ? e.body.length : 0)
  const drop = (key: string) => {
    const old = map.get(key)
    if (old) bytes -= size(old.entry)
    map.delete(key)
  }
  return {
    get(key: string): ThumbnailCacheEntry | undefined {
      const hit = map.get(key)
      if (!hit) return undefined
      if (Date.now() - hit.at > THUMBNAIL_CACHE_TTL_MS) {
        drop(key)
        return undefined
      }
      return hit.entry
    },
    set(key: string, entry: ThumbnailCacheEntry) {
      drop(key)
      map.set(key, { at: Date.now(), entry })
      bytes += size(entry)
      while (map.size > THUMBNAIL_CACHE_MAX_ENTRIES || bytes > THUMBNAIL_CACHE_MAX_BYTES) {
        const oldest = map.keys().next().value
        if (oldest === undefined) break
        drop(oldest)
      }
    },
    clear() {
      map.clear()
      bytes = 0
    },
  }
})()

const formatSchema = {
  audioOnly: z.boolean().optional(),
  audioFormat: z.enum(["mp3", "m4a"]).optional(),
  videoFormat: z.enum(["mp4", "best"]).optional(),
}

const candidateRef = {
  inspectionId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  itemId: z.string().regex(/^c[0-9]{1,2}$/),
}

const importSchema = z.object({
  // Normalised below: "example.com/video" is accepted and becomes https://.
  url: z.string().trim().min(1).max(2048),
  /**
   * The inspection candidate this link was picked from, if any. Only lets
   * the server look up the title *it* stored; the client sends no title.
   */
  inspectionId: candidateRef.inspectionId.optional(),
  itemId: candidateRef.itemId.optional(),
  targetLibraryId: z.string().cuid().optional(),
  targetFolderId: z.string().cuid().optional(),
  ...formatSchema,
})

const inspectSchema = z.object({ url: z.string().trim().min(1).max(2048) })

const batchSchema = z.object({
  inspectionId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  itemIds: z.array(z.string().regex(/^c[0-9]{1,2}$/)).min(1).max(IMPORT_BATCH_MAX_ITEMS),
  targetLibraryId: z.string().cuid().optional(),
  targetFolderId: z.string().cuid().optional(),
  ...formatSchema,
})

/** How long an inspection's candidates can be imported from. */
const INSPECTION_TTL_SECONDS = 30 * 60
/** The API stops waiting shortly after the worker's own 30 s deadline. */
const INSPECT_WAIT_MS = 35_000
const INSPECT_POLL_MS = 250
const MAX_CONCURRENT_INSPECTIONS_PER_USER = 2

const inspectionKey = (id: string) => `import:inspect:${id}`

type StoredInspection = {
  userId: string
  url: string
  items: Array<{
    id: string
    url: string
    category: ImportCandidateCategory
    /** The source's own title, as inspected — null when the source gave none. */
    title?: string | null
    /** Third-party preview URL. Server-side only; never sent to a browser. */
    thumbnail?: string | null
  }>
}

/** What the worker's inspectLink returns. */
export type InspectOutcome = {
  kind: ImportInspectionKind
  title: string | null
  reason: string | null
  items: Array<Omit<ImportCandidate, "id" | "title" | "hasThumbnail"> & { title: string | null; thumbnail: string | null }>
}

/**
 * Runs an inspection. The worker does the work — it has yt-dlp and the
 * rebind-safe fetch — and this waits for its answer. Replaceable so tests can
 * stand in for the worker.
 */
export const inspectRunner = {
  run: async (url: string): Promise<InspectOutcome> => {
    const job = await inspectQueue.add(JOB_TYPES.inspectUrl, { url })
    const started = Date.now()
    while (Date.now() - started < INSPECT_WAIT_MS) {
      const state = await job.getState()
      if (state === "completed") {
        const done = await Job.fromId(inspectQueue, job.id!)
        return done?.returnvalue as InspectOutcome
      }
      if (state === "failed") {
        const failed = await Job.fromId(inspectQueue, job.id!)
        throw new InspectFailedError(failed?.failedReason ?? "Could not inspect this link.")
      }
      await new Promise((resolve) => setTimeout(resolve, INSPECT_POLL_MS))
    }
    await job.remove().catch(() => {})
    throw new InspectFailedError("Inspecting the link took too long.")
  },
}

export class InspectFailedError extends Error {}

/** Best-effort filename for the pending session before the download resolves. */
function pendingFilenameFromUrl(rawUrl: string, title?: string | null): string {
  if (title) return title.slice(0, 200)
  try {
    const url = new URL(rawUrl)
    const last = url.pathname.split("/").filter(Boolean).pop()
    if (last && last.length <= 120) return decodeURIComponent(last)
    return url.hostname
  } catch {
    return "Imported link"
  }
}

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  reply.status(status).send({ error: { code, message } })
}

/**
 * Normalise, then check the address — the server's own decision, whatever the
 * client did. Returns the URL to use, or null after replying with the reason.
 */
async function acceptPublicUrl(
  raw: string,
  reply: FastifyReply,
  opts: { resolveDns: boolean },
): Promise<string | null> {
  const normalized = normalizeImportUrl(raw)
  if (!normalized.ok) {
    sendError(reply, 400, "VALIDATION_ERROR", normalized.reason)
    return null
  }
  if (!isImportablePublicUrl(normalized.url)) {
    sendError(reply, 400, "IMPORT_URL_BLOCKED", "Only public http(s) links can be imported.")
    return null
  }
  if (opts.resolveDns) {
    try {
      await assertPublicUrlResolvesOffHost(normalized.url)
    } catch (error) {
      const message = error instanceof BlockedImportUrlError ? error.message : "That link could not be checked."
      sendError(reply, 400, "IMPORT_URL_BLOCKED", message)
      return null
    }
  }
  return normalized.url
}

type ImportFormat = { audioOnly?: boolean; audioFormat?: "mp3" | "m4a"; videoFormat?: "mp4" | "best" }

export async function registerImportRoutes(fastify: FastifyInstance) {
  const guard = requireSessionRolesOrApiKeyScopes(["OWNER", "ADMIN", "MEMBER"], ["uploads:create"])

  /** A session + job for one link, started now if a slot is free, else waiting its turn. */
  async function createImport(
    request: FastifyRequest,
    input: {
      url: string
      title?: string | null
      targetLibraryId?: string
      targetFolderId?: string
      format: ImportFormat
      /** Refuse instead of queueing when no slot is free (the single-link endpoint's contract). */
      requireSlot: boolean
    },
  ) {
    const userId = request.auth!.user.id
    const upload = await fastify.prisma.uploadSession.create({
      data: {
        userId,
        originalFilename: pendingFilenameFromUrl(input.url, input.title),
        mimeType: null,
        sizeBytes: 0,
        status: "QUEUED",
        progress: 0,
        targetLibraryId: input.targetLibraryId ?? null,
        targetFolderId: input.targetFolderId ?? null,
      },
      include: { targetLibrary: true },
    })

    // Each import can be a heavy download and transcode; a user gets
    // IMPORT_MAX_ACTIVE_PER_USER at once. The worker releases the slot.
    const admitted = await acquireImportSlot(fastify.redis, userId, upload.id)
    if (!admitted && input.requireSlot) {
      await fastify.prisma.uploadSession.delete({ where: { id: upload.id } }).catch(() => {})
      return { state: "refused" as const }
    }

    const payload = {
      url: input.url,
      uploadId: upload.id,
      userId,
      targetLibraryId: input.targetLibraryId,
      targetFolderId: input.targetFolderId,
      audioOnly: input.format.audioOnly,
      audioFormat: input.format.audioFormat,
      videoFormat: input.format.videoFormat,
      // From the stored inspection only (see callers).
      ...(input.title ? { sourceTitle: input.title } : {}),
    }
    const job = await fastify.prisma.job.create({
      data: { type: JOB_TYPES.importUrl, status: "QUEUED", progress: 0, payload },
    })
    const jobData = { ...payload, jobRecordId: job.id }

    try {
      if (admitted) await mediaQueue.add(JOB_TYPES.importUrl, jobData)
      else await queueWaitingImport(fastify.redis, userId, jobData)
    } catch (error) {
      if (admitted) await releaseImportSlot(fastify.redis, userId, upload.id).catch(() => {})
      throw error
    }

    await fastify.publishRealtimeEvent(
      buildRealtimeEvent("upload.started", {
        userId,
        uploadId: upload.id,
        progress: admitted ? 12 : 2,
        message: admitted
          ? `Importing ${upload.originalFilename}…`
          : `Waiting to import ${upload.originalFilename}…`,
        data: {
          source: "url",
          origin: "url",
          url: input.url,
          fileName: upload.originalFilename,
          destination: upload.targetLibrary?.name ?? "Inbox",
          waiting: !admitted,
        },
      }),
    )
    return { state: admitted ? ("started" as const) : ("waiting" as const), upload }
  }

  /** A stored inspection, only for the user who made it (anyone else's looks expired). */
  async function readInspection(userId: string, inspectionId: string): Promise<StoredInspection | null> {
    const raw = await fastify.redis.get(inspectionKey(inspectionId))
    const stored = raw ? (JSON.parse(raw) as StoredInspection) : null
    return stored && stored.userId === userId ? stored : null
  }

  /** The title the server stored for a candidate — only if it is the same link being imported. */
  async function storedCandidateTitle(userId: string, inspectionId: string, itemId: string, url: string): Promise<string | null> {
    const stored = await readInspection(userId, inspectionId)
    const item = stored?.items.find((i) => i.id === itemId)
    if (!item?.title) return null
    const normalized = normalizeImportUrl(item.url)
    return normalized.ok && normalized.url === url ? item.title : null
  }

  /**
   * A candidate's preview image, fetched by the server.
   *
   * The browser names an inspection and an item — never a URL. The URL is
   * the one stored at inspection time for this user, fetched under the import
   * SSRF rules (see thumbnail-proxy.ts) and cached briefly in memory.
   */
  fastify.get(
    "/imports/inspections/:inspectionId/items/:itemId/thumbnail",
    { preHandler: guard },
    async (request, reply) => {
      if (!request.auth) return
      const params = z.object(candidateRef).safeParse(request.params)
      if (!params.success) return sendError(reply, 404, "THUMBNAIL_NOT_FOUND", "No preview for this item.")
      const userId = request.auth.user.id
      if (await checkEndpointRateLimit(request, reply, { key: `import-thumb:user:${userId}`, limit: 120, windowSec: 60 })) {
        return
      }
      const stored = await readInspection(userId, params.data.inspectionId)
      const item = stored?.items.find((i) => i.id === params.data.itemId)
      if (!item?.thumbnail) return sendError(reply, 404, "THUMBNAIL_NOT_FOUND", "No preview for this item.")

      const cacheKey = `${params.data.inspectionId}:${params.data.itemId}`
      let entry = thumbnailCache.get(cacheKey)
      if (!entry) {
        const fetched = await thumbnailFetcher.fetch(item.thumbnail)
        entry = fetched.ok ? { body: fetched.body, contentType: fetched.contentType } : { failure: fetched.reason }
        thumbnailCache.set(cacheKey, entry)
      }
      if ("failure" in entry) {
        request.log.info({ reason: entry.failure }, "import thumbnail unavailable")
        return sendError(reply, 404, "THUMBNAIL_NOT_FOUND", "No preview for this item.")
      }
      reply
        .header("Content-Type", entry.contentType)
        .header("Cache-Control", "private, max-age=600")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header("Content-Disposition", "inline")
        .send(entry.body)
    },
  )

  fastify.post("/imports", { preHandler: guard }, async (request, reply) => {
    if (!request.auth) return
    if (await checkEndpointRateLimit(request, reply, { key: `import:user:${request.auth.user.id}`, limit: 60, windowSec: 60 })) {
      return
    }

    const parsed = importSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter a link to import, such as example.com/video.",
          details: parsed.error.flatten(),
        },
      })
      return
    }
    const url = await acceptPublicUrl(parsed.data.url, reply, { resolveDns: false })
    if (!url) return

    const { targetLibraryId, targetFolderId, audioOnly, audioFormat, videoFormat } = parsed.data
    const title =
      parsed.data.inspectionId && parsed.data.itemId
        ? await storedCandidateTitle(request.auth.user.id, parsed.data.inspectionId, parsed.data.itemId, url)
        : null
    const result = await createImport(request, {
      url,
      title,
      targetLibraryId,
      targetFolderId,
      format: { audioOnly, audioFormat, videoFormat },
      requireSlot: true,
    })
    if (result.state === "refused") {
      sendError(
        reply,
        429,
        "TOO_MANY_ACTIVE_IMPORTS",
        `You already have ${IMPORT_MAX_ACTIVE_PER_USER} imports in progress. Wait for one to finish.`,
      )
      return
    }
    reply.status(202).send({ data: serializeUpload(result.upload) })
  })

  /**
   * What is at a link: one item, up to five from a page or playlist, nothing,
   * or a DRM host. Metadata only — nothing is downloaded. The candidates are
   * kept here under an id; importing them later reads the URLs from here,
   * never from the client.
   */
  fastify.post("/imports/inspect", { preHandler: guard }, async (request, reply) => {
    if (!request.auth) return
    const userId = request.auth.user.id
    if (await checkEndpointRateLimit(request, reply, { key: `import-inspect:user:${userId}`, limit: 20, windowSec: 60 })) {
      return
    }
    const parsed = inspectSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "Enter a link to inspect.")
    const url = await acceptPublicUrl(parsed.data.url, reply, { resolveDns: true })
    if (!url) return

    const busyKey = `import:inspecting:${userId}`
    const busy = await fastify.redis.incr(busyKey)
    await fastify.redis.expire(busyKey, 60)
    if (busy > MAX_CONCURRENT_INSPECTIONS_PER_USER) {
      await fastify.redis.decr(busyKey)
      return sendError(reply, 429, "TOO_MANY_INSPECTIONS", "Wait for the current inspection to finish.")
    }

    let outcome: InspectOutcome
    try {
      outcome = await inspectRunner.run(url)
    } catch (error) {
      const message = error instanceof InspectFailedError ? error.message : "Could not inspect this link."
      const blocked = /private|this server|non-web|resolve/i.test(message)
      return sendError(reply, blocked ? 400 : 502, blocked ? "IMPORT_URL_BLOCKED" : "INSPECT_FAILED", blocked ? message : "Could not inspect this link.")
    } finally {
      await fastify.redis.decr(busyKey).catch(() => {})
    }

    const inspectionId = randomBytes(18).toString("base64url")
    const found = (outcome.items ?? []).slice(0, IMPORT_BATCH_MAX_ITEMS)
    const items: ImportCandidate[] = found.map((item, i) => ({
      id: `c${i + 1}`,
      url: item.url,
      title: item.title ?? `Item ${i + 1}`,
      hasThumbnail: typeof item.thumbnail === "string" && item.thumbnail.startsWith("https://"),
      durationSeconds: item.durationSeconds ?? null,
      source: item.source,
      category: item.category,
    }))
    const stored: StoredInspection = {
      userId,
      url,
      items: found.map((item, i) => ({
        id: `c${i + 1}`,
        url: item.url,
        category: item.category,
        title: item.title ?? null,
        thumbnail: typeof item.thumbnail === "string" ? item.thumbnail.slice(0, 2048) : null,
      })),
    }
    await fastify.redis.set(inspectionKey(inspectionId), JSON.stringify(stored), "EX", INSPECTION_TTL_SECONDS)

    const body: ImportInspection = {
      inspectionId,
      url,
      kind: outcome.kind,
      title: outcome.title ?? null,
      items,
      reason: outcome.kind === "blocked" ? (outcome.reason ?? "This link cannot be imported.") : null,
    }
    reply.header("Cache-Control", "no-store")
    reply.send({ data: body })
  })

  /**
   * Import several items from one inspection. Up to five; up to
   * IMPORT_MAX_ACTIVE_PER_USER start now and the rest wait on the server,
   * started by the worker as slots free up. Each URL comes from the stored
   * inspection and is checked again here — a client cannot slip in its own.
   */
  fastify.post("/imports/batch", { preHandler: guard }, async (request, reply) => {
    if (!request.auth) return
    const userId = request.auth.user.id
    if (await checkEndpointRateLimit(request, reply, { key: `import:user:${userId}`, limit: 60, windowSec: 60 })) {
      return
    }
    const parsed = batchSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", `Choose between 1 and ${IMPORT_BATCH_MAX_ITEMS} items to import.`)
    }
    const { inspectionId, targetLibraryId, targetFolderId, audioOnly, audioFormat, videoFormat } = parsed.data
    const itemIds = [...new Set(parsed.data.itemIds)]

    // Someone else's inspection is indistinguishable from an expired one.
    const stored = await readInspection(userId, inspectionId)
    if (!stored) {
      return sendError(reply, 404, "INSPECTION_NOT_FOUND", "This link was inspected too long ago. Inspect it again.")
    }
    const chosen = itemIds.map((id) => stored.items.find((item) => item.id === id))
    if (chosen.some((item) => !item)) {
      return sendError(reply, 400, "VALIDATION_ERROR", "One of the chosen items is not part of this inspection.")
    }

    const waiting = await waitingImportCount(fastify.redis, userId)
    if (waiting + chosen.length > IMPORT_MAX_WAITING_PER_USER) {
      return sendError(reply, 429, "TOO_MANY_WAITING_IMPORTS", "Too many imports are already waiting. Let some finish first.")
    }

    const accepted: Array<{ itemId: string; state: "started" | "waiting"; upload: ReturnType<typeof serializeUpload> }> = []
    const rejected: Array<{ itemId: string; message: string }> = []
    for (const item of chosen as StoredInspection["items"]) {
      // Checked again now: the stored URL is ours, but DNS may have changed.
      const normalized = normalizeImportUrl(item.url)
      let ok = normalized.ok && isImportablePublicUrl(normalized.url)
      if (ok && normalized.ok) {
        ok = await assertPublicUrlResolvesOffHost(normalized.url).then(
          () => true,
          () => false,
        )
      }
      if (!ok || !normalized.ok) {
        rejected.push({ itemId: item.id, message: "This item points at a private or non-web address." })
        continue
      }
      // One output choice for the batch, applied only where it is possible:
      // video conversions to video items; everything else imports as it is.
      const format: ImportFormat =
        item.category === "video" ? { audioOnly, audioFormat, videoFormat } : {}
      try {
        const result = await createImport(request, {
          url: normalized.url,
          title: item.title ?? null,
          targetLibraryId,
          targetFolderId,
          format,
          requireSlot: false,
        })
        if (result.state !== "refused") accepted.push({ itemId: item.id, state: result.state, upload: serializeUpload(result.upload) })
      } catch (error) {
        request.log.warn({ err: error, itemId: item.id }, "batch import item could not be queued")
        rejected.push({ itemId: item.id, message: "This item could not be queued." })
      }
    }

    if (accepted.length === 0) {
      return sendError(reply, 400, "IMPORT_URL_BLOCKED", rejected[0]?.message ?? "Nothing could be imported.")
    }
    reply.status(202).send({ data: { accepted, rejected } })
  })
}
