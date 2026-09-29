import { parse } from "cookie"
import type { FastifyInstance } from "fastify"
import { Server } from "socket.io"

import { type RealtimeEvent } from "@arciin/shared"

import { apiConfig } from "@/config"
import { isCorsOriginAllowed } from "@/plugins/cors-origins"
import { emitRealtimeEvent } from "@/plugins/socket-emit"
import { hashApiKey, hashToken, scopeAllows } from "@/services/security/auth"

export async function registerSocket(fastify: FastifyInstance) {
  const instance = await fastify.prisma.instanceConfig.findFirst({ select: { id: true } })
  const cachedInstanceId = instance?.id ?? null

  const io = new Server(fastify.server, {
    cors: {
      origin(origin, callback) {
        if (!origin) {
          callback(null, true)
          return
        }
        // The same rule as every HTTP request (plugins/cors-origins.ts). This
        // used to be a separate list built once at boot: it froze whatever
        // public URL was stored then (often a quick-tunnel address long since
        // gone), trusted localhost:3000 even in production, accepted any LAN
        // origin whether or not the instance lives on a LAN, and ignored the
        // operator's extra origins — so a custom domain could sign in and
        // then never get realtime updates.
        if (isCorsOriginAllowed(origin)) {
          callback(null, true)
          return
        }
        callback(new Error("Origin not allowed"), false)
      },
      credentials: true,
    },
  })

  const subscriber = fastify.redis.duplicate()
  await subscriber.subscribe(apiConfig.socketChannel)

  subscriber.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message) as RealtimeEvent
      const enriched =
        cachedInstanceId && !event.instanceId
          ? { ...event, instanceId: cachedInstanceId }
          : event
      emitRealtimeEvent(io, enriched)
    } catch {
      fastify.log.warn("Could not parse realtime event payload.")
    }
  })

  io.use(async (socket, next) => {
    try {
      const cookies = parse(socket.handshake.headers.cookie || "")
      const sessionToken = cookies[apiConfig.SESSION_COOKIE_NAME]

      if (sessionToken) {
        const session = await fastify.prisma.session.findUnique({
          where: {
            tokenHash: hashToken(sessionToken),
          },
          include: {
            user: true,
          },
        })

        // Same three conditions as the Bearer branch below. The status check
        // used to be missing here, so suspending a user revoked their HTTP
        // access while their existing cookie kept a realtime socket open and
        // still receiving asset, job and activity events.
        if (
          session &&
          session.expiresAt >= new Date() &&
          session.user.status === "ACTIVE"
        ) {
          socket.data.user = session.user
          socket.data.session = session
          next()
          return
        }
      }

      const authHeader = socket.handshake.headers.authorization
      const authPayload = socket.handshake.auth as { token?: unknown } | undefined
      const bearerFromHeader =
        typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7).trim()
          : null
      const bearerFromAuth =
        typeof authPayload?.token === "string" ? authPayload.token.trim() : null
      const bearer = bearerFromHeader || bearerFromAuth

      if (bearer && !bearer.startsWith("arc_")) {
        const session = await fastify.prisma.session.findUnique({
          where: { tokenHash: hashToken(bearer) },
          include: { user: true },
        })
        if (
          session &&
          session.expiresAt >= new Date() &&
          session.user.status === "ACTIVE"
        ) {
          socket.data.user = session.user
          socket.data.session = session
          next()
          return
        }
      }

      if (bearer?.startsWith("arc_")) {
        const apiKey = await fastify.prisma.apiKey.findFirst({
          where: {
            keyHash: hashApiKey(bearer),
            revokedAt: null,
          },
          include: {
            user: true,
          },
        })

        if (
          apiKey &&
          apiKey.user.status === "ACTIVE" &&
          (!apiKey.expiresAt || apiKey.expiresAt >= new Date()) &&
          scopeAllows(apiKey.scopes, "events:subscribe")
        ) {
          socket.data.user = apiKey.user
          socket.data.session = null
          next()
          return
        }
      }

      next(new Error("Unauthenticated"))
    } catch (error) {
      next(error instanceof Error ? error : new Error("Socket auth failed"))
    }
  })

  // Resolve the instance id, preferring the value cached at registration to
  // avoid a DB round-trip on every socket connection. Only queries as a fallback
  // (e.g. the instance was claimed after the socket server started).
  const resolveInstanceId = async (): Promise<string | null> =>
    cachedInstanceId ?? (await fastify.prisma.instanceConfig.findFirst())?.id ?? null

  io.on("connection", async (socket) => {
    socket.join(`user:${socket.data.user.id}`)

    // OWNER/ADMIN get the instance-wide feed (all users' events). Auto-joined on
    // connect; the frontend also emits subscribe:instance-events as a safety net
    // (idempotent join), so a reconnect or a future refactor can't silently drop
    // the instance stream. Members keep only their own user-scoped events.
    const role = socket.data.user.role
    const isInstanceViewer = role === "OWNER" || role === "ADMIN"

    if (isInstanceViewer) {
      const instanceId = await resolveInstanceId()
      if (instanceId) await socket.join(`instance:${instanceId}`)
    }

    socket.on("subscribe:instance-events", async () => {
      if (!isInstanceViewer) return
      const instanceId = await resolveInstanceId()
      if (instanceId) await socket.join(`instance:${instanceId}`)
    })
  })

  fastify.decorate("io", io)
  fastify.decorate("publishRealtimeEvent", async (event: RealtimeEvent) => {
    await fastify.redis.publish(apiConfig.socketChannel, JSON.stringify(event))
  })

  fastify.addHook("onClose", async () => {
    await subscriber.quit()
    await io.close()
  })
}
