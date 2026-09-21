import {
  ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION,
  DESKTOP_TOOL_RESULT_EVENT,
  DESKTOP_TOOL_SOCKET_PATH,
} from "@arciin/config"
import type { FastifyInstance } from "fastify"
import type { Server } from "socket.io"

import { findActiveDeviceByCredential, touchDeviceLastSeen } from "@/services/devices/pairing"
import { getDesktopToolHub } from "@/services/desktop-tools/hub"

function extractDeviceCredential(handshake: {
  headers: { authorization?: string }
  auth?: unknown
}): string | null {
  const header = handshake.headers.authorization
  if (typeof header === "string") {
    const match = header.match(/^Device\s+(.+)$/i)
    if (match?.[1]?.trim()) return match[1].trim()
  }
  const auth = handshake.auth as { deviceCredential?: unknown; protocolVersion?: unknown } | undefined
  if (typeof auth?.deviceCredential === "string" && auth.deviceCredential.trim()) {
    return auth.deviceCredential.trim()
  }
  return null
}

function extractProtocolVersion(handshake: { auth?: unknown }): number {
  const auth = handshake.auth as { protocolVersion?: unknown } | undefined
  const raw = auth?.protocolVersion
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION
}

export function attachDesktopToolNamespace(io: Server, fastify: FastifyInstance) {
  const nsp = io.of(DESKTOP_TOOL_SOCKET_PATH)
  const hub = () => getDesktopToolHub()

  nsp.use(async (socket, next) => {
    try {
      const credential = extractDeviceCredential(socket.handshake)
      if (!credential) {
        next(new Error("Unauthenticated"))
        return
      }
      const device = await findActiveDeviceByCredential(fastify.prisma, credential)
      socket.data.desktopDevice = device
      socket.data.desktopProtocolVersion = extractProtocolVersion(socket.handshake)
      next()
    } catch (error) {
      next(error instanceof Error ? error : new Error("Device auth failed"))
    }
  })

  nsp.on("connection", (socket) => {
    const device = socket.data.desktopDevice
    if (!device) {
      socket.disconnect(true)
      return
    }
    hub().register({
      socket,
      deviceId: device.id,
      protocolVersion: socket.data.desktopProtocolVersion ?? ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION,
      connectedAt: Date.now(),
    })
    void touchDeviceLastSeen(fastify.prisma, device.id, device.lastSeenAt)
    socket.join(`desktop-tools:${device.id}`)

    socket.on(DESKTOP_TOOL_RESULT_EVENT, (payload: unknown) => {
      if (!payload || typeof payload !== "object") return
      const body = payload as {
        requestId?: unknown
        status?: unknown
        result?: unknown
        error?: { code?: unknown; message?: unknown }
        completedAt?: unknown
      }
      if (typeof body.requestId !== "string" || !body.requestId) return
      const status = body.status === "ok" || body.status === "denied" ? body.status : "error"
      hub().complete({
        requestId: body.requestId,
        status,
        result: body.result,
        error:
          body.error && typeof body.error.code === "string"
            ? {
                code: body.error.code as never,
                message: typeof body.error.message === "string" ? body.error.message : "Denied.",
              }
            : undefined,
        completedAt:
          typeof body.completedAt === "string" ? body.completedAt : new Date().toISOString(),
      })
    })

    socket.on("disconnect", () => {
      hub().unregister(device.id, socket.id)
    })
  })
}
