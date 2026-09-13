import {
  ARCIIN_DEVICE_PROTOCOL_VERSION,
  ARCIIN_MDNS_SERVICE_TYPE,
  DEVICE_NAME_MAX_LENGTH,
  DEVICE_PAIRING_CODE_TTL_MS,
  formatDevicePairingCode,
} from "@arciin/config"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { resolveLocalAccessUrls } from "@/services/remote-access/local-access-urls"
import {
  DevicePairingError,
  cancelPendingPairings,
  createDevicePairing,
  getActiveDevicePairing,
  listActiveDevices,
  renameDevice,
  revokeDevice,
} from "@/services/devices/pairing"
import { serializePairedDevice } from "@/services/devices/serialize"
import { recordSecurityEvent } from "@/services/security/security-events"
import { requireSessionRole } from "@/services/security/auth"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"

const renameSchema = z.object({
  name: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
})

const manageDevices = { preHandler: requireSessionRole(["OWNER", "ADMIN"]) }

export async function registerDeviceSettingsRoutes(fastify: FastifyInstance) {
  fastify.get("/settings/devices", manageDevices, async (request, reply) => {
    if (!request.auth) return
    const [devices, pairing, instance] = await Promise.all([
      listActiveDevices(fastify.prisma),
      getActiveDevicePairing(fastify.prisma),
      fastify.prisma.instanceConfig.findFirst(),
    ])
    const local = resolveLocalAccessUrls()

    reply.send({
      data: {
        devices: devices.map(serializePairedDevice),
        pairing: pairing
          ? {
              expiresAt: pairing.expiresAt.toISOString(),
              createdAt: pairing.createdAt.toISOString(),
            }
          : null,
        ttlMinutes: Math.round(DEVICE_PAIRING_CODE_TTL_MS / 60_000),
        protocolVersion: ARCIIN_DEVICE_PROTOCOL_VERSION,
        instanceName: instance?.instanceName || "Arciin",
        localUrl: local.primaryLanUrl ?? local.localUrl,
        mdns: {
          serviceType: `${ARCIIN_MDNS_SERVICE_TYPE}.local`,
          advertised: false,
        },
      },
    })
  })

  fastify.post("/settings/devices/pairing", manageDevices, async (request, reply) => {
    if (!request.auth) return
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `device-pairing-create:${request.auth.user.id}`,
        limit: 10,
        windowSec: 60,
        perIp: false,
      })
    ) {
      return
    }

    const { code, expiresAt } = await createDevicePairing(
      fastify.prisma,
      request.auth.user.id,
    )

    await recordSecurityEvent(fastify, {
      userId: request.auth.user.id,
      type: "security.device_pairing_created",
      title: "Device pairing code generated",
      message: `${request.auth.user.name} generated a device pairing code.`,
      metadata: { status: "ok" },
    })

    reply.status(201).send({
      data: {
        code,
        displayCode: formatDevicePairingCode(code),
        expiresAt: expiresAt.toISOString(),
        ttlMinutes: Math.round(DEVICE_PAIRING_CODE_TTL_MS / 60_000),
      },
    })
  })

  fastify.delete("/settings/devices/pairing", manageDevices, async (request, reply) => {
    if (!request.auth) return
    await cancelPendingPairings(fastify.prisma)
    reply.send({ data: { cancelled: true as const } })
  })

  fastify.post(
    "/settings/devices/:deviceId/revoke",
    manageDevices,
    async (request, reply) => {
      if (!request.auth) return
      const { deviceId } = request.params as { deviceId: string }
      const device = await revokeDevice(fastify.prisma, deviceId)
      if (!device) {
        reply.status(404).send({
          error: {
            code: "DEVICE_INVALID",
            message: "That device was not found.",
          },
        })
        return
      }

      await recordSecurityEvent(fastify, {
        userId: request.auth.user.id,
        type: "security.device_revoked",
        title: "Trusted device revoked",
        message: `${request.auth.user.name} revoked ${device.name}.`,
        metadata: { status: "revoked" },
      })

      reply.send({
        data: {
          revoked: true as const,
          device: serializePairedDevice(device),
        },
      })
    },
  )

  fastify.patch("/settings/devices/:deviceId", manageDevices, async (request, reply) => {
    if (!request.auth) return
    const { deviceId } = request.params as { deviceId: string }
    const parsed = renameSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid device update.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    try {
      const device = await renameDevice(fastify.prisma, deviceId, parsed.data.name)
      if (!device) {
        reply.status(404).send({
          error: {
            code: "DEVICE_INVALID",
            message: "That device was not found.",
          },
        })
        return
      }
      reply.send({ data: serializePairedDevice(device) })
    } catch (error) {
      if (error instanceof DevicePairingError) {
        reply.status(error.status).send({
          error: { code: error.code, message: error.message },
        })
        return
      }
      throw error
    }
  })
}
