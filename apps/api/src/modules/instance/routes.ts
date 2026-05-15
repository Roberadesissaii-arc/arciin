import path from "node:path"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { DEFAULT_LIBRARY_DEFINITIONS } from "@arciin/shared"

import { apiConfig } from "@/config"
import { serializeAuth } from "@/services/serializers"
import { createSession, hashPassword, setSessionCookie } from "@/services/security/auth"
import { ensureStorageDirectories } from "@/services/storage/local-storage"

const claimSchema = z
  .object({
    setupToken: z.string().min(1),
    instanceName: z.string().min(2),
    adminName: z.string().min(2),
    adminEmail: z.email(),
    adminPassword: z.string().min(8),
    storageRoot: z.string().min(1),
    libraries: z.array(z.string()).min(1),
    acceptedTermsAndPrivacy: z
      .boolean()
      .refine((value) => value === true, {
        message: "Terms and Privacy Policy acceptance is required to claim this instance.",
      }),
  })

async function isInitialized(fastify: FastifyInstance) {
  const [instanceCount, userCount] = await Promise.all([
    fastify.prisma.instanceConfig.count(),
    fastify.prisma.user.count(),
  ])

  return instanceCount > 0 || userCount > 0
}

export async function registerInstanceRoutes(fastify: FastifyInstance) {
  fastify.get("/instance/status", async (_request, reply) => {
    const instance = await fastify.prisma.instanceConfig.findFirst()

    reply.send({
      data: {
        initialized: Boolean(instance),
        setupRequired: !instance,
        instanceName: instance?.instanceName,
        version: apiConfig.appVersion,
      },
    })
  })

  fastify.post("/instance/claim", async (request, reply) => {
    const parsed = claimSchema.safeParse(request.body)

    if (!parsed.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid setup payload.",
          details: parsed.error.flatten(),
        },
      })
      return
    }

    if (await isInitialized(fastify)) {
      reply.status(409).send({
        error: {
          code: "INSTANCE_ALREADY_INITIALIZED",
          message: "This Arciin instance has already been claimed.",
        },
      })
      return
    }

    if (parsed.data.setupToken !== apiConfig.setupToken) {
      reply.status(403).send({
        error: {
          code: "INVALID_SETUP_TOKEN",
          message: "The setup token is invalid.",
        },
      })
      return
    }

    const storageRoot = path.resolve(parsed.data.storageRoot || apiConfig.dataDir)
    await ensureStorageDirectories(storageRoot)

    const passwordHash = await hashPassword(parsed.data.adminPassword)
    const selectedLibraries = DEFAULT_LIBRARY_DEFINITIONS.filter((library) =>
      parsed.data.libraries.includes(library.name)
    )

    const result = await fastify.prisma.$transaction(async (tx) => {
      const instance = await tx.instanceConfig.create({
        data: {
          instanceName: parsed.data.instanceName,
          storageRoot,
          publicUrl: apiConfig.ARCIIN_PUBLIC_URL,
          remoteAccessMode: "cloudflare-tunnel",
          remoteAccessConfig: {
            reverseProxyEnabled: false,
            cloudflareTunnelEnabled: true,
          },
          initializedAt: new Date(),
        },
      })

      const storageLocation = await tx.storageLocation.create({
        data: {
          name: "Managed Local Storage",
          type: "LOCAL",
          rootPath: storageRoot,
          isDefault: true,
        },
      })

      await tx.integration.upsert({
        where: {
          id: "plex-placeholder",
        },
        update: {},
        create: {
          id: "plex-placeholder",
          name: "Plex",
          type: "PLEX",
          enabled: false,
          config: {
            status: "not_connected",
            suggestedFolder: "Videos/Plex",
          },
        },
      })

      await tx.library.createMany({
        data: selectedLibraries.map((library) => ({
          name: library.name,
          slug: library.slug,
          kind: library.kind,
          icon: library.icon,
          storageLocationId: storageLocation.id,
        })),
      })

      const user = await tx.user.create({
        data: {
          name: parsed.data.adminName,
          email: parsed.data.adminEmail.toLowerCase(),
          passwordHash,
          role: "OWNER",
          status: "ACTIVE",
        },
      })

      await tx.activityEvent.create({
        data: {
          userId: user.id,
          type: "instance.claimed",
          title: "Instance claimed",
          message: `${user.name} claimed ${instance.instanceName}.`,
          metadata: {
            instanceName: instance.instanceName,
          },
        },
      })

      return {
        user,
      }
    })

    const { session, rawToken } = await createSession(request, result.user.id)
    setSessionCookie(reply, rawToken, session.expiresAt)

    reply.status(201).send({
      data: serializeAuth(result.user, session),
    })
  })
}
