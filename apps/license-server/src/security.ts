/**
 * Trust tiers and abuse limits for the licensing authority.
 *
 * Three classes of caller, and they are not interchangeable:
 *
 *   instance-facing  activate / refresh / deactivate. Authenticated by
 *                    possession of a license key or a token this server signed,
 *                    plus an instance id. Public, rate limited.
 *   service-facing   issue / revoke / lookup / deactivate-server. Vendor
 *                    backends only (arciin-web). Requires a service credential.
 *   admin-only       destructive maintenance. Requires a separate credential
 *                    that the website never holds.
 *
 * The previous design gated everything privileged on one *optional* header, so
 * an unset variable opened license minting to anyone who could reach the port.
 * These checks fail closed: no configured credential means no access, ever.
 */

import { createHash, timingSafeEqual } from "node:crypto"

import type { FastifyReply, FastifyRequest } from "fastify"

import { licenseServerConfig } from "./config.js"

/**
 * Compare without leaking length or position through timing.
 *
 * Hashing first gives both sides a fixed 32-byte width, so `timingSafeEqual`
 * never throws on a length mismatch and an attacker learns nothing from how
 * long the comparison took.
 */
function secretEquals(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate, "utf8").digest()
  const b = createHash("sha256").update(expected, "utf8").digest()
  return timingSafeEqual(a, b)
}

function matchesAny(candidate: string, allowed: readonly string[]): boolean {
  // Iterate the whole list rather than short-circuiting, so the time taken does
  // not reveal which position matched.
  let matched = false
  for (const value of allowed) {
    if (secretEquals(candidate, value)) matched = true
  }
  return matched
}

function bearerFrom(request: FastifyRequest): string {
  const header = request.headers.authorization
  const raw = typeof header === "string" ? header : Array.isArray(header) ? header[0] : ""
  if (!raw) return ""
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return match?.[1]?.trim() ?? ""
}

function denied(reply: FastifyReply) {
  // Deliberately identical for "no credential" and "wrong credential": the
  // response must not tell a prober whether the service is configured.
  reply.status(401).send({
    error: { code: "UNAUTHORIZED", message: "Service credential required." },
  })
}

/** Vendor backend tier — arciin-web calls these. Never reachable from a browser. */
export async function requireServiceAuth(request: FastifyRequest, reply: FastifyReply) {
  const allowed = licenseServerConfig.serviceTokens
  const presented = bearerFrom(request)
  if (allowed.length === 0 || !presented || !matchesAny(presented, allowed)) {
    denied(reply)
    return reply
  }
  return undefined
}

/**
 * Admin tier — destructive operations.
 *
 * Falls back to nothing: if no admin credential is configured the route is
 * closed, even to a valid service credential. A compromised website must not be
 * able to hard-delete licensing records.
 */
export async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply) {
  const allowed = licenseServerConfig.adminTokens
  const presented = bearerFrom(request)
  if (allowed.length === 0 || !presented || !matchesAny(presented, allowed)) {
    denied(reply)
    return reply
  }
  return undefined
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
let lastSweep = 0

/**
 * Fixed-window counter held in process memory.
 *
 * The API's limiter uses Redis, but this service has no Redis and adding one
 * for a handful of counters would be a heavier dependency than the problem
 * warrants. Single process, single port — an in-memory window is honest about
 * what it protects: it stops a scripted brute force, not a distributed one.
 */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function consumeRateLimit(
  identity: string,
  opts: { key: string; limit: number; windowSec: number },
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  sweep(now)
  const windowMs = opts.windowSec * 1_000
  const bucketKey = `${opts.key}:${identity}`
  const existing = buckets.get(bucketKey)

  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  existing.count += 1
  if (existing.count > opts.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1_000)),
    }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

function clientIp(request: FastifyRequest): string {
  // No proxy-header trust here: this service sits behind our own edge or on
  // loopback, and honouring X-Forwarded-For from an untrusted caller would let
  // anyone reset their own bucket by inventing an address.
  return request.ip || "unknown"
}

/**
 * Returns true when the request was rejected — callers must return immediately.
 * Limits are per-IP and deliberately generous enough that an instance checking
 * in on schedule, or a customer retrying a paste, never trips them.
 */
export function checkRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: { key: string; limit: number; windowSec: number; identity?: string },
): boolean {
  const identity = opts.identity ?? clientIp(request)
  const result = consumeRateLimit(identity, opts)
  if (result.allowed) return false

  reply
    .header("retry-after", String(result.retryAfterSeconds))
    .status(429)
    .send({
      error: {
        code: "RATE_LIMITED",
        message: `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
        details: { retryAfterSeconds: result.retryAfterSeconds },
      },
    })
  return true
}

/** Test seam — clears every window. */
export function resetRateLimits(): void {
  buckets.clear()
  lastSweep = 0
}
