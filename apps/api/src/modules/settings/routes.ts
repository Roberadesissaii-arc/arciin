import { access, statfs } from "node:fs/promises"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireRole } from "@/services/security/auth"
import { directoryUsageBytes } from "@/services/storage/local-storage"

const storageSchema = z.object({
  storageRoot: z.string().min(1),
})

const remoteAccessSchema = z.object({
  publicUrl: z.string().url().optional().nullable(),
  mode: z.enum(["local", "reverse-proxy", "cloudflare-tunnel"]).optional(),
  reverseProxyEnabled: z.boolean().optional(),
  cloudflareTunnelEnabled: z.boolean().optional(),
})

export async function registerSettingsRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/settings/storage",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const defaultStorage = await fastify.prisma.storageLocation.findFirst({
        where: {
          isDefault: true,
        },
      })

      const storageRoot = instance?.storageRoot || defaultStorage?.rootPath || "./data/arciin"
      const usageBytes = await directoryUsageBytes(storageRoot)
      const objectCount = await fastify.prisma.storageObject.count()
      let writable = true
      let totalBytes: number | null = null
      let availableBytes: number | null = null

      try {
        await access(storageRoot)
        const filesystemStats = await statfs(storageRoot)
        totalBytes = Number(filesystemStats.bsize * filesystemStats.blocks)
        availableBytes = Number(filesystemStats.bsize * filesystemStats.bavail)
      } catch {
        writable = false
      }

      reply.send({
        data: {
          instanceName: instance?.instanceName,
          storageRoot,
          defaultLocationId: defaultStorage?.id ?? null,
          writable,
          usageBytes,
          objectCount,
          totalBytes,
          availableBytes,
        },
      })
    }
  )

  fastify.patch(
    "/settings/storage",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (request, reply) => {
      const parsed = storageSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid storage payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const storageRoot = parsed.data.storageRoot
      const instance = await fastify.prisma.instanceConfig.findFirst()

      if (!instance) {
        reply.status(409).send({
          error: {
            code: "INSTANCE_NOT_READY",
            message: "Claim the instance before changing storage settings.",
          },
        })
        return
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.instanceConfig.update({
          where: {
            id: instance.id,
          },
          data: {
            storageRoot,
          },
        })

        await tx.storageLocation.updateMany({
          where: {
            isDefault: true,
          },
          data: {
            rootPath: storageRoot,
          },
        })
      })

      reply.send({
        data: {
          instanceName: instance.instanceName,
          storageRoot,
          defaultLocationId: null,
          writable: true,
          usageBytes: await directoryUsageBytes(storageRoot),
          objectCount: await fastify.prisma.storageObject.count(),
          totalBytes: null,
          availableBytes: null,
        },
      })
    }
  )

  fastify.get(
    "/settings/remote-access",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const config = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}

      reply.send({
        data: {
          publicUrl: instance?.publicUrl ?? null,
          localUrl: process.env.ARCIIN_PUBLIC_URL || "http://localhost:3000",
          currentUrl: process.env.ARCIIN_PUBLIC_URL || "http://localhost:3000",
          mode: (instance?.remoteAccessMode as string) || "local",
          reverseProxyEnabled: Boolean(config.reverseProxyEnabled),
          cloudflareTunnelEnabled: Boolean(config.cloudflareTunnelEnabled),
        },
      })
    }
  )

  fastify.patch(
    "/settings/remote-access",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (request, reply) => {
      const parsed = remoteAccessSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid remote access payload.",
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
            message: "Claim the instance before changing remote access settings.",
          },
        })
        return
      }

      const nextConfig = {
        reverseProxyEnabled: parsed.data.reverseProxyEnabled ?? false,
        cloudflareTunnelEnabled: parsed.data.cloudflareTunnelEnabled ?? false,
      }

      const updated = await fastify.prisma.instanceConfig.update({
        where: {
          id: instance.id,
        },
        data: {
          publicUrl: parsed.data.publicUrl ?? null,
          remoteAccessMode: parsed.data.mode ?? "local",
          remoteAccessConfig: nextConfig,
        },
      })

      reply.send({
        data: {
          publicUrl: updated.publicUrl ?? null,
          localUrl: process.env.ARCIIN_PUBLIC_URL || "http://localhost:3000",
          currentUrl: process.env.ARCIIN_PUBLIC_URL || "http://localhost:3000",
          mode: updated.remoteAccessMode || "local",
          reverseProxyEnabled: Boolean(nextConfig.reverseProxyEnabled),
          cloudflareTunnelEnabled: Boolean(nextConfig.cloudflareTunnelEnabled),
        },
      })
    }
  )
}
