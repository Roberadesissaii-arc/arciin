import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

import { loadAccessControlSettings } from "@/services/security/access-control-settings"
import { resolveRequestClientContext } from "@/services/security/login-audit"
import { recordSecurityEvent } from "@/services/security/security-events"

const FAIL_WINDOW_SEC = 900

function failKey(email: string) {
  return `arciin:login-fails:${email.toLowerCase()}`
}

export async function isLoginLocked(
  fastify: FastifyInstance,
  email: string,
): Promise<{ locked: boolean; maxFailed: number; attempts: number }> {
  const settings = await loadAccessControlSettings(fastify.prisma)
  const key = failKey(email)
  const raw = await fastify.redis.get(key)
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
  const key = failKey(email)
  const attempts = await fastify.redis.incr(key)
  if (attempts === 1) {
    await fastify.redis.expire(key, FAIL_WINDOW_SEC)
  }

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
    reply.status(429).send({
      error: {
        code: "ACCOUNT_LOCKED",
        message: `Too many failed sign-in attempts. Try again in about ${Math.ceil(FAIL_WINDOW_SEC / 60)} minutes.`,
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

export async function clearFailedLoginAttempts(fastify: FastifyInstance, email: string) {
  await fastify.redis.del(failKey(email))
}
