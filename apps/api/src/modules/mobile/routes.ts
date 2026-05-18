import { MOBILE_DISCOVER_SERVICE_ID } from "@arciin/shared"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { serializeUser } from "@/services/serializers"
import {
  createSession,
  verifyPassword,
} from "@/services/security/auth"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import {
  consumeMobilePairingCode,
  findValidMobilePairingCode,
  mobilePairingSessionOptions,
} from "@/services/mobile/mobile-pairing"
import { resolveMobileServerUrls } from "@/services/mobile/mobile-server-urls"

const pairSchema = z.object({
  code: z.string().min(4).max(12),
  email: z.email(),
  password: z.string().min(8),
  deviceName: z.string().trim().min(1).max(80).optional(),
})

export async function registerMobileRoutes(fastify: FastifyInstance) {
  fastify.get("/mobile/discover", async (request, reply) => {
    const instance = await fastify.prisma.instanceConfig.findFirst()
    const urls = await resolveMobileServerUrls(fastify.prisma, request)

    reply.send({
      data: {
        service: MOBILE_DISCOVER_SERVICE_ID,
        initialized: Boolean(instance),
        instanceName: urls.instanceName,
        version: urls.version,
        webUrl: urls.webUrl,
        apiBaseUrl: urls.apiBaseUrl,
        socketUrl: urls.socketUrl,
        requestOrigin: urls.requestOrigin,
        pairingSupported: true,
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

    const { session, rawToken } = await createSession(request, user.id, mobilePairingSessionOptions())
    await consumeMobilePairingCode(fastify.prisma, pairing.id)

    const urls = await resolveMobileServerUrls(fastify.prisma, request)
    const deviceLabel = parsed.data.deviceName?.trim() || "Mobile"

    await fastify.prisma.session.update({
      where: { id: session.id },
      data: {
        userAgent: `Arciin Mobile · ${deviceLabel}`,
      },
    })

    reply.send({
      data: {
        sessionToken: rawToken,
        sessionExpiresAt: session.expiresAt.toISOString(),
        user: serializeUser(user),
        server: urls,
      },
    })
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
