import { MOBILE_DISCOVER_SERVICE_ID, MOBILE_SESSION_USER_AGENT_PREFIX } from "@arciin/shared"
import type { FastifyInstance, FastifyRequest } from "fastify"
import type { User } from "@prisma/client"
import { z } from "zod"

import { serializeUser } from "@/services/serializers"
import {
  formatAuthSecurityMessage,
  resolveRequestClientContext,
} from "@/services/security/login-audit"
import { createSession, verifyPassword } from "@/services/security/auth"
import {
  clearFailedLoginAttempts,
  isLoginLocked,
  recordFailedLogin,
} from "@/services/security/login-guard"
import { recordSecurityEvent } from "@/services/security/security-events"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import {
  consumeMobilePairingCode,
  findValidMobilePairingCode,
  mobilePairingSessionOptions,
} from "@/services/mobile/mobile-pairing"
import {
  buildMobileDiscoverPayload,
  resolveMobileServerUrls,
} from "@/services/mobile/mobile-server-urls"
import { authenticate } from "@/services/security/auth"

const pairSchema = z.object({
  code: z.string().min(4).max(12),
  email: z.email(),
  password: z.string().min(8),
  deviceName: z.string().trim().min(1).max(80).optional(),
})

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  deviceName: z.string().trim().min(1).max(80).optional(),
})

async function issueMobileSession(
  request: FastifyRequest,
  fastify: FastifyInstance,
  user: User,
  deviceLabel: string,
) {
  const { session, rawToken } = await createSession(request, user.id, mobilePairingSessionOptions())
  const payload = await buildMobileDiscoverPayload(fastify.prisma, request)

  await fastify.prisma.session.update({
    where: { id: session.id },
    data: { userAgent: `${MOBILE_SESSION_USER_AGENT_PREFIX} · ${deviceLabel}` },
  })

  return {
    sessionToken: rawToken,
    sessionExpiresAt: session.expiresAt.toISOString(),
    user: serializeUser(user),
    server: payload,
  }
}

