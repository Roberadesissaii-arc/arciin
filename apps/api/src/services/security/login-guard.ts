import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

import { loadAccessControlSettings } from "@/services/security/access-control-settings"
import { clientIpFromRequest } from "@/services/security/client-ip"
import {
  FAIL_WINDOW_SEC,
  accountKey,
  backoffMs,
  failKey,
} from "@/services/security/login-abuse"
import { resolveRequestClientContext } from "@/services/security/login-audit"
import { recordSecurityEvent } from "@/services/security/security-events"






export async function isLoginLocked(
  fastify: FastifyInstance,
  email: string,
  clientIp: string,
): Promise<{ locked: boolean; maxFailed: number; attempts: number }> {
  const settings = await loadAccessControlSettings(fastify.prisma)
  const raw = await fastify.redis.get(failKey(email, clientIp))
  const attempts = raw ? Number(raw) : 0
  return {
    locked: attempts >= settings.maxFailedLogins,
    maxFailed: settings.maxFailedLogins,
    attempts,
  }
}

export async function recordFailedLogin(
  request: FastifyRequest,
  reply: FastifyReply,
  email: string,
): Promise<void> {
  const fastify = request.server
  const settings = await loadAccessControlSettings(fastify.prisma)
  const clientIp = clientIpFromRequest(request)

  const key = failKey(email, clientIp)
  const attempts = await fastify.redis.incr(key)
  if (attempts === 1) {
    await fastify.redis.expire(key, FAIL_WINDOW_SEC)
  }

  const accountTotalKey = accountKey(email)
  const accountFailures = await fastify.redis.incr(accountTotalKey)
  if (accountFailures === 1) {
    await fastify.redis.expire(accountTotalKey, FAIL_WINDOW_SEC)
  }

  // Slows a spread-out attack without ever refusing the owner outright.
  const delay = backoffMs(accountFailures)
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))

  if (settings.loginAlertsEnabled) {
    const ctx = resolveRequestClientContext(request)
    const devicePart = ctx.deviceLabel ? ` (${ctx.deviceLabel})` : ""
    await recordSecurityEvent(fastify, {
      type: "auth.login_failed",
      title: "Failed sign-in attempt",
      message: `Failed login for ${email.toLowerCase()} from ${ctx.ip}${devicePart}.`,
      metadata: {
        clientIp: ctx.normalizedIp,
        deviceLabel: ctx.deviceLabel ?? undefined,
        userAgent: ctx.userAgent,
        status: "denied",
      },
    })
  }

  if (attempts >= settings.maxFailedLogins) {
    // Deliberately says "this client", not "this account": the limit is on the
    // requester, and phrasing it as an account state told an attacker their
    // denial-of-service had landed.
    reply.status(429).send({
      error: {
        code: "TOO_MANY_ATTEMPTS",
        message: `Too many failed sign-in attempts from this device. Try again in about ${Math.ceil(FAIL_WINDOW_SEC / 60)} minutes.`,
      },
    })
    return
  }

  reply.status(401).send({
    error: {
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect.",
    },
  })
}

export async function clearFailedLoginAttempts(
  fastify: FastifyInstance,
  email: string,
  clientIp: string,
) {
  // A correct password clears this client's lock and the account-wide backoff
  // together, so one genuine sign-in restores normal speed.
  await fastify.redis.del(failKey(email, clientIp), accountKey(email))
}

