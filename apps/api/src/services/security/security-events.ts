import { isSecurityActivityType } from "@arciin/shared"
import type { FastifyInstance } from "fastify"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"

export function isSecurityLogType(type: string): boolean {
  return isSecurityActivityType(type)
}

export type SecurityEventMetadata = {
  clientIp?: string
  deviceLabel?: string
  userAgent?: string
  reason?: string
  path?: string
  status?: string
  actorUserId?: string
}

type RecordInput = {
  userId?: string
  type: string
  title: string
  message?: string
  metadata?: SecurityEventMetadata
}

/** Persist a security-relevant activity row (shown on /security → Security log). */
export async function recordSecurityEvent(
  fastify: Pick<FastifyInstance, "prisma" | "redis" | "publishRealtimeEvent">,
  input: RecordInput,
) {
  return recordAndBroadcastActivity(fastify, {
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    entityType: "security",
    metadata: input.metadata,
  })
}

const DEDUPE_WINDOW_SEC = 300

/** Avoid flooding the log when a client retries rapidly. */
export async function shouldRecordSecurityDedupe(
  redis: FastifyInstance["redis"],
  bucket: string,
  maxPerWindow = 1,
): Promise<boolean> {
  const key = `arciin:sec:event:${bucket}:${Math.floor(Date.now() / (DEDUPE_WINDOW_SEC * 1000))}`
  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, DEDUPE_WINDOW_SEC + 30)
  }
  return count <= maxPerWindow
}
