import { nanoid } from "nanoid"

import { type RealtimeEvent, type SocketEventType } from "@arciin/shared"

import { apiConfig } from "@/config"

export function buildRealtimeEvent(
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

export async function publishRealtimeEvent(
  publisher: { publish: (channel: string, message: string) => Promise<number> | number },
  event: RealtimeEvent
) {
  await publisher.publish(apiConfig.socketChannel, JSON.stringify(event))
}
