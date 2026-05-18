import { access } from "node:fs/promises"

import type { FastifyInstance } from "fastify"

import { WORKER_HEARTBEAT_KEY } from "@arciin/shared"

import { apiConfig } from "@/config"

export async function registerHealthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async (_request, reply) => {
    let database = "online"
    let redis = "online"
    let realtime: "online" | "offline" = "online"
    let storage = "online"
    let worker: "online" | "offline" | "unknown" = "unknown"

    try {
      await fastify.prisma.$queryRaw`SELECT 1`
    } catch {
      database = "offline"
    }

    try {
      await fastify.redis.ping()
      realtime = "online"
      const heartbeat = await fastify.redis.get(WORKER_HEARTBEAT_KEY)

      if (heartbeat) {
        worker = Date.now() - Number(heartbeat) < 60_000 ? "online" : "offline"
      }
    } catch {
      redis = "offline"
      realtime = "offline"
      worker = "offline"
    }

    try {
      await access(apiConfig.dataDir)
    } catch {
      storage = "offline"
    }

    reply.send({
      data: {
        api: "online",
        database,
        redis,
        realtime,
        worker,
        storage,
        version: apiConfig.appVersion,
        timestamp: new Date().toISOString(),
      },
    })
  })
}
