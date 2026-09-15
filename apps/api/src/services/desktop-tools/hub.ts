import { randomUUID } from "node:crypto"

import {
  ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION,
  DESKTOP_TOOL_EXPIRY_MS,
  DESKTOP_TOOL_MAX_ARGUMENT_BYTES,
  DESKTOP_TOOL_MAX_CONCURRENT_PER_DEVICE,
  DESKTOP_TOOL_REQUEST_EVENT,
  DESKTOP_TOOL_TIMEOUT_MS,
  type DesktopToolName,
} from "@arciin/config"
import {
  desktopOfflineToolError,
  desktopToolRequiresConfirmation,
  sanitizeDesktopToolResultPayload,
} from "@arciin/shared"
import type { DesktopToolErrorCode, DesktopToolRequest, DesktopToolResult } from "@arciin/types"
import type { Socket } from "socket.io"

type Pending = {
  tool: DesktopToolName
  deviceId: string
  resolve: (result: DesktopToolResult) => void
  timer: ReturnType<typeof setTimeout>
  expiresAt: number
}

export type DesktopToolChannel = {
  socket: Socket
  deviceId: string
  protocolVersion: number
  connectedAt: number
}

export class DesktopToolHub {
  private readonly channels = new Map<string, DesktopToolChannel>()
  private readonly pending = new Map<string, Pending>()
  private readonly pendingByDevice = new Map<string, Set<string>>()

  isConnected(deviceId: string): boolean {
    return this.channels.has(deviceId)
  }

  protocolVersion(deviceId: string): number | null {
    return this.channels.get(deviceId)?.protocolVersion ?? null
  }

  connectedDeviceIds(): string[] {
    return [...this.channels.keys()]
  }

  register(channel: DesktopToolChannel): { replaced: boolean } {
    const existing = this.channels.get(channel.deviceId)
    let replaced = false
    if (existing && existing.socket.id !== channel.socket.id) {
      existing.socket.emit("desktop.channel.replaced", { reason: "duplicate_channel" })
      existing.socket.disconnect(true)
      replaced = true
    }
    this.channels.set(channel.deviceId, channel)
    return { replaced }
  }

  unregister(deviceId: string, socketId?: string) {
    const current = this.channels.get(deviceId)
    if (!current) return
    if (socketId && current.socket.id !== socketId) return
    this.channels.delete(deviceId)
    this.failDevice(deviceId, "DESKTOP_OFFLINE", "The Desktop disconnected.")
  }

  disconnectDevice(deviceId: string, reason: DesktopToolErrorCode = "DESKTOP_OFFLINE") {
    const channel = this.channels.get(deviceId)
    if (channel) {
      channel.socket.disconnect(true)
      this.channels.delete(deviceId)
    }
    this.failDevice(deviceId, reason, "This device is no longer trusted.")
  }

  async dispatch(input: {
    deviceId: string
    conversationId: string | null
    tool: DesktopToolName
    arguments: Record<string, unknown>
  }): Promise<DesktopToolResult> {
    const channel = this.channels.get(input.deviceId)
    if (!channel) {
      const offline = desktopOfflineToolError()
      return {
        requestId: "",
        status: "error",
        error: { code: offline.error, message: offline.message },
        completedAt: new Date().toISOString(),
      }
    }
    if (channel.protocolVersion !== ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION) {
      return {
        requestId: "",
        status: "error",
        error: {
          code: "DESKTOP_TOOL_UNSUPPORTED",
          message: "This PC tools are not available on that Desktop version.",
        },
        completedAt: new Date().toISOString(),
      }
    }

    const inflight = this.pendingByDevice.get(input.deviceId)?.size ?? 0
    if (inflight >= DESKTOP_TOOL_MAX_CONCURRENT_PER_DEVICE) {
      return {
        requestId: "",
        status: "error",
        error: {
          code: "DESKTOP_TOOL_DENIED",
          message: "This PC already has too many tool requests in flight.",
        },
        completedAt: new Date().toISOString(),
      }
    }

    let argumentBytes = 0
    try {
      argumentBytes = Buffer.byteLength(JSON.stringify(input.arguments), "utf8")
    } catch {
      argumentBytes = Number.POSITIVE_INFINITY
    }
    if (argumentBytes > DESKTOP_TOOL_MAX_ARGUMENT_BYTES) {
      return {
        requestId: "",
        status: "error",
        error: { code: "DESKTOP_RESULT_INVALID", message: "The tool arguments were too large." },
        completedAt: new Date().toISOString(),
      }
    }

    const id = randomUUID()
    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + DESKTOP_TOOL_EXPIRY_MS)
    const request: DesktopToolRequest = {
      id,
      version: ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION,
      deviceId: input.deviceId,
      conversationId: input.conversationId,
      tool: input.tool,
      arguments: input.arguments,
      confirmation: desktopToolRequiresConfirmation(input.tool) ? "required" : "none",
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }

