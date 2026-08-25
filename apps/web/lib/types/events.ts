import { SOCKET_EVENT_TYPES, type SocketEventType } from "@arciin/types"

export type SocketEventPayload = {
  id: string
  type: string
  userId?: string
  instanceId?: string
  libraryId?: string
  uploadId?: string
  assetId?: string
  jobId?: string
  progress?: number
  message?: string
  data?: Record<string, unknown>
  createdAt: string
}

/**
 * Every realtime event the browser subscribes to.
 *
 * Re-exported from the shared package rather than restated here. This file used
 * to keep its own copy, and the copy fell behind: the worker was publishing
 * `asset.transcript.ready`, nothing in the browser was listening for it, and a
 * card kept spinning over a transcript that had already finished until someone
 * reloaded the page. A second list is a second thing to forget.
 *
 * Anything a client should react to belongs in SOCKET_EVENT_TYPES.
 */
export const socketEventTypes = SOCKET_EVENT_TYPES

export type { SocketEventType }
