import type { ServerResponse } from "node:http"

/** Flush each SSE chunk so proxies and clients see tokens immediately. */
export function flushSseResponse(raw: ServerResponse) {
  const socket = raw.socket
  if (socket && !socket.destroyed) {
    socket.uncork?.()
  }
  const flushable = raw as ServerResponse & { flush?: () => void }
  if (typeof flushable.flush === "function") {
    flushable.flush()
  }
}

export function writeSseEvent(raw: ServerResponse, payload: Record<string, unknown>) {
  raw.write(`data: ${JSON.stringify(payload)}\n\n`)
  flushSseResponse(raw)
}
