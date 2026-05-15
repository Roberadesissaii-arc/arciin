import { randomBytes } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { API_KEY_SCOPES } from "@arciin/shared"

import { recordActivity } from "@/services/activity/record-activity"
import { hashApiKey, requireRole } from "@/services/security/auth"
import { serializeApiKey } from "@/services/serializers"

const createApiKeySchema = z.object({
  name: z.string().min(2),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
  expiresAt: z.string().optional(),
})

export async function registerApiKeyRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api-keys",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (_request, reply) => {
      const apiKeys = await fastify.prisma.apiKey.findMany({
        where: {
          revokedAt: null,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
      })

      reply.send({
        data: apiKeys.map(serializeApiKey),
      })
    }
  )

  fastify.post(
    "/api-keys",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (request, reply) => {
      const parsed = createApiKeySchema.safeParse(request.body)

      if (!parsed.success || !request.auth) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid API key payload.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      // Enforce API key lifetime policy from security settings
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const raw = (instance?.remoteAccessConfig as Record<string, unknown> | null) ?? {}
      const sec = (raw.security as Record<string, unknown> | null) ?? {}
      const requireExpiry = Boolean(sec.requireApiKeyExpiry ?? false)
      const maxDays = Number(sec.maxApiKeyExpiryDays ?? 0)

      if (requireExpiry && !parsed.data.expiresAt) {
        reply.status(400).send({
          error: { code: "KEY_EXPIRY_REQUIRED", message: "This instance requires all API keys to have an expiry date." },
        })
        return
      }

      if (maxDays > 0 && parsed.data.expiresAt) {
        const expiry = new Date(parsed.data.expiresAt)
        const maxExpiry = new Date()
        maxExpiry.setDate(maxExpiry.getDate() + maxDays)
        if (expiry > maxExpiry) {
          reply.status(400).send({
            error: { code: "KEY_EXPIRY_TOO_FAR", message: `API key expiry cannot exceed ${maxDays} days from now.` },
          })
          return
        }
      }

      const rawKey = `arc_${randomBytes(24).toString("hex")}`
      const apiKey = await fastify.prisma.apiKey.create({
        data: {
          userId: request.auth.user.id,
          name: parsed.data.name,
          keyPrefix: rawKey.slice(0, 12),
          keyHash: hashApiKey(rawKey),
          scopes: parsed.data.scopes,
          expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        },
      })

      await recordActivity(fastify.prisma, {
        userId: request.auth.user.id,
        type: "api-key.created",
        title: "API key created",
        message: `${apiKey.name} is ready to use.`,
        entityType: "api-key",
        entityId: apiKey.id,
      })

      reply.status(201).send({
        data: {
          apiKey: serializeApiKey(apiKey),
          rawKey,
        },
      })
    }
  )

  fastify.post(
    "/api-keys/:id/rotate",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (request, reply) => {
      const params = z.object({ id: z.string() }).parse(request.params)

      const existing = await fastify.prisma.apiKey.findFirst({
        where: {
          id: params.id,
          revokedAt: null,
        },
      })

      if (!existing) {
        reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "API key not found or already revoked.",
          },
        })
        return
      }

      const rawKey = `arc_${randomBytes(24).toString("hex")}`
      const apiKey = await fastify.prisma.apiKey.update({
        where: { id: params.id },
        data: {
          keyPrefix: rawKey.slice(0, 12),
          keyHash: hashApiKey(rawKey),
          lastUsedAt: null,
        },
      })

      if (request.auth) {
        await recordActivity(fastify.prisma, {
          userId: request.auth.user.id,
          type: "api-key.rotated",
          title: "API key rotated",
          message: `${apiKey.name}: previous secret no longer works.`,
          entityType: "api-key",
          entityId: apiKey.id,
        })
      }

      reply.send({
        data: {
          apiKey: serializeApiKey(apiKey),
          rawKey,
        },
      })
    }
  )

  fastify.delete(
    "/api-keys/:id",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (request, reply) => {
      const params = z.object({ id: z.string() }).parse(request.params)

      const apiKey = await fastify.prisma.apiKey.update({
        where: {
          id: params.id,
        },
        data: {
          revokedAt: new Date(),
        },
      })

      if (request.auth) {
        await recordActivity(fastify.prisma, {
          userId: request.auth.user.id,
          type: "api-key.revoked",
          title: "API key revoked",
          message: `${apiKey.name} was revoked.`,
          entityType: "api-key",
          entityId: apiKey.id,
        })
      }

      reply.send({
        data: {
          success: true,
        },
      })
    }
  )
}
