import { nanoid } from "nanoid"
import type Redis from "ioredis"

import { type RealtimeEvent, type SocketEventType } from "@arciin/shared"

import { workerConfig } from "@/config"

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
  await redis.publish(workerConfig.socketChannel, JSON.stringify(event))
}