    const result = await new Promise<DesktopToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.pendingByDevice.get(input.deviceId)?.delete(id)
        resolve({
          requestId: id,
          status: "error",
          error: {
            code: "DESKTOP_TOOL_TIMEOUT",
            message: "This PC did not answer in time.",
          },
          completedAt: new Date().toISOString(),
        })
      }, DESKTOP_TOOL_TIMEOUT_MS)
      this.pending.set(id, {
        tool: input.tool,
        deviceId: input.deviceId,
        resolve,
        timer,
        expiresAt: expiresAt.getTime(),
      })
      const set = this.pendingByDevice.get(input.deviceId) ?? new Set<string>()
      set.add(id)
      this.pendingByDevice.set(input.deviceId, set)
      channel.socket.emit(DESKTOP_TOOL_REQUEST_EVENT, request)
    })

    return result
  }

  complete(raw: DesktopToolResult) {
    const pending = this.pending.get(raw.requestId)
    if (!pending) return
    if (Date.now() > pending.expiresAt) {
      this.pending.delete(raw.requestId)
      this.pendingByDevice.get(pending.deviceId)?.delete(raw.requestId)
      clearTimeout(pending.timer)
      pending.resolve({
        requestId: raw.requestId,
        status: "error",
        error: {
          code: "DESKTOP_REQUEST_EXPIRED",
          message: "That This PC request expired and will not run later.",
        },
        completedAt: new Date().toISOString(),
      })
      return
    }

    let result = raw
    if (raw.status === "ok") {
      const sanitized = sanitizeDesktopToolResultPayload(raw.result, pending.tool)
      if (!sanitized.ok) {
        result = {
          requestId: raw.requestId,
          status: "error",
          error: { code: sanitized.code, message: sanitized.message },
          completedAt: new Date().toISOString(),
        }
      } else {
        result = { ...raw, result: sanitized.result }
      }
    }

    clearTimeout(pending.timer)
    this.pending.delete(raw.requestId)
    this.pendingByDevice.get(pending.deviceId)?.delete(raw.requestId)
    pending.resolve(result)
  }

  cancelConversation(conversationId: string) {
    void conversationId
    // Requests carry conversationId for Desktop; in-flight waiters still time out.
  }

  private failDevice(deviceId: string, code: DesktopToolErrorCode, message: string) {
    const ids = [...(this.pendingByDevice.get(deviceId) ?? [])]
    this.pendingByDevice.delete(deviceId)
    for (const id of ids) {
      const pending = this.pending.get(id)
      if (!pending) continue
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.resolve({
        requestId: id,
        status: "error",
        error: { code, message },
        completedAt: new Date().toISOString(),
      })
    }
  }
}

let singleton: DesktopToolHub | null = null

export function getDesktopToolHub(): DesktopToolHub {
  if (!singleton) singleton = new DesktopToolHub()
  return singleton
}

/** Tests replace the process-wide hub. */
export function resetDesktopToolHub(next = new DesktopToolHub()): DesktopToolHub {
  singleton = next
  return next
}
