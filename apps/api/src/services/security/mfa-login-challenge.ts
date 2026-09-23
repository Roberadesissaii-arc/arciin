import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import type { FastifyInstance } from "fastify"

/**
 * The gap between "password was right" and "second factor was right".
 *
 * The alternative is to have the client hold the password and send it again
 * with the code. That works, but it keeps the password in the page for as long
 * as someone is fishing their phone out of a pocket and puts it on the wire
 * twice. A short-lived ticket costs one Redis key and keeps the password to a
 * single request.
 *
 * The ticket is worth nothing on its own: presenting it still requires a valid
 * code. It is stored hashed, expires in five minutes, is bound to the address
 * that earned it, and is deleted the moment it is spent, so it cannot be
 * replayed even inside its window.
 */

const CHALLENGE_TTL_SECONDS = 300

function challengeKey(tokenHash: string): string {
  return `arciin:mfa-challenge:${tokenHash}`
}

function hashChallenge(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export type PendingChallenge = {
  userId: string
  clientIp: string
  rememberMe: boolean
}

/** Issue a ticket for a caller who has just proved the password. */
export async function issueMfaChallenge(
  fastify: FastifyInstance,
  pending: PendingChallenge,
): Promise<{ token: string; expiresInSeconds: number }> {
  const token = randomBytes(32).toString("base64url")
  await fastify.redis.set(
    challengeKey(hashChallenge(token)),
    JSON.stringify(pending),
    "EX",
    CHALLENGE_TTL_SECONDS,
  )
  return { token, expiresInSeconds: CHALLENGE_TTL_SECONDS }
}

/**
 * Spend a ticket.
 *
 * Deleted before the code is checked rather than after, so a wrong code burns
 * the ticket too. That is deliberate: it makes the ticket useless as a way to
 * sit and guess codes, and the cost of being wrong is one more password entry.
 */
export async function consumeMfaChallenge(
  fastify: FastifyInstance,
  token: string,
  clientIp: string,
): Promise<PendingChallenge | null> {
  if (!token || token.length < 16) return null
  const key = challengeKey(hashChallenge(token))
  const raw = await fastify.redis.get(key)
  if (!raw) return null
  await fastify.redis.del(key)

  let pending: PendingChallenge
  try {
    pending = JSON.parse(raw) as PendingChallenge
  } catch {
    return null
  }

  // Bound to the address that earned it: a stolen ticket is not portable.
  const a = Buffer.from(pending.clientIp, "utf8")
  const b = Buffer.from(clientIp, "utf8")
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return pending
}

export const MFA_CHALLENGE_TTL_SECONDS = CHALLENGE_TTL_SECONDS
