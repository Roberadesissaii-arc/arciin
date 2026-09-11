import type { FastifyInstance } from "fastify"
import Redis from "ioredis"

import {
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_CONNECT_TIMEOUT_MS,
  redisRetryDelayMs,
} from "@arciin/shared"

import { apiConfig } from "@/config"

/**
 * The API's general-purpose Redis client — rate limiting, login lockout,
 * security-event dedupe and the health probe.
 *
 * This is deliberately *not* configured like a BullMQ connection. BullMQ needs
 * `maxRetriesPerRequest: null` because its workers park on blocking reads that
 * must not be cancelled; this client issues ordinary short commands, and that
 * setting turned every one of them into an unbounded wait whenever Redis was
 * unreachable. Sign-in and `/api/health` hung indefinitely rather than failing
 * (ARC-002), which left the instance looking frozen and left Docker unable to
 * see anything wrong.
 *
 * Commands now fail fast, and the connection still heals itself when Redis
 * comes back — callers are responsible for turning a rejection into a sensible
 * answer rather than a stack trace.
 */
export async function registerRedis(fastify: FastifyInstance) {
  const redis = new Redis(apiConfig.REDIS_URL, {
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    // Finite, unlike a BullMQ connection: a command that cannot be delivered
    // has to reject so the request handler can decide what to do about it.
    maxRetriesPerRequest: 1,
    retryStrategy: redisRetryDelayMs,
  })

  // ioredis emits `error` on every failed reconnect. Without a listener Node
  // treats it as an unhandled error event; with a noisy one the log fills up
  // for as long as the outage lasts. Record the state transition instead.
  let reportedDown = false
  redis.on("error", (error: Error) => {
    if (reportedDown) return
    reportedDown = true
    fastify.log.error({ err: error }, "Redis connection lost")
  })
  redis.on("ready", () => {
    if (!reportedDown) return
    reportedDown = false
    fastify.log.info("Redis connection restored")
  })

  fastify.decorate("redis", redis)

  fastify.addHook("onClose", async () => {
    await redis.quit()
  })
}
