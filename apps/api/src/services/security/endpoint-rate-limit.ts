import type { FastifyReply, FastifyRequest } from "fastify"

import { clientIpFromRequest } from "@/services/security/client-ip"

/**
 * Count one attempt against a window, or report that the store is unreachable.
 *
 * `null` means Redis did not answer. Callers must treat that as a refusal, not
 * as a zero: these counters are the brute-force control on sign-in, and a
 * store that cannot be read must not quietly become "no limit configured".
 */
async function countAttempt(
  request: FastifyRequest,
  redisKey: string,
  windowSec: number,
): Promise<number | null> {
  try {
    const count = await request.server.redis.incr(redisKey)
    if (count === 1) {
      await request.server.redis.expire(redisKey, windowSec * 2)
    }
    return count
  } catch {
    return null
  }
}

/**
 * Refuse a request we cannot rate limit.
 *
 * Deliberately vague about the cause: the caller learns the service is
 * degraded and when to retry, and nothing about the internal topology. The
 * connection failure itself is logged once, by the Redis plugin, when the
 * connection drops — not once per rejected request.
 */
function replyRateLimiterUnavailable(reply: FastifyReply, windowSec: number): void {
  reply.status(503).send({
    error: {
      code: "RATE_LIMIT_UNAVAILABLE",
      message: "Arciin is temporarily unable to process this request. Try again in a moment.",
      details: { retryAfterSeconds: Math.min(windowSec, 30) },
    },
  })
}

/**
 * Enforces a per-IP rate limit for a single endpoint using Redis.
 * Returns true (and sends a 429) if the limit is exceeded — the caller must return early.
 *
 * Also returns true, with a 503, when the limit cannot be evaluated at all.
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

  const count = await countAttempt(request, redisKey, opts.windowSec)
  if (count === null) {
    replyRateLimiterUnavailable(reply, opts.windowSec)
    return true
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

/**
 * Per-*user* limit for endpoints that cost money or CPU rather than a row.
 *
 * Keyed on the account, not the IP: these routes are all authenticated, and an
 * IP key both lets one user multiply their quota across devices and makes a
 * household behind one NAT share it. Falls back to IP only when there is
 * somehow no identity on the request.
 *
 * Transcription, translation, chat and book generation had no limit at all, so
 * a stuck retry loop in a client could bill a provider indefinitely. The
 * defaults are deliberately loose — high enough that ordinary interactive use
 * never reaches them, low enough to stop a runaway.
 */
export async function checkAiRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: { key: string; limit: number; windowSec: number },
): Promise<boolean> {
  const identity =
    request.auth?.user?.id ?? request.auth?.apiKeyId ?? clientIpFromRequest(request)
  const bucket = Math.floor(Date.now() / (opts.windowSec * 1_000))
  const redisKey = `arciin:rl:ai:${opts.key}:${identity}:${bucket}`

  const count = await countAttempt(request, redisKey, opts.windowSec)
  if (count === null) {
    replyRateLimiterUnavailable(reply, opts.windowSec)
    return true
  }

  if (count > opts.limit) {
    reply.status(429).send({
      error: {
        code: "RATE_LIMITED",
        message: `Too many AI requests. Try again in ${opts.windowSec} seconds.`,
        details: { retryAfterSeconds: opts.windowSec, feature: opts.key },
      },
    })
    return true
  }

  return false
}

/** Read a positive integer override, else the default. */
function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isInteger(raw) && raw > 0 ? raw : fallback
}

/**
 * Budgets per user. Override per deployment; a single-user home instance may
 * want these higher, a shared instance lower.
 */
export const AI_RATE_LIMITS = {
  transcribe: {
    key: "transcribe",
    limit: envLimit("ARCIIN_AI_LIMIT_TRANSCRIBE", 20),
    windowSec: 3600,
  },
  translate: {
    key: "translate",
    limit: envLimit("ARCIIN_AI_LIMIT_TRANSLATE", 40),
    windowSec: 3600,
  },
  title: { key: "title", limit: envLimit("ARCIIN_AI_LIMIT_TITLE", 60), windowSec: 3600 },
  summary: { key: "summary", limit: envLimit("ARCIIN_AI_LIMIT_SUMMARY", 60), windowSec: 3600 },
  // Book generation drives one /chat call per chapter (plus retries), so this
  // ceiling has to clear a long book comfortably. It is set to stop a runaway
  // retry loop, not to ration ordinary use.
  chat: { key: "chat", limit: envLimit("ARCIIN_AI_LIMIT_CHAT", 240), windowSec: 3600 },
  book: { key: "book", limit: envLimit("ARCIIN_AI_LIMIT_BOOK", 30), windowSec: 3600 },
  vision: { key: "vision", limit: envLimit("ARCIIN_AI_LIMIT_VISION", 40), windowSec: 3600 },
} as const
