import { randomBytes } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { SOCKET_EVENT_TYPES } from "@arciin/shared"

import { recordActivity } from "@/services/activity/record-activity"
import { encryptSecret, decryptSecret, signBody } from "@/services/security/encryption"
import { requireRole } from "@/services/security/auth"

const endpointSchema = z.object({
  name: z.string().min(2),
  url: z.string().url(),
  enabled: z.boolean().optional(),
  eventTypes: z.array(z.enum(SOCKET_EVENT_TYPES)).min(1),
})

const updateSchema = endpointSchema.partial().extend({
  rotateSecret: z.boolean().optional(),
})

function generateWebhookSecret() {
  return `whk_${randomBytes(24).toString("hex")}`
}

function buildTestEvent() {
  return {
    id: `evt_${randomBytes(12).toString("hex")}`,
    type: "webhook.test",
    createdAt: new Date().toISOString(),
    message: "This is a test delivery from Arciin.",
  }
}

async function deliverWebhook({
  url,
  secret,
  eventType,
  payload,
}: {
  url: string
  secret: string
  eventType: string
  payload: unknown
}) {
  const body = JSON.stringify(payload)
  const timestamp = new Date().toISOString()
  const signature = signBody(secret, body)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const start = Date.now()

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Arciin-Webhooks/0.1",
        "x-arciin-event": eventType,
        "x-arciin-timestamp": timestamp,
        "x-arciin-signature": `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    })

    const text = await response.text().catch(() => "")
    const durationMs = Date.now() - start
    return {
      ok: response.ok,
      status: response.status,
      body: text.slice(0, 8_192),
      durationMs,
    }
  } catch (error) {
    const durationMs = Date.now() - start
    return {
      ok: false,
      status: null,
      body: null,
      durationMs,
      error: error instanceof Error ? error.message : "Delivery failed",
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function registerWebhookRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/webhooks",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const endpoints = await fastify.prisma.webhookEndpoint.findMany({
        orderBy: { createdAt: "desc" },
      })

      reply.send({
        data: endpoints.map((endpoint) => ({
          id: endpoint.id,
          name: endpoint.name,
          url: endpoint.url,
          enabled: endpoint.enabled,
          eventTypes: endpoint.eventTypes,
          secretPrefix: endpoint.secretPrefix,
          createdAt: endpoint.createdAt.toISOString(),
          updatedAt: endpoint.updatedAt.toISOString(),
        })),
      })
    }
  )

  fastify.post(
    "/webhooks",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = endpointSchema.safeParse(request.body)

      if (!parsed.success || !request.auth) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid webhook payload.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      const rawSecret = generateWebhookSecret()
      const endpoint = await fastify.prisma.webhookEndpoint.create({
        data: {
          name: parsed.data.name,
          url: parsed.data.url,
          enabled: parsed.data.enabled ?? true,
          eventTypes: parsed.data.eventTypes,
          secretPrefix: rawSecret.slice(0, 12),
          secretEnc: encryptSecret(rawSecret),
        },
      })

      await recordActivity(fastify.prisma, {
        userId: request.auth.user.id,
        type: "webhook.created",
        title: "Webhook created",
        message: `${endpoint.name} is ready to receive events.`,
        entityType: "webhook",
        entityId: endpoint.id,
      })

      reply.status(201).send({
        data: {
          endpoint: {
            id: endpoint.id,
            name: endpoint.name,
            url: endpoint.url,
            enabled: endpoint.enabled,
            eventTypes: endpoint.eventTypes,
            secretPrefix: endpoint.secretPrefix,
            createdAt: endpoint.createdAt.toISOString(),
            updatedAt: endpoint.updatedAt.toISOString(),
          },
          secret: rawSecret,
        },
      })
    }
  )

  fastify.patch(
    "/webhooks/:id",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params)
      const parsed = updateSchema.safeParse(request.body)

      if (!parsed.success || !request.auth) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid webhook update payload.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      const existing = await fastify.prisma.webhookEndpoint.findUnique({
        where: { id: params.id },
      })

      if (!existing) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Webhook endpoint not found." },
        })
        return
      }

      let rotatedSecret: string | null = null
      let secretPrefix: string | undefined
      let secretEnc: string | undefined

      if (parsed.data.rotateSecret) {
        rotatedSecret = generateWebhookSecret()
        secretPrefix = rotatedSecret.slice(0, 12)
        secretEnc = encryptSecret(rotatedSecret)
      }

      const updated = await fastify.prisma.webhookEndpoint.update({
        where: { id: params.id },
        data: {
          name: parsed.data.name ?? undefined,
          url: parsed.data.url ?? undefined,
          enabled: parsed.data.enabled ?? undefined,
          eventTypes: parsed.data.eventTypes ?? undefined,
          secretPrefix,
          secretEnc,
        },
      })

      await recordActivity(fastify.prisma, {
        userId: request.auth.user.id,
        type: rotatedSecret ? "webhook.secret-rotated" : "webhook.updated",
        title: rotatedSecret ? "Webhook secret rotated" : "Webhook updated",
        message: `${updated.name} was updated.`,
        entityType: "webhook",
        entityId: updated.id,
      })

      reply.send({
        data: {
          endpoint: {
            id: updated.id,
            name: updated.name,
            url: updated.url,
            enabled: updated.enabled,
            eventTypes: updated.eventTypes,
            secretPrefix: updated.secretPrefix,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          },
          secret: rotatedSecret,
        },
      })
    }
  )

  fastify.delete(
    "/webhooks/:id",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params)

      const existing = await fastify.prisma.webhookEndpoint.findUnique({
        where: { id: params.id },
      })

      if (!existing) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Webhook endpoint not found." },
        })
        return
      }

      await fastify.prisma.webhookEndpoint.delete({
        where: { id: params.id },
      })

      if (request.auth) {
        await recordActivity(fastify.prisma, {
          userId: request.auth.user.id,
          type: "webhook.deleted",
          title: "Webhook deleted",
          message: `${existing.name} was removed.`,
          entityType: "webhook",
          entityId: existing.id,
        })
      }

      reply.send({ data: { success: true } })
    }
  )

  fastify.get(
    "/webhooks/:id/deliveries",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params)
      const deliveries = await fastify.prisma.webhookDelivery.findMany({
        where: { endpointId: params.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      })

      reply.send({
        data: deliveries.map((d) => ({
          id: d.id,
          endpointId: d.endpointId,
          eventType: d.eventType,
          status: d.status,
          responseCode: d.responseCode,
          responseBody: d.responseBody,
          durationMs: d.durationMs,
          error: d.error,
          createdAt: d.createdAt.toISOString(),
        })),
      })
    }
  )

  fastify.post(
    "/webhooks/:id/test",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params)
      const endpoint = await fastify.prisma.webhookEndpoint.findUnique({
        where: { id: params.id },
      })

      if (!endpoint) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Webhook endpoint not found." },
        })
        return
      }

      if (!endpoint.enabled) {
        reply.status(409).send({
          error: { code: "WEBHOOK_DISABLED", message: "Enable this webhook before testing it." },
        })
        return
      }

      const payload = buildTestEvent()
      const secret = decryptSecret(endpoint.secretEnc)
      const result = await deliverWebhook({
        url: endpoint.url,
        secret,
        eventType: payload.type,
        payload,
      })

      const status = result.ok ? "SUCCESS" : "FAILED"
      const delivery = await fastify.prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          eventType: payload.type,
          status,
          requestBody: payload,
          responseCode: result.status ?? null,
          responseBody: (result.body ?? undefined) || null,
          durationMs: result.durationMs,
          error: "error" in result ? result.error ?? null : null,
        },
      })

      if (request.auth) {
        await recordActivity(fastify.prisma, {
          userId: request.auth.user.id,
          type: result.ok ? "webhook.test-succeeded" : "webhook.test-failed",
          title: result.ok ? "Webhook test delivered" : "Webhook test failed",
          message: `${endpoint.name}: ${result.ok ? "200 OK" : "delivery failed"}.`,
          entityType: "webhook",
          entityId: endpoint.id,
        })
      }

      reply.send({
        data: {
          delivery: {
            id: delivery.id,
            endpointId: delivery.endpointId,
            eventType: delivery.eventType,
            status: delivery.status,
            responseCode: delivery.responseCode,
            responseBody: delivery.responseBody,
            durationMs: delivery.durationMs,
            error: delivery.error,
            createdAt: delivery.createdAt.toISOString(),
          },
        },
      })
    }
  )
}

