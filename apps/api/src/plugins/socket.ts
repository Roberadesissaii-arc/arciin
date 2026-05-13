import { parse } from "cookie"
import type { FastifyInstance } from "fastify"
import { Server } from "socket.io"

import { SOCKET_EVENT_CHANNEL, type RealtimeEvent } from "@arciin/shared"

import { apiConfig } from "@/config"
import { hashToken } from "@/services/security/auth"

function emitRealtimeEvent(io: Server, event: RealtimeEvent) {
  let emitted = false

  if (event.userId) {
    io.to(`user:${event.userId}`).emit(event.type, event)
    emitted = true
  }

  if (event.libraryId) {
    io.to(`library:${event.libraryId}`).emit(event.type, event)
    emitted = true
  }

  if (event.uploadId) {
    io.to(`upload:${event.uploadId}`).emit(event.type, event)
    emitted = true
  }

  if (event.jobId) {
    io.to(`job:${event.jobId}`).emit(event.type, event)
    emitted = true
  }

  if (!emitted) {
    io.emit(event.type, event)
  }
}

export async function registerSocket(fastify: FastifyInstance) {
  const io = new Server(fastify.server, {
    cors: {
      origin: apiConfig.ARCIIN_PUBLIC_URL,
      credentials: true,
    },
  })

  const subscriber = fastify.redis.duplicate()
  await subscriber.subscribe(SOCKET_EVENT_CHANNEL)

  subscriber.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message) as RealtimeEvent
      emitRealtimeEvent(io, event)
    } catch {
      fastify.log.warn("Could not parse realtime event payload.")
    }
  })

  io.use(async (socket, next) => {
    try {
      const cookies = parse(socket.handshake.headers.cookie || "")
      const token = cookies[apiConfig.SESSION_COOKIE_NAME]

      if (!token) {
        next(new Error("Unauthenticated"))
        return
      }

      const session = await fastify.prisma.session.findUnique({
        where: {
          tokenHash: hashToken(token),
        },
        include: {
          user: true,
        },
      })

      if (!session || session.expiresAt < new Date()) {
        next(new Error("Unauthenticated"))
        return
      }

      socket.data.user = session.user
      socket.data.session = session
      next()
    } catch (error) {
      next(error instanceof Error ? error : new Error("Socket auth failed"))
    }
  })

  io.on("connection", async (socket) => {
    const instance = await fastify.prisma.instanceConfig.findFirst()

    socket.join(`user:${socket.data.user.id}`)

    if (instance) {
      socket.join(`instance:${instance.id}`)
    }
  })

  fastify.decorate("io", io)
  fastify.decorate("publishRealtimeEvent", async (event: RealtimeEvent) => {
    await fastify.redis.publish(SOCKET_EVENT_CHANNEL, JSON.stringify(event))
  })

  fastify.addHook("onClose", async () => {
    await subscriber.quit()
    await io.close()
  })
}
