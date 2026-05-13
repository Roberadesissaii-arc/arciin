import { prisma } from "@arciin/database"
import type { FastifyInstance } from "fastify"

export async function registerPrisma(fastify: FastifyInstance) {
  fastify.decorate("prisma", prisma)

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect()
  })
}
