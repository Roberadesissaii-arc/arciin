import type { FastifyReply, FastifyRequest } from "fastify"

import { loadApiProtectionSettings } from "@/services/security/instance-security"

function currentMinuteBucket(): string {
  return String(Math.floor(Date.now() / 60_000))
}

async function incrementRate(
  redis: import("ioredis").default,
  key: string,
): Promise<number> {
  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, 120)
  }
  return count
}

/** Call after API key auth succeeds. Returns false if rate limited (reply already sent). */
export async function enforceApiKeyRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const keyId = request.auth?.apiKeyId
  if (!keyId) return true

  const settings = await loadApiProtectionSettings(request.server.prisma)
  if (settings.apiKeyRequestsPerMinute <= 0) return true

  const minute = currentMinuteBucket()
  const redisKey = `arciin:rpm:key:${keyId}:${minute}`
  const count = await incrementRate(request.server.redis, redisKey)

  if (count > settings.apiKeyRequestsPerMinute) {
    reply.status(429).send({
      error: {
        code: "RATE_LIMITED",
        message: `API key rate limit exceeded (${settings.apiKeyRequestsPerMinute} requests per minute).`,
      },
    })
    return false
  }

  return true
}
