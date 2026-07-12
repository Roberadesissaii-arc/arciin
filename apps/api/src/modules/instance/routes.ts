import { timingSafeEqual } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { DEFAULT_LIBRARY_DEFINITIONS, DEFAULT_USER_PREFERENCES } from "@arciin/shared"

import { apiConfig } from "@/config"
import { clientIpFromRequest } from "@/services/security/client-ip"
import { checkForUpdate, invalidateUpdateCheckCache } from "@/services/instance/update-check"

/** Length-safe, constant-time string compare (avoids setup-token timing leaks). */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
import { resolveEffectiveStorageRoot } from "@/services/storage/effective-storage-root"
import { serializeAuth } from "@/services/serializers"
import { createSession, hashPassword, requireRole, setSessionCookie } from "@/services/security/auth"
import { hashRecoveryAnswer } from "@/services/security/recovery-answer"
import {
  consolidateStorageVolumes,
  discoverStorageVolumes,
  parseLinuxMounts,
  prepareStoragePathForSetup,
} from "@/services/storage/discover-storage"
import {
  ensureStorageDirectories,
  probeStorageRoot,
  resolveStorageUsageBytes,
} from "@/services/storage/local-storage"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"

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
    recoveryQuestion: z.string().trim().min(4).max(200).optional(),
    recoveryAnswer: z.string().trim().min(2).max(200).optional(),
  })
  .superRefine((data, ctx) => {
    const hasQuestion = Boolean(data.recoveryQuestion?.trim())
    const hasAnswer = Boolean(data.recoveryAnswer?.trim())
    if (hasQuestion !== hasAnswer) {
      ctx.addIssue({
        code: "custom",
        message: "Provide both a security question and answer, or leave both empty.",
        path: ["recoveryQuestion"],
      })
    }
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

    const discovery = await discoverStorageVolumes()
    const suggested =
      discovery.isDockerRuntime && discovery.hostDataDir
        ? discovery.hostDataDir
        : discovery.recommendedArciinPath

    reply.send({
      data: {
        initialized: Boolean(instance),
        setupRequired: !instance,
        instanceName: instance?.instanceName,
        version: apiConfig.appVersion,
        /**
         * Prefill the setup UI so the owner never re-types the token on their own
         * server. Only returned before the instance is claimed (the setup window),
         * and never after — claiming locks it permanently.
         */
        setupTokenPrefill: !instance ? apiConfig.setupToken : undefined,
        suggestedStorageRoot: suggested,
        runtimeStorageRoot: discovery.runtimeDataDir,
        hostStorageRoot: discovery.hostDataDir,
        isDockerRuntime: discovery.isDockerRuntime,
        storageRootHint: discovery.isDockerRuntime
          ? discovery.hostDataDir
            ? `Docker: container path /data/arciin is bind-mounted from ${discovery.hostDataDir} on the host. Re-run ./scripts/docker-setup.sh to change the host folder.`
            : "Docker: set ARCIIN_HOST_DATA_DIR in .env (default /srv/arciin-storage/arciin) and run ./scripts/docker-setup.sh before claim."
          : discovery.recommendedArciinPath.startsWith("/srv/")
            ? "Files are stored outside the application folder on this server."
            : undefined,
      },
    })
  })

  fastify.get(
    "/instance/update-check",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]) },
    async (request, reply) => {
      const query = request.query as { refresh?: string }
      if (query.refresh === "1" || query.refresh === "true") {
        invalidateUpdateCheckCache()
      }
      const result = await checkForUpdate()
      reply.send({ data: result })
    },
  )

  fastify.get("/instance/storage-discovery", async (_request, reply) => {
    if (await isInitialized(fastify)) {
      reply.status(409).send({
        error: {
          code: "INSTANCE_ALREADY_INITIALIZED",
          message: "Storage discovery is only available before claim.",
        },
      })
      return
    }

    const discovery = await discoverStorageVolumes()
    const mounts = await parseLinuxMounts()
    const volumes = consolidateStorageVolumes(
      discovery.volumes,
      mounts,
      discovery.runtimeDataDir,
    )
    reply.send({ data: { ...discovery, volumes } })
  })

  fastify.post("/instance/storage-prepare", async (request, reply) => {
    if (await checkEndpointRateLimit(request, reply, { key: "storage-prepare", limit: 20, windowSec: 300 })) {
      return
    }

    if (await isInitialized(fastify)) {
      reply.status(409).send({
        error: {
          code: "INSTANCE_ALREADY_INITIALIZED",
          message: "Storage preparation is only available before claim.",
        },
      })
      return
    }

    const bodySchema = z.object({ path: z.string().min(1) })
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid path.", details: parsed.error.flatten() },
      })
      return
    }

    try {
      const result = await prepareStoragePathForSetup(parsed.data.path)
      reply.send({ data: result })
    } catch (error) {
      const code = error instanceof Error ? error.message : "PREPARE_FAILED"
      if (code === "INVALID_PATH" || code === "PATH_NOT_ALLOWED") {
        reply.status(400).send({
          error: {
            code,
            message:
              "Path must be an absolute folder under /srv, /mnt, /media, or /data (no parent traversal).",
          },
        })
        return
      }
      reply.status(500).send({
        error: { code: "PREPARE_FAILED", message: "Could not create or verify the storage directory." },
      })
    }
  })

  fastify.post("/instance/claim", async (request, reply) => {
    // Per-IP throttle on the (api-protection-exempt) claim endpoint so the
    // setup token can't be brute-forced before the instance is claimed.
    const claimIp = clientIpFromRequest(request)
    if (await checkEndpointRateLimit(request, reply, { key: `claim:${claimIp}`, limit: 5, windowSec: 3600 })) return
    if (await checkEndpointRateLimit(request, reply, { key: "claim:global", limit: 20, windowSec: 300 })) return

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

    if (!constantTimeEqual(parsed.data.setupToken, apiConfig.setupToken)) {
      reply.status(403).send({
        error: {
          code: "INVALID_SETUP_TOKEN",
          message: "The setup token is invalid.",
        },
      })
      return
    }

    const storageRoot = resolveEffectiveStorageRoot(
      parsed.data.storageRoot || apiConfig.dataDir,
    )
    await ensureStorageDirectories(storageRoot)

    const passwordHash = await hashPassword(parsed.data.adminPassword)
    const recoveryAnswerHash =
      parsed.data.recoveryQuestion?.trim() && parsed.data.recoveryAnswer?.trim()
        ? await hashRecoveryAnswer(parsed.data.recoveryAnswer)
        : null
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
            plexFolderName: "Plex",
            librarySlugs: ["videos", "images", "music"],
            foldersReady: false,
          },
        },
      })

      await tx.integration.upsert({
        where: { id: "jellyfin-connector" },
        update: {},
        create: {
          id: "jellyfin-connector",
          name: "Jellyfin",
          type: "CUSTOM",
          enabled: false,
          config: {
            status: "not_connected",
            connectorKind: "jellyfin",
            librarySlugs: ["videos", "images", "music"],
            foldersReady: false,
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
          recoveryQuestion: parsed.data.recoveryQuestion?.trim() || null,
          recoveryAnswerHash,
          role: "OWNER",
          status: "ACTIVE",
          preferences: DEFAULT_USER_PREFERENCES,
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
    setSessionCookie(reply, rawToken, session.expiresAt, request)

    reply.status(201).send({
      data: serializeAuth(result.user, session),
    })
  })

  fastify.get(
    "/instance/storage-summary",
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const defaultStorage = await fastify.prisma.storageLocation.findFirst({
        where: { isDefault: true },
      })

      const storageRoot = resolveEffectiveStorageRoot(
        instance?.storageRoot ?? defaultStorage?.rootPath,
      )
      const storageAgg = await fastify.prisma.storageObject.aggregate({
        _sum: { sizeBytes: true },
      })
      const trackedBytes = Number(storageAgg._sum.sizeBytes ?? 0)
      const usageBytes = await resolveStorageUsageBytes(storageRoot, trackedBytes)
      const objectCount = await fastify.prisma.storageObject.count()
      const { writable, totalBytes, availableBytes } = await probeStorageRoot(storageRoot)

      reply.send({
        data: {
          usageBytes,
          objectCount,
          totalBytes,
          availableBytes,
          writable,
        },
      })
    },
  )
}
