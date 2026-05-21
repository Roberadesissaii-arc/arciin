import type { FastifyInstance } from "fastify"

import { buildRealtimeEvent } from "@/services/events/publish-event"

import { recordActivity } from "./record-activity"

type ActivityInput = Parameters<typeof recordActivity>[1]

export async function recordAndBroadcastActivity(
  fastify: Pick<FastifyInstance, "prisma"> & {
    publishRealtimeEvent?: FastifyInstance["publishRealtimeEvent"]
  },
  input: ActivityInput,
) {
  const row = await recordActivity(fastify.prisma, input)

  if (!fastify.publishRealtimeEvent) {
    return row
  }

  await fastify.publishRealtimeEvent(
    buildRealtimeEvent("activity.created", {
      userId: input.userId,
      message: input.message,
      data: {
        type: input.type,
        title: input.title,
        activityId: row.id,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.metadata ?? {}),
      },
    }),
  )

  return row
}
