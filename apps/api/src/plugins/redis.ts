import type { FastifyInstance } from "fastify"
import Redis from "ioredis"

import { apiConfig } from "@/config"

export async function registerRedis(fastify: FastifyInstance) {
  const redis = new Redis(apiConfig.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  fastify.decorate("redis", redis)

  fastify.addHook("onClose", async () => {
    await redis.quit()
  })
}
