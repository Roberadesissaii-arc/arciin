import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { authenticate } from "@/services/security/auth"

/**
 * Notifications, backed by the server.
 *
 * The inbox used to live entirely in localStorage. It vanished when browser
 * data was cleared, never reached a second device, and could not be
 * authoritative about anything — a hard refresh only re-read the same local
 * file, which is why refreshing appeared to "fix" a disagreeing badge.
 *
 * An inbox item is an ActivityEvent plus whether this user has seen it. The
 * event body is not copied: duplicating the title and message would create a
 * second thing to keep correct, and ActivityEvent is already the durable
 * record.
 *
 * Read state has two parts. `notificationsReadThrough` is a cursor, so "mark
 * all read" is one write rather than a row per event — including for events
 * this client has never loaded. NotificationRead rows cover anything read
 * individually after that cursor.
 */

/** Keys whose values are never worth showing in an inbox. */
const SENSITIVE_KEYS = new Set([
  "token", "rawKey", "apiKey", "key", "secret", "password", "passwordHash",
  "keyHash", "tokenHash", "mfaSecret", "mfaSecretEnc", "recoveryCode",
  "recoveryCodes", "totp", "sessionToken", "databaseUrl",
])

/**
 * Activity metadata is written by many call sites. Rather than trusting every
 * one of them, anything that looks like a credential is dropped on the way
 * out — by name, by pattern, and by refusing nested objects outright.
 */
export function sanitizeNotificationMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue
    if (/(token|secret|password|passphrase|credential|apikey|hash)/i.test(key)) continue
    // A nested object can hide anything; the inbox has no use for one.
    if (typeof value === "object" && value !== null) continue
    safe[key] = value
  }
  return Object.keys(safe).length ? safe : null
}

export function notificationVariantForType(
  type: string,
): "default" | "success" | "error" | "warning" {
  if (/fail|error|denied|revoked|disabled/i.test(type)) return "error"
  if (/warn|expir|stale/i.test(type)) return "warning"
  if (/complete|success|ready|created|enabled/i.test(type)) return "success"
  return "default"
}

export async function registerNotificationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: authenticate }

  fastify.get("/notifications", auth, async (request, reply) => {
    if (!request.auth) return
    const userId = request.auth.user.id
    const limit = Math.min(Number((request.query as { limit?: string })?.limit ?? 50) || 50, 200)

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationsReadThrough: true },
    })
    const readThrough = user?.notificationsReadThrough ?? null

    // Instance-wide events (userId null) are addressed to whoever is looking.
    const where = { OR: [{ userId }, { userId: null }] }

    const events = await fastify.prisma.activityEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, type: true, title: true, message: true, metadata: true, createdAt: true },
    })

    const reads = await fastify.prisma.notificationRead.findMany({
      where: { userId, activityEventId: { in: events.map((e) => e.id) } },
      select: { activityEventId: true },
    })
    const readIds = new Set(reads.map((r) => r.activityEventId))

    /**
     * Counted against the whole table, not the page returned above, so the
     * badge does not depend on how much of the inbox happens to be loaded.
     * That is the mistake the file counts were making.
     */
    const unreadCount = await fastify.prisma.activityEvent.count({
      where: {
        ...where,
        ...(readThrough ? { createdAt: { gt: readThrough } } : {}),
        NOT: { notificationReads: { some: { userId } } },
      },
    })

    reply.send({
      data: {
        items: events.map((event) => ({
          id: event.id,
          title: event.title,
          message: event.message ?? undefined,
          variant: notificationVariantForType(event.type),
          source: "activity" as const,
          createdAt: event.createdAt.toISOString(),
          read:
            readIds.has(event.id) || (readThrough !== null && event.createdAt <= readThrough),
          metadata: sanitizeNotificationMetadata(event.metadata),
        })),
        unreadCount,
      },
    })
  })

  const readParams = z.object({ id: z.string().min(1) })

  fastify.patch("/notifications/:id/read", auth, async (request, reply) => {
    if (!request.auth) return
    const parsed = readParams.safeParse(request.params)
    if (!parsed.success) {
      reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid id." } })
      return
    }
    const userId = request.auth.user.id

    // Scoped to events this user can see, so an id belonging to somebody else
    // cannot be marked — or probed for existence.
    const event = await fastify.prisma.activityEvent.findFirst({
      where: { id: parsed.data.id, OR: [{ userId }, { userId: null }] },
      select: { id: true },
    })
    if (!event) {
      reply.status(404).send({ error: { code: "NOT_FOUND", message: "No such notification." } })
      return
    }

    await fastify.prisma.notificationRead.upsert({
      where: { userId_activityEventId: { userId, activityEventId: event.id } },
      create: { userId, activityEventId: event.id },
      update: {},
    })
    reply.send({ data: { read: true } })
  })

  fastify.post("/notifications/mark-all-read", auth, async (request, reply) => {
    if (!request.auth) return
    await fastify.prisma.user.update({
      where: { id: request.auth.user.id },
      data: { notificationsReadThrough: new Date() },
    })
    reply.send({ data: { unreadCount: 0 } })
  })
}
