import { nanoid } from "nanoid"
import type Redis from "ioredis"

import { SOCKET_EVENT_CHANNEL, type RealtimeEvent, type SocketEventType } from "@arciin/shared"

export function createRealtimeEvent(
  type: SocketEventType,
  input: Omit<RealtimeEvent, "id" | "type" | "createdAt">
): RealtimeEvent {
  return {
    id: nanoid(),
    type,
    createdAt: new Date().toISOString(),
    ...input,
  }
}

export async function publishRealtimeEvent(redis: Redis, event: RealtimeEvent) {
  await redis.publish(SOCKET_EVENT_CHANNEL, JSON.stringify(event))
}
