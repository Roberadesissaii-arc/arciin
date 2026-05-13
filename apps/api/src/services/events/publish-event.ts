import { nanoid } from "nanoid"

import { SOCKET_EVENT_CHANNEL, type RealtimeEvent, type SocketEventType } from "@arciin/shared"

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
  await publisher.publish(SOCKET_EVENT_CHANNEL, JSON.stringify(event))
}
