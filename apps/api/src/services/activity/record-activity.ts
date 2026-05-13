import type { Prisma, PrismaClient } from "@prisma/client"

export async function recordActivity(
  prisma: PrismaClient,
  input: {
    userId?: string
    type: string
    title: string
    message?: string
    entityType?: string
    entityId?: string
    metadata?: Record<string, unknown>
  }
) {
  return prisma.activityEvent.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  })
}
