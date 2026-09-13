import {
  ARCIIN_DEVICE_PROTOCOL_VERSION,
  DEVICE_NAME_MAX_LENGTH,
  DEVICE_PAIR_RATE_LIMIT,
  DEVICE_PLATFORMS,
  DEVICE_SESSION_RATE_LIMIT,
  DEVICE_TYPES,
} from "@arciin/config"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  extractDeviceAuthorization,
  setTrustedDeviceCookie,
} from "@/services/devices/device-cookie"
import { buildDiscoveryManifest } from "@/services/devices/discovery"
import {
  DevicePairingError,
  claimDevicePairing,
  findActiveDeviceByCredential,
  issueDeviceSession,
} from "@/services/devices/pairing"
import {
  serializePairedDeviceSummary,
} from "@/services/devices/serialize"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"

const pairSchema = z.object({
  code: z.string().min(4).max(16),
  name: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
  platform: z.enum(DEVICE_PLATFORMS),
  deviceType: z.enum(DEVICE_TYPES).default("desktop"),
  appVersion: z.string().trim().min(1).max(40).optional(),
  protocolVersion: z.number().int(),
  osVersion: z.string().trim().min(1).max(80).optional(),
  architecture: z.string().trim().min(1).max(32).optional(),
})

function sendPairingError(
  reply: import("fastify").FastifyReply,
  error: unknown,
) {
  if (error instanceof DevicePairingError) {
    reply.status(error.status).send({
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }
  throw error
}

export async function registerDeviceClientRoutes(fastify: FastifyInstance) {
  fastify.post("/devices/pair", async (request, reply) => {
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `device-pair:${request.ip}`,
        ...DEVICE_PAIR_RATE_LIMIT,
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

    try {
      const { device, credential } = await claimDevicePairing(fastify.prisma, parsed.data)
      reply.status(201).send({
        data: {
          device: serializePairedDeviceSummary(device),
          credential,
        },
      })
    } catch (error) {
      sendPairingError(reply, error)
    }
  })

  fastify.post("/devices/session", async (request, reply) => {
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `device-session:${request.ip}`,
        ...DEVICE_SESSION_RATE_LIMIT,
      })
    ) {
      return
    }

    const credential = extractDeviceAuthorization(request)
    if (!credential) {
      reply.status(401).send({
        error: {
          code: "DEVICE_INVALID",
          message: "Authorization: Device <credential> is required.",
        },
      })
      return
    }

    try {
      const device = await findActiveDeviceByCredential(fastify.prisma, credential)
      const { rawToken, expiresAt } = await issueDeviceSession(fastify.prisma, device)
      setTrustedDeviceCookie(reply, rawToken, expiresAt, request)
      reply.send({
        data: {
          device: serializePairedDeviceSummary(device),
          expiresAt: expiresAt.toISOString(),
          protocolVersion: ARCIIN_DEVICE_PROTOCOL_VERSION,
        },
      })
    } catch (error) {
      sendPairingError(reply, error)
    }
  })
}

export async function registerDiscoveryRoutes(fastify: FastifyInstance) {
  fastify.get("/.well-known/arciin", async (request, reply) => {
    const manifest = await buildDiscoveryManifest(fastify.prisma, request)
    reply.send(manifest)
  })
}

export async function registerDeviceDiscoverAlias(fastify: FastifyInstance) {
  fastify.get("/.well-known/arciin", async (request, reply) => {
    const manifest = await buildDiscoveryManifest(fastify.prisma, request)
    reply.send(manifest)
  })
}
