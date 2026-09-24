import type { FastifyReply, FastifyRequest } from "fastify"

import { clientIpFromRequest } from "@/services/security/client-ip"
import { loadApiProtectionSettings } from "@/services/security/instance-security"
import {
  recordSecurityEvent,
  shouldRecordSecurityDedupe,
} from "@/services/security/security-events"

/**
 * Baseline for keys created from v1.1.0 on.
 *
 * Ten a second, sustained, is far above what a menu app, a sync script, or a
 * home-automation hook does, and far below what it takes to hammer the
 * server. A caller can ask for a different number when creating the key.
 */
export const DEFAULT_API_KEY_RATE_LIMIT_PER_MINUTE = 600

/**
 * The limit that applies to one key: the stricter of its own and the
 * instance-wide one. A null key limit is a key created before per-key limits
 * existed — only the instance limit applies, and none at all when the owner has
 * not set one, which is how those keys behaved before.
 */
export function resolveEffectiveKeyLimit(
  keyLimit: number | null | undefined,
  instanceLimit: number,
): number | null {
  const limits = [keyLimit, instanceLimit > 0 ? instanceLimit : null].filter(
    (n): n is number => typeof n === "number" && n > 0,
  )
  return limits.length ? Math.min(...limits) : null
}

function currentMinuteBucket(now: number): number {
  return Math.floor(now / 60_000)
}

async function incrementRate(redis: import("ioredis").default, key: string): Promise<number> {
  // One round trip, and the TTL is set even if this process dies between the
  // two commands — a bare INCR then EXPIRE could leave a counter that never
  // expires.
  const result = await redis.multi().incr(key).expire(key, 120).exec()
  const count = result?.[0]?.[1]
  return typeof count === "number" ? count : Number(count ?? 0)
}

function setHeader(reply: FastifyReply, name: string, value: string | number) {
  if (typeof (reply as { header?: unknown }).header === "function") reply.header(name, value)
}

/** Call after API key auth succeeds. Returns false if rate limited (reply already sent). */
export async function enforceApiKeyRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  keyLimit?: number | null,
): Promise<boolean> {
  const keyId = request.auth?.apiKeyId
  if (!keyId) return true

  const settings = await loadApiProtectionSettings(request.server.prisma)
  const limit = resolveEffectiveKeyLimit(keyLimit, settings.apiKeyRequestsPerMinute)
  if (limit === null) return true

  const now = Date.now()
  const minute = currentMinuteBucket(now)
  const redisKey = `arciin:rpm:key:${keyId}:${minute}`

  let count: number
  try {
    count = await incrementRate(request.server.redis, redisKey)
  } catch (error) {
    // Redis is a limiter, not an authority. If it is down, a valid key keeps
    // working rather than every integration failing with a 500.
    request.log?.warn?.({ err: error }, "api key rate limit unavailable; allowing request")
    return true
  }

  const retryAfterSeconds = Math.max(1, 60 - Math.floor((now % 60_000) / 1000))
  setHeader(reply, "X-RateLimit-Limit", limit)
  setHeader(reply, "X-RateLimit-Remaining", Math.max(0, limit - count))
  setHeader(reply, "X-RateLimit-Reset", (minute + 1) * 60)

  if (count > limit) {
    const ip = clientIpFromRequest(request)
    const path = request.url?.split("?")[0] ?? request.url
    if (await shouldRecordSecurityDedupe(request.server.redis, `rate_key:${keyId}`).catch(() => false)) {
      void recordSecurityEvent(request.server, {
        type: "security.rate_limited",
        title: "API key rate limit",
        message: `Key ${keyId.slice(0, 8)}… from ${ip} exceeded ${limit}/min.`,
        metadata: { clientIp: ip, path, status: "limited" },
      }).catch(() => {})
    }

    setHeader(reply, "Retry-After", retryAfterSeconds)
    reply.status(429).send({
      error: {
        code: "RATE_LIMITED",
        message: `API key rate limit exceeded (${limit} requests per minute). Retry after ${retryAfterSeconds}s.`,
        details: { limit, retryAfterSeconds },
      },
    })
    return false
  }

  return true
}
