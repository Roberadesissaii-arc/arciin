import type { FastifyReply, FastifyRequest } from "fastify"

import { clientIpFromRequest } from "@/services/security/client-ip"

/**
 * Enforces a per-IP rate limit for a single endpoint using Redis.
 * Returns true (and sends a 429) if the limit is exceeded — the caller must return early.
 */
export async function checkEndpointRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: {
    /** Redis key prefix, e.g. "login" or "register" */
    key: string
    /** Max requests allowed in the window */
    limit: number
    /** Window size in seconds */
    windowSec: number
    /** Set false for buckets meant to cap requests across all clients, not per-IP. Default true. */
    perIp?: boolean
  },
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (opts.windowSec * 1_000))
  const redisKey =
    opts.perIp === false
      ? `arciin:rl:${opts.key}:${bucket}`
      : `arciin:rl:${opts.key}:${clientIpFromRequest(request)}:${bucket}`

  const count = await request.server.redis.incr(redisKey)
  if (count === 1) {
    await request.server.redis.expire(redisKey, opts.windowSec * 2)
  }

  if (count > opts.limit) {
    reply.status(429).send({
      error: {
        code: "RATE_LIMITED",
        message: `Too many requests. Try again in ${opts.windowSec} seconds.`,
        details: { retryAfterSeconds: opts.windowSec },
      },
    })
    return true
  }

  return false
}