export async function registerMobileRoutes(fastify: FastifyInstance) {
  fastify.get("/mobile/discover", async (request, reply) => {
    const instance = await fastify.prisma.instanceConfig.findFirst()
    const payload = await buildMobileDiscoverPayload(fastify.prisma, request)

    reply.send({
      data: {
        service: MOBILE_DISCOVER_SERVICE_ID,
        initialized: Boolean(instance),
        instanceName: payload.instanceName,
        version: payload.version,
        webUrl: payload.webUrl,
        apiBaseUrl: payload.apiBaseUrl,
        socketUrl: payload.socketUrl,
        requestOrigin: payload.requestOrigin,
        instanceId: payload.instanceId,
        canonicalPublicUrl: payload.canonicalPublicUrl,
        canonicalApiBaseUrl: payload.canonicalApiBaseUrl,
        canonicalSocketUrl: payload.canonicalSocketUrl,
        lanUrls: payload.lanUrls,
        pairingSupported: true,
      },
    })
  })

  /** Current canonical URLs for an already-paired phone (session Bearer). */
  fastify.get("/mobile/server", { preHandler: authenticate }, async (request, reply) => {
    const payload = await buildMobileDiscoverPayload(fastify.prisma, request)
    reply.send({
      data: {
        instanceId: payload.instanceId,
        instanceName: payload.instanceName,
        version: payload.version,
        webUrl: payload.webUrl,
        apiBaseUrl: payload.apiBaseUrl,
        socketUrl: payload.socketUrl,
        lanUrls: payload.lanUrls,
        requestOrigin: payload.requestOrigin,
      },
    })
  })

  fastify.post("/mobile/pair", async (request, reply) => {
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `mobile-pair:${request.ip}`,
        limit: 20,
        windowSec: 60,
      })
    ) {
      return
    }

    const parsed = pairSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid pairing payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const instance = await fastify.prisma.instanceConfig.findFirst()
    if (!instance) {
      reply.status(409).send({
        error: {
          code: "INSTANCE_NOT_READY",
          message: "This Arciin instance has not been set up yet.",
        },
      })
      return
    }

    const pairing = await findValidMobilePairingCode(fastify.prisma, parsed.data.code)
    if (!pairing) {
      reply.status(401).send({
        error: {
          code: "INVALID_PAIRING_CODE",
          message: "Connection code is invalid or expired. Generate a new code in Settings → Mobile connection.",
        },
      })
      return
    }

    const email = parsed.data.email.trim().toLowerCase()
    const user = await fastify.prisma.user.findUnique({ where: { email } })
    if (!user || user.status !== "ACTIVE") {
      reply.status(401).send({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email or password is incorrect.",
        },
      })
      return
    }

    const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash)
    if (!passwordOk) {
      reply.status(401).send({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email or password is incorrect.",
        },
      })
      return
    }

    await consumeMobilePairingCode(fastify.prisma, pairing.id)

    const ctx = resolveRequestClientContext(request)
    const deviceLabel = parsed.data.deviceName?.trim() || ctx.deviceLabel || "Mobile"
    const auth = await issueMobileSession(request, fastify, user, deviceLabel)

    await recordSecurityEvent(fastify, {
      userId: user.id,
      type: "auth.login",
      title: "Mobile paired",
      message: formatAuthSecurityMessage(user.name, ctx.ip, deviceLabel, "connected a mobile device"),
      metadata: {
        clientIp: ctx.normalizedIp,
        deviceLabel: deviceLabel ?? undefined,
        userAgent: ctx.userAgent,
        status: "ok",
      },
    })

    reply.send({ data: auth })
  })

  /** Sign in on a previously paired server (no connection code). */
  fastify.post("/mobile/login", async (request, reply) => {
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `mobile-login:${request.ip}`,
        limit: 20,
        windowSec: 60,
      })
    ) {
      return
    }

    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid login payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const instance = await fastify.prisma.instanceConfig.findFirst()
    if (!instance) {
      reply.status(409).send({
        error: {
          code: "INSTANCE_NOT_READY",
          message: "This Arciin instance has not been set up yet.",
        },
      })
      return
    }

    const email = parsed.data.email.trim().toLowerCase()
    const lock = await isLoginLocked(fastify, email)
    if (lock.locked) {
      reply.status(429).send({
        error: {
          code: "ACCOUNT_LOCKED",
          message: "Too many failed sign-in attempts. Try again in about 15 minutes.",
        },
      })
      return
    }

    const user = await fastify.prisma.user.findUnique({ where: { email } })
    if (!user || user.status !== "ACTIVE" || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      await recordFailedLogin(request, reply, email)
      return
    }

    await clearFailedLoginAttempts(fastify, email)

    const ctx = resolveRequestClientContext(request)
    const deviceLabel = parsed.data.deviceName?.trim() || ctx.deviceLabel || "Mobile"
    const auth = await issueMobileSession(request, fastify, user, deviceLabel)

    await recordSecurityEvent(fastify, {
      userId: user.id,
      type: "auth.login",
      title: "Signed in (mobile)",
      message: formatAuthSecurityMessage(user.name, ctx.ip, deviceLabel),
      metadata: {
        clientIp: ctx.normalizedIp,
        deviceLabel: deviceLabel ?? undefined,
        userAgent: ctx.userAgent,
        status: "ok",
      },
    })

    reply.send({ data: auth })
  })

  /** Verify a code without logging in (optional onboarding step for the mobile app). */
  fastify.post("/mobile/pair/verify", async (request, reply) => {
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `mobile-pair-verify:${request.ip}`,
        limit: 30,
        windowSec: 60,
      })
    ) {
      return
    }

    const parsed = z.object({ code: z.string().min(4).max(12) }).safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid code." },
      })
      return
    }

    const pairing = await findValidMobilePairingCode(fastify.prisma, parsed.data.code)
    if (!pairing) {
      reply.status(401).send({
        error: {
          code: "INVALID_PAIRING_CODE",
          message: "Connection code is invalid or expired.",
        },
      })
      return
    }

    const urls = await resolveMobileServerUrls(fastify.prisma, request)
    reply.send({
      data: {
        valid: true,
        instanceName: urls.instanceName,
        server: urls,
      },
    })
  })
}
