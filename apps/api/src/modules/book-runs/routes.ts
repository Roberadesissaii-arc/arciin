/**
 * Book run state, shared across a user's sessions.
 *
 * Execution still happens in one browser. What lives here is everything the
 * *other* sessions need to see it: status, progress, the manuscript, and who
 * currently owns generation.
 *
 * Two rules shape the whole file:
 *
 * 1. Only the lease holder may write progress. Otherwise a second computer
 *    opening the conversation could report its own (empty) view over the real
 *    one, and the run would appear to go backwards.
 * 2. Every route scopes by `userId`. A conversation id is guessable, and a book
 *    is someone's private writing.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { requireSessionRole } from "@/services/security/auth"

/** How long a claim survives without a heartbeat. */
export const LEASE_TTL_MS = 45_000

const RUN_STATUSES = [
  "PLANNING",
  "THINKING",
  "WRITING",
  "VALIDATING",
  "SAVING",
  "PAUSED",
  "INTERRUPTED",
  "FAILED",
  "COMPLETED",
] as const

/** Statuses that mean work is meant to be happening right now. */
const ACTIVE_STATUSES = ["PLANNING", "THINKING", "WRITING", "VALIDATING", "SAVING"] as const

type RunRow = {
  id: string
  conversationId: string
  title: string
  status: string
  totalChapters: number
  writtenChapters: number
  currentChapter: number
  currentChapterTitle: string | null
  manuscript: string | null
  error: string | null
  executorSessionId: string | null
  leaseExpiresAt: Date | null
  startedAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

function leaseIsLive(run: { leaseExpiresAt: Date | null }): boolean {
  return Boolean(run.leaseExpiresAt && run.leaseExpiresAt.getTime() > Date.now())
}

/**
 * The run as a client should see it.
 *
 * `manuscript` is omitted from list responses on purpose — the sidebar needs a
 * title and two numbers, not fifty thousand words per active book.
 */
function serializeRun(run: RunRow, viewerSessionId: string | null, includeManuscript: boolean) {
  const live = leaseIsLive(run)
  const isExecutor = live && Boolean(viewerSessionId) && run.executorSessionId === viewerSessionId

  return {
    id: run.id,
    conversationId: run.conversationId,
    title: run.title,
    /**
     * An active status whose lease has lapsed is reported as interrupted.
     *
     * Derived on read rather than written by a sweeper: the executor is the
     * only thing that can refresh a lease, so a stale one is already proof it
     * is gone, and a reader must never be shown "Writing chapter 4…" for a
     * browser that closed twenty minutes ago.
     */
    status:
      !live && (ACTIVE_STATUSES as readonly string[]).includes(run.status)
        ? "INTERRUPTED"
        : run.status,
    totalChapters: run.totalChapters,
    writtenChapters: run.writtenChapters,
    currentChapter: run.currentChapter,
    currentChapterTitle: run.currentChapterTitle,
    error: run.error,
    /** True when *this* session owns generation. Only it may generate. */
    isExecutor,
    /** True when someone else is writing — the observer badge. */
    executedElsewhere: live && !isExecutor,
    startedAt: run.startedAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    ...(includeManuscript ? { manuscript: run.manuscript ?? "" } : {}),
  }
}

/**
 * A stable id for this browser session.
 *
 * The auth session id is exactly right: it survives navigation and reloads in
 * one browser, and differs between two computers signed into the same account —
 * which is the distinction the lease exists to make.
 */
function sessionIdOf(request: FastifyRequest): string | null {
  return request.auth?.session?.id ?? null
}

export async function bookRunRoutes(fastify: FastifyInstance) {
  const guard = [requireSessionRole(["OWNER", "ADMIN", "MEMBER"])]

  async function loadOwnRun(
    request: FastifyRequest,
    reply: FastifyReply,
    conversationId: string,
  ): Promise<RunRow | null | "denied"> {
    const conversation = await fastify.prisma.chatConversation.findFirst({
      where: { id: conversationId, userId: request.auth!.user.id },
      select: { id: true },
    })
    if (!conversation) {
      // Same answer whether it does not exist or belongs to someone else.
      reply.status(404).send({ error: { code: "NOT_FOUND", message: "Conversation not found." } })
      return "denied"
    }
    return (await fastify.prisma.bookRun.findUnique({ where: { conversationId } })) as RunRow | null
  }

  /** Every run currently worth showing — drives the sidebar and History. */
  fastify.get("/book-runs", { preHandler: guard }, async (request, reply) => {
    const viewer = sessionIdOf(request)
    const runs = (await fastify.prisma.bookRun.findMany({
      where: { userId: request.auth!.user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      // Deliberately no manuscript column: this is polled.
      select: {
        id: true,
        conversationId: true,
        title: true,
        status: true,
        totalChapters: true,
        writtenChapters: true,
        currentChapter: true,
        currentChapterTitle: true,
        error: true,
        executorSessionId: true,
        leaseExpiresAt: true,
        startedAt: true,
        updatedAt: true,
        finishedAt: true,
      },
    })) as unknown as RunRow[]

    reply.send({
      data: { runs: runs.map((r) => serializeRun(r, viewer, false)) },
    })
  })

  /** One run, with its manuscript — what a conversation page needs. */
  fastify.get(
    "/conversations/:conversationId/book-run",
    { preHandler: guard },
    async (request, reply) => {
      const { conversationId } = z
        .object({ conversationId: z.string() })
        .parse(request.params)
      const run = await loadOwnRun(request, reply, conversationId)
      if (run === "denied") return
      reply.send({
        data: { run: run ? serializeRun(run, sessionIdOf(request), true) : null },
      })
    },
  )

  /**
   * Publish progress, and claim or refresh the lease.
   *
   * Called by the executing browser at real transitions — a chapter starting,
   * validating, landing — never per token.
   */
  fastify.put(
    "/conversations/:conversationId/book-run",
    { preHandler: guard },
    async (request, reply) => {
      const { conversationId } = z.object({ conversationId: z.string() }).parse(request.params)
      const parsed = z
        .object({
          title: z.string().max(300).optional(),
          status: z.enum(RUN_STATUSES),
          totalChapters: z.number().int().min(0).max(1000).optional(),
          writtenChapters: z.number().int().min(0).max(1000).optional(),
          currentChapter: z.number().int().min(0).max(1000).optional(),
          currentChapterTitle: z.string().max(300).nullable().optional(),
          manuscript: z.string().max(8_000_000).optional(),
          error: z.string().max(4000).nullable().optional(),
          /** Ask to own generation. Refused while someone else's lease is live. */
          claim: z.boolean().optional(),
        })
        .safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Invalid book run payload." },
        })
        return
      }

      const existing = await loadOwnRun(request, reply, conversationId)
      if (existing === "denied") return

      const viewer = sessionIdOf(request)
      if (!viewer) {
        reply.status(401).send({
          error: { code: "UNAUTHENTICATED", message: "A session is required." },
        })
        return
      }

      /**
       * Refuse a write from a session that does not own the run.
       *
       * This is the cross-device single-flight guarantee at its narrowest
       * point: an observer that somehow tried to report progress would
       * otherwise overwrite the executor's state with its own.
       */
      if (existing && leaseIsLive(existing) && existing.executorSessionId !== viewer) {
        reply.status(409).send({
          error: {
            code: "NOT_EXECUTOR",
            message: "Another session is currently writing this book.",
            details: { executedElsewhere: true },
          },
        })
        return
      }

      const body = parsed.data
      const takesLease = body.claim !== false && (ACTIVE_STATUSES as readonly string[]).includes(body.status)
      const settled = ["COMPLETED", "FAILED", "PAUSED", "INTERRUPTED"].includes(body.status)

      const lease = takesLease
        ? { executorSessionId: viewer, leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS) }
        : // A settled run releases generation, so any session may pick it up.
          { executorSessionId: null, leaseExpiresAt: null }

      const run = (await fastify.prisma.bookRun.upsert({
        where: { conversationId },
        create: {
          userId: request.auth!.user.id,
          conversationId,
          title: body.title ?? "Untitled book",
          status: body.status,
          totalChapters: body.totalChapters ?? 0,
          writtenChapters: body.writtenChapters ?? 0,
          currentChapter: body.currentChapter ?? 1,
          currentChapterTitle: body.currentChapterTitle ?? null,
          manuscript: body.manuscript ?? null,
          error: body.error ?? null,
          ...lease,
        },
        update: {
          ...(body.title ? { title: body.title } : {}),
          status: body.status,
          ...(body.totalChapters !== undefined ? { totalChapters: body.totalChapters } : {}),
          ...(body.writtenChapters !== undefined ? { writtenChapters: body.writtenChapters } : {}),
          ...(body.currentChapter !== undefined ? { currentChapter: body.currentChapter } : {}),
          ...(body.currentChapterTitle !== undefined
            ? { currentChapterTitle: body.currentChapterTitle }
            : {}),
          // Never overwrite a stored manuscript with nothing: a caller that
          // omits it is reporting status, not deleting the book.
          ...(body.manuscript !== undefined && body.manuscript.length > 0
            ? { manuscript: body.manuscript }
            : {}),
          error: body.error ?? null,
          ...(settled ? { finishedAt: new Date() } : { finishedAt: null }),
          ...lease,
        },
      })) as unknown as RunRow

      reply.send({ data: { run: serializeRun(run, viewer, false) } })
    },
  )

  /**
   * Keep the lease alive.
   *
   * Separate from the progress write because it happens on a timer while a
   * single chapter streams for minutes, and it must stay cheap: no manuscript,
   * no status, one timestamp.
   */
  fastify.post(
    "/conversations/:conversationId/book-run/heartbeat",
    { preHandler: guard },
    async (request, reply) => {
      const { conversationId } = z.object({ conversationId: z.string() }).parse(request.params)
      const existing = await loadOwnRun(request, reply, conversationId)
      if (existing === "denied") return

      const viewer = sessionIdOf(request)
      if (!existing || !viewer) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "No run to refresh." } })
        return
      }
      if (leaseIsLive(existing) && existing.executorSessionId !== viewer) {
        reply.status(409).send({
          error: { code: "NOT_EXECUTOR", message: "Another session owns this run." },
        })
        return
      }

      const run = (await fastify.prisma.bookRun.update({
        where: { conversationId },
        data: {
          executorSessionId: viewer,
          leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS),
        },
      })) as unknown as RunRow

      reply.send({ data: { run: serializeRun(run, viewer, false) } })
    },
  )
}
