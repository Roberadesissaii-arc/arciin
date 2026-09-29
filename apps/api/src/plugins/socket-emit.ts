import type { Server } from "socket.io"

import type { RealtimeEvent } from "@arciin/shared"

/** Deliver one realtime event to the rooms it names. Kept apart from the socket server so it can be tested alone. */
export function emitRealtimeEvent(io: Pick<Server, "to" | "emit">, event: RealtimeEvent) {
  if (event.audience === "user") {
    // Private to one user; never falls through to a broadcast.
    if (event.userId) io.to(`user:${event.userId}`).emit(event.type, event)
    return
  }

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

  if (event.instanceId) {
    io.to(`instance:${event.instanceId}`).emit(event.type, event)
    emitted = true
  }

  if (!emitted) {
    io.emit(event.type, event)
  }
}
