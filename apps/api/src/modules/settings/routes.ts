import {
  AI_EMOJI_USAGE_LEVELS,
  AI_LIBRARY_TOOL_ACCESS_LEVELS,
  normalizeIpRule,
  parseAccessControlConfig,
  parseAiConfig,
  parseAiSecurityConfig,
  parseApiProtectionConfig,
  MOBILE_PAIRING_CODE_TTL_MINUTES,
} from "@arciin/shared"
import path from "node:path"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { apiConfig } from "@/config"
import { getUploadLimits, setUploadLimits } from "@/services/config/upload-limits"
import { invalidateAccessControlCache } from "@/services/security/access-control-settings"
import { invalidateApiProtectionCache } from "@/services/security/instance-security"
import { hashToken, requireRole } from "@/services/security/auth"
import { clientIpFromRequest, normalizeClientIp } from "@/services/security/client-ip"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import { enrichSecurityLogDeviceLabels } from "@/services/security/device-for-ip"
import { logIpPolicyChanges } from "@/services/security/log-ip-policy-changes"
import { isSecurityLogType, recordSecurityEvent } from "@/services/security/security-events"
import { serializeActivity } from "@/services/serializers"
import { ClearInstanceContentError, clearInstanceContent } from "@/services/settings/clear-instance-content"
import {
  getCloudflareTunnelState,
  startCloudflareQuickTunnel,
  stopCloudflareQuickTunnel,
} from "@/services/remote-access/cloudflare-tunnel"
import { resolveMobileLocalAccessUrls } from "@/services/remote-access/local-access-urls"
import { resolveCloudflareTunnelTarget, resolveMobileCloudflareTunnelTarget } from "@/services/remote-access/tunnel-target"
import {
  resolveDisplayStorageRoot,
  resolveEffectiveStorageRoot,
} from "@/services/storage/effective-storage-root"
import {
  annotateStorageVolumes,
  consolidateStorageVolumes,
  discoverStorageVolumes,
  filterMigrationTargets,
  parseLinuxMounts,
} from "@/services/storage/discover-storage"
import { requestCloudflareTunnelStart } from "@/services/remote-access/tunnel-boot"
import {
  loadEffectiveStorageRoot,
} from "@/services/storage/effective-storage-root"
import {
  MountBlockDeviceError,
  mountBlockDevice,
} from "@/services/storage/mount-block-device"
import {
  StorageMigrationError,
  storageMigrationDisplayRoot,
  validateStorageMigrationTarget,
} from "@/services/storage/migrate-storage"
import { storageQueue } from "@/services/jobs/queues"
import { JOB_TYPES } from "@arciin/shared"
import { probeStorageRoot, resolveStorageUsageBytes } from "@/services/storage/local-storage"
import {
  getMobileAppInstallStatus,
  startMobileAppInstall,
} from "@/services/mobile/mobile-app-install"
import {
  createMobilePairingCode,
  purgeExpiredMobilePairingCodes,
  revokeActiveMobilePairingCodes,
} from "@/services/mobile/mobile-pairing"
import { resolveMobileServerUrls } from "@/services/mobile/mobile-server-urls"
import {
  listMobileConnectedDevices,
  parseMobileDeviceName,
  revokeMobileConnectedDevice,
} from "@/services/mobile/mobile-sessions"
import {
  DATABASE_MIGRATION_REQUIRED,
  isPrismaMissingTableError,
} from "@/services/database/prisma-errors"

const generalSchema = z.object({
  instanceName: z.string().min(1).max(80),
})

const storageSchema = z.object({
  storageRoot: z.string().min(1),
})

const uploadLimitsSchema = z.object({
  maxUploadSizeMb: z.number().int().min(1).max(1_048_576).optional(),
  uploadRateLimitPerMinute: z.number().int().min(1).max(10_000).optional(),
})

const remoteAccessSchema = z.object({
  publicUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  mobilePublicUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  mode: z.enum(["local", "reverse-proxy", "cloudflare-tunnel"]).optional(),
  reverseProxyEnabled: z.boolean().optional(),
  cloudflareTunnelEnabled: z.boolean().optional(),
  cloudflareTunnelAutoStart: z.boolean().optional(),
})

const aiSchema = z.object({
  agent:        z.boolean().optional(),
  autonomy:     z.boolean().optional(),
  planning:     z.boolean().optional(),
  showThinking: z.boolean().optional(),
  emojiUsage:   z.enum(AI_EMOJI_USAGE_LEVELS).optional(),
})

const aiSecuritySchema = z.object({
  blockInjection:      z.boolean().optional(),
  redactSecrets:       z.boolean().optional(),
  redactPII:           z.boolean().optional(),
  readOnlyTools:       z.boolean().optional(),
  libraryToolAccess:   z.enum(AI_LIBRARY_TOOL_ACCESS_LEVELS).optional(),
  requireToolApproval: z.boolean().optional(),
  hideLibraryNames:    z.boolean().optional(),
  hideAssetCounts:     z.boolean().optional(),
  hideStorageSize:     z.boolean().optional(),
  hideUploadDates:     z.boolean().optional(),
  passwordVaultAiAccess: z.enum(["blocked", "count_only", "metadata"]).optional(),
  passwordVaultAiShare: z
    .object({
      names: z.boolean().optional(),
      usernames: z.boolean().optional(),
      urls: z.boolean().optional(),
      notes: z.boolean().optional(),
    })
    .optional(),
  passwordQueriesLocalAiOnly: z.boolean().optional(),
})

const clearDataSchema = z
  .object({
    password: z.string().min(1),
    clearChat: z.boolean(),
    clearMedia: z.boolean(),
    clearAppData: z.boolean().optional(),
  })
  .refine((b) => b.clearChat || b.clearMedia || Boolean(b.clearAppData), {
    message: "Select at least one category to clear.",
    path: ["clearMedia"],
  })

const securitySchema = z.object({
  publicSignupEnabled: z.boolean().optional(),
  sessionTimeoutMinutes: z.number().int().min(5).max(43200).optional(),
  loginAlertsEnabled: z.boolean().optional(),
  maxFailedLogins: z.number().int().min(3).max(100).optional(),
  idleLogoutEnabled: z.boolean().optional(),
  idleLogoutMinutes: z.number().int().min(5).max(480).optional(),
  ipAllowlist: z.array(z.string().max(120)).max(512).optional(),
  ipBlocklist: z.array(z.string().max(120)).max(512).optional(),
  enforceIpAllowlist: z.boolean().optional(),
  apiGlobalRequestsPerMinute: z.number().int().min(0).max(1_000_000).optional(),
  apiKeyRequestsPerMinute: z.number().int().min(0).max(1_000_000).optional(),
  requireApiKeyExpiry: z.boolean().optional(),
  maxApiKeyExpiryDays: z.number().int().min(0).max(3650).optional(),
})

export async function registerSettingsRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/settings/general",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      reply.send({
        data: {
          instanceName: instance?.instanceName ?? "Arciin",
          version: "0.1.0",
          initializedAt: instance?.initializedAt?.toISOString() ?? null,
        },
      })
    }
  )

  fastify.patch(
    "/settings/general",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = generalSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }
      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({ error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." } })
        return
      }
      const updated = await fastify.prisma.instanceConfig.update({
        where: { id: instance.id },
        data: { instanceName: parsed.data.instanceName },
      })
      reply.send({ data: { instanceName: updated.instanceName, version: "0.1.0", initializedAt: instance.initializedAt?.toISOString() ?? null } })
    }
  )

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

      const configured = instance?.storageRoot ?? defaultStorage?.rootPath
      const storageRoot = resolveEffectiveStorageRoot(configured)
      const displayStorageRoot = resolveDisplayStorageRoot(configured)
      const storageAgg = await fastify.prisma.storageObject.aggregate({
        _sum: { sizeBytes: true },
      })
      const trackedBytes = Number(storageAgg._sum.sizeBytes ?? 0)
      const usageBytes = await resolveStorageUsageBytes(storageRoot, trackedBytes)
      const objectCount = await fastify.prisma.storageObject.count()
      const { writable, totalBytes, availableBytes } = await probeStorageRoot(storageRoot)
      const discovery = await discoverStorageVolumes()

      reply.send({
        data: {
          instanceName: instance?.instanceName,
          storageRoot: displayStorageRoot,
          runtimeStorageRoot: storageRoot,
          hostStorageRoot: discovery.hostDataDir,
          isDockerRuntime: discovery.isDockerRuntime,
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

  fastify.get(
    "/settings/uploads",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
    },
    async (_request, reply) => {
      const limits = getUploadLimits()
      reply.send({
        data: {
          ...limits,
          webProxyMaxUploadSizeMb: limits.envMaxUploadSizeMb,
          webProxyRestartRequired: limits.maxUploadSizeMb > limits.envMaxUploadSizeMb,
        },
      })
    },
  )

  fastify.patch(
    "/settings/uploads",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = uploadLimitsSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid upload limits.",
            details: parsed.error.flatten(),
          },
        })
        return
      }
      if (!parsed.data.maxUploadSizeMb && !parsed.data.uploadRateLimitPerMinute) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Provide maxUploadSizeMb and/or uploadRateLimitPerMinute.",
          },
        })
        return
      }
      try {
        const limits = await setUploadLimits(parsed.data)
        reply.send({
          data: {
            ...limits,
            webProxyMaxUploadSizeMb: limits.envMaxUploadSizeMb,
            webProxyRestartRequired: limits.maxUploadSizeMb > limits.envMaxUploadSizeMb,
          },
        })
      } catch (err) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: err instanceof Error ? err.message : "Invalid upload limits.",
          },
        })
      }
    },
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

      const storageRoot = resolveEffectiveStorageRoot(parsed.data.storageRoot)
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

      const storageAgg = await fastify.prisma.storageObject.aggregate({
        _sum: { sizeBytes: true },
      })
      const trackedBytes = Number(storageAgg._sum.sizeBytes ?? 0)
      const { writable, totalBytes, availableBytes } = await probeStorageRoot(storageRoot)

      reply.send({
        data: {
          instanceName: instance.instanceName,
          storageRoot: resolveDisplayStorageRoot(storageRoot),
          runtimeStorageRoot: storageRoot,
          hostStorageRoot: process.env.ARCIIN_HOST_DATA_DIR?.trim()
            ? path.resolve(process.env.ARCIIN_HOST_DATA_DIR.trim())
            : null,
          isDockerRuntime: path.resolve(apiConfig.dataDir) === "/data/arciin",
          defaultLocationId: null,
          writable,
          usageBytes: await resolveStorageUsageBytes(storageRoot, trackedBytes),
          objectCount: await fastify.prisma.storageObject.count(),
          totalBytes,
          availableBytes,
        },
      })
    }
  )

  fastify.get(
    "/settings/storage/volumes",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const effective = await loadEffectiveStorageRoot(fastify.prisma)
      const displayRoot = resolveDisplayStorageRoot(
        (await fastify.prisma.instanceConfig.findFirst())?.storageRoot,
      )
      const discovery = await discoverStorageVolumes()
      const mounts = await parseLinuxMounts()
      const consolidatedVolumes = consolidateStorageVolumes(
        discovery.volumes,
        mounts,
        displayRoot || effective,
      )
      const discoveryForClient = { ...discovery, volumes: consolidatedVolumes }
      const volumeCtx = {
        effectiveRoot: effective,
        displayRoot,
        discovery: discoveryForClient,
      }
      const volumes = annotateStorageVolumes(discoveryForClient, {
        effectiveRoot: effective,
        displayRoot,
      })

      reply.send({
        data: {
          ...discoveryForClient,
          volumes,
          currentStorageRoot: displayRoot,
          currentEffectiveRoot: effective,
          migrationTargets: filterMigrationTargets(discoveryForClient, volumeCtx),
        },
      })
    },
  )

  fastify.get(
    "/settings/storage/migrate/status",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const job = await fastify.prisma.job.findFirst({
        where: { type: JOB_TYPES.migrateStorage },
        orderBy: { createdAt: "desc" },
      })

      if (!job) {
        reply.send({ data: { active: false, job: null } })
        return
      }

      const active = job.status === "QUEUED" || job.status === "ACTIVE"
      reply.send({
        data: {
          active,
          job: {
            id: job.id,
            status: job.status,
            progress: job.progress,
            error: job.error,
            result: job.result,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString() ?? null,
          },
        },
      })
    },
  )

  fastify.post(
    "/settings/storage/mount",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const bodySchema = z.object({
        deviceId: z.string().min(1),
        luksPassphrase: z.string().optional(),
        sudoPassword: z.string().optional(),
        formatAsExt4: z.boolean().optional(),
        confirmErase: z.boolean().optional(),
      })
      const parsed = bodySchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Invalid mount payload." },
        })
        return
      }

      try {
        const result = await mountBlockDevice(parsed.data)
        reply.send({ data: result })
      } catch (error) {
        if (error instanceof MountBlockDeviceError) {
          reply.status(400).send({
            error: { code: error.code, message: error.message },
          })
          return
        }
        throw error
      }
    },
  )

  fastify.post(
    "/settings/storage/migrate",
    { preHandler: requireRole(["OWNER"]) },
    async (request, reply) => {
      const bodySchema = z.object({ targetPath: z.string().min(1) })
      const parsed = bodySchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Invalid migration payload." },
        })
        return
      }

      try {
        const { fromRoot, toRoot, bytesToCopy } = await validateStorageMigrationTarget(
          fastify.prisma,
          parsed.data.targetPath,
        )

        const job = await fastify.prisma.job.create({
          data: {
            type: JOB_TYPES.migrateStorage,
            status: "QUEUED",
            progress: 0,
            payload: {
              fromRoot,
              toRoot,
              requestedByUserId: request.auth?.user.id,
              bytesToCopy,
            },
          },
        })

        await storageQueue.add(JOB_TYPES.migrateStorage, {
          fromRoot,
          toRoot,
          requestedByUserId: request.auth?.user.id,
          jobRecordId: job.id,
        })

        reply.status(202).send({
          data: {
            jobId: job.id,
            fromRoot,
            toRoot,
            displayRoot: storageMigrationDisplayRoot(toRoot),
          },
        })
      } catch (error) {
        if (error instanceof StorageMigrationError) {
          reply.status(400).send({
            error: { code: error.code, message: error.message },
          })
          return
        }
        throw error
      }
    },
  )

  fastify.get(
    "/settings/remote-access",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const config = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}
      const urls = await resolveMobileServerUrls(fastify.prisma, request)
      const mobileLocal = resolveMobileLocalAccessUrls()

      reply.send({
        data: {
          publicUrl: instance?.publicUrl ?? null,
          mobilePublicUrl:
            typeof config.mobilePublicUrl === "string" ? config.mobilePublicUrl : null,
          localUrl: mobileLocal.localUrl,
          loopbackUrl: mobileLocal.loopbackUrl,
          lanUrls: mobileLocal.lanUrls,
          primaryLanUrl: mobileLocal.primaryLanUrl,
          currentUrl:
            (typeof config.mobilePublicUrl === "string" ? config.mobilePublicUrl : null) ??
            instance?.publicUrl ??
            urls.requestOrigin ??
            mobileLocal.localUrl,
          requestOrigin: urls.requestOrigin,
          mode: (instance?.remoteAccessMode as string) || "local",
          reverseProxyEnabled: Boolean(config.reverseProxyEnabled),
          cloudflareTunnelEnabled: Boolean(config.cloudflareTunnelEnabled),
          cloudflareTunnelAutoStart: config.cloudflareTunnelAutoStart !== false,
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

      const prevConfig = (instance.remoteAccessConfig as Record<string, unknown> | null) || {}
      const nextConfig = {
        ...prevConfig,
        ...(parsed.data.mobilePublicUrl !== undefined
          ? {
              mobilePublicUrl:
                parsed.data.mobilePublicUrl === "" || parsed.data.mobilePublicUrl === null
                  ? null
                  : parsed.data.mobilePublicUrl,
            }
          : {}),
        reverseProxyEnabled:
          parsed.data.reverseProxyEnabled !== undefined
            ? parsed.data.reverseProxyEnabled
            : Boolean(prevConfig.reverseProxyEnabled),
        cloudflareTunnelEnabled:
          parsed.data.cloudflareTunnelEnabled !== undefined
            ? parsed.data.cloudflareTunnelEnabled
            : Boolean(prevConfig.cloudflareTunnelEnabled),
        cloudflareTunnelAutoStart:
          parsed.data.cloudflareTunnelAutoStart !== undefined
            ? parsed.data.cloudflareTunnelAutoStart
            : prevConfig.cloudflareTunnelAutoStart !== false,
      }
      const nextMode =
        parsed.data.mode !== undefined
          ? parsed.data.mode
          : ((instance.remoteAccessMode as string) || "local")
      const nextPublicUrl =
        parsed.data.publicUrl !== undefined
          ? parsed.data.publicUrl === "" || parsed.data.publicUrl === null
            ? null
            : parsed.data.publicUrl
          : (instance.publicUrl ?? null)

      const updated = await fastify.prisma.instanceConfig.update({
        where: {
          id: instance.id,
        },
        data: {
          publicUrl: nextPublicUrl,
          remoteAccessMode: nextMode,
          remoteAccessConfig: nextConfig,
        },
      })

      const urls = await resolveMobileServerUrls(fastify.prisma, request)
      const raw = (updated.remoteAccessConfig as Record<string, unknown> | null) || {}
      const mobileLocal = resolveMobileLocalAccessUrls()

      reply.send({
        data: {
          publicUrl: updated.publicUrl ?? null,
          mobilePublicUrl:
            typeof raw.mobilePublicUrl === "string" ? raw.mobilePublicUrl : null,
          localUrl: mobileLocal.localUrl,
          loopbackUrl: mobileLocal.loopbackUrl,
          lanUrls: mobileLocal.lanUrls,
          primaryLanUrl: mobileLocal.primaryLanUrl,
          currentUrl:
            (typeof raw.mobilePublicUrl === "string" ? raw.mobilePublicUrl : null) ??
            updated.publicUrl ??
            urls.requestOrigin ??
            mobileLocal.localUrl,
          requestOrigin: urls.requestOrigin,
          mode: updated.remoteAccessMode || "local",
          reverseProxyEnabled: Boolean(nextConfig.reverseProxyEnabled),
          cloudflareTunnelEnabled: Boolean(nextConfig.cloudflareTunnelEnabled),
          cloudflareTunnelAutoStart: nextConfig.cloudflareTunnelAutoStart !== false,
        },
      })

      if (nextConfig.cloudflareTunnelEnabled && nextConfig.cloudflareTunnelAutoStart !== false) {
        requestCloudflareTunnelStart(fastify)
      }
    }
  )

  fastify.get(
    "/settings/cloudflare-tunnel",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const tunnel = getCloudflareTunnelState()
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const raw = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}
      reply.send({
        data: {
          ...tunnel,
          cloudflareTunnelEnabled: Boolean(raw.cloudflareTunnelEnabled),
          publicUrl: instance?.publicUrl ?? null,
          mobilePublicUrl:
            typeof raw.mobilePublicUrl === "string" ? raw.mobilePublicUrl : null,
        },
      })
    },
  )

  fastify.post(
    "/settings/cloudflare-tunnel/start",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({
          error: {
            code: "INSTANCE_NOT_READY",
            message: "Claim the instance before starting a tunnel.",
          },
        })
        return
      }

      const localTarget = resolveCloudflareTunnelTarget()

      try {
        const url = await startCloudflareQuickTunnel(localTarget)

        if (request.auth) {
          await fastify.prisma.activityEvent.create({
            data: {
              userId: request.auth.user.id,
              type: "settings.cloudflare_tunnel_started",
              title: "Cloudflare quick tunnel started",
              message: `Public URL set to ${url}`,
            },
          })
        }

        reply.send({
          data: {
            ...getCloudflareTunnelState(),
            publicUrl: url,
            cloudflareTunnelEnabled: true,
          },
        })
      } catch (error) {
        reply.status(503).send({
          error: {
            code: "CLOUDFLARE_TUNNEL_FAILED",
            message: error instanceof Error ? error.message : "Could not start Cloudflare tunnel.",
          },
        })
      }
    },
  )

  fastify.post(
    "/settings/cloudflare-tunnel/start-mobile",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({
          error: {
            code: "INSTANCE_NOT_READY",
            message: "Claim the instance before starting a tunnel.",
          },
        })
        return
      }

      const localTarget = resolveMobileCloudflareTunnelTarget()

      try {
        const url = await startCloudflareQuickTunnel(localTarget)

        if (request.auth) {
          await fastify.prisma.activityEvent.create({
            data: {
              userId: request.auth.user.id,
              type: "settings.cloudflare_tunnel_started",
              title: "Cloudflare quick tunnel started (mobile)",
              message: `Mobile public URL set to ${url}`,
            },
          })
        }

        reply.send({
          data: {
            ...getCloudflareTunnelState(),
            mobilePublicUrl: url,
            cloudflareTunnelEnabled: true,
          },
        })
      } catch (error) {
        reply.status(503).send({
          error: {
            code: "CLOUDFLARE_TUNNEL_FAILED",
            message: error instanceof Error ? error.message : "Could not start Cloudflare tunnel.",
          },
        })
      }
    },
  )

  fastify.post(
    "/settings/cloudflare-tunnel/stop",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      stopCloudflareQuickTunnel()
      reply.send({ data: getCloudflareTunnelState() })
    },
  )

  fastify.get(
    "/settings/security/log",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const rows = await fastify.prisma.activityEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      })
      const events = rows.filter((row) => isSecurityLogType(row.type)).slice(0, 100)
      const enriched = await enrichSecurityLogDeviceLabels(fastify.prisma, events)
      reply.send({ data: enriched.map(serializeActivity) })
    },
  )

  fastify.get(
    "/settings/security",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const raw = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}
      const sec = (raw.security as Record<string, unknown> | null) || {}
      reply.send({
        data: {
          publicSignupEnabled:        Boolean(sec.publicSignupEnabled ?? false),
          sessionTimeoutMinutes:      Number(sec.sessionTimeoutMinutes ?? 1440),
          loginAlertsEnabled:         Boolean(sec.loginAlertsEnabled ?? false),
          maxFailedLogins:            Number(sec.maxFailedLogins ?? 10),
          ipAllowlist:                Array.isArray(sec.ipAllowlist) ? (sec.ipAllowlist as string[]) : [],
          ipBlocklist:                Array.isArray(sec.ipBlocklist) ? (sec.ipBlocklist as string[]) : [],
          enforceIpAllowlist:         Boolean(sec.enforceIpAllowlist ?? false),
          apiGlobalRequestsPerMinute: Number(sec.apiGlobalRequestsPerMinute ?? 0),
          apiKeyRequestsPerMinute:    Number(sec.apiKeyRequestsPerMinute ?? 0),
          requireApiKeyExpiry:        Boolean(sec.requireApiKeyExpiry ?? false),
          maxApiKeyExpiryDays:        Number(sec.maxApiKeyExpiryDays ?? 0),
          idleLogoutEnabled:          sec.idleLogoutEnabled !== false,
          idleLogoutMinutes:          Math.min(
            480,
            Math.max(5, Number(sec.idleLogoutMinutes ?? 30)),
          ),
        },
      })
    }
  )

  fastify.patch(
    "/settings/security",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = securitySchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload.", details: parsed.error.flatten() } })
        return
      }
      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({ error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." } })
        return
      }
      const raw = (instance.remoteAccessConfig as Record<string, unknown> | null) || {}
      const prevSec = (raw.security as Record<string, unknown> | null) || {}
      const prevBlocklist = Array.isArray(prevSec.ipBlocklist) ? (prevSec.ipBlocklist as string[]) : []
      const prevAllowlist = Array.isArray(prevSec.ipAllowlist) ? (prevSec.ipAllowlist as string[]) : []
      const prevEnforce = Boolean(prevSec.enforceIpAllowlist ?? false)
      const nextSec = {
        publicSignupEnabled:        parsed.data.publicSignupEnabled        ?? Boolean(prevSec.publicSignupEnabled ?? false),
        sessionTimeoutMinutes:      parsed.data.sessionTimeoutMinutes      ?? Number(prevSec.sessionTimeoutMinutes ?? 1440),
        loginAlertsEnabled:         parsed.data.loginAlertsEnabled         ?? Boolean(prevSec.loginAlertsEnabled ?? false),
        maxFailedLogins:            parsed.data.maxFailedLogins            ?? Number(prevSec.maxFailedLogins ?? 10),
        ipAllowlist:                parsed.data.ipAllowlist                ?? prevAllowlist,
        ipBlocklist:                parsed.data.ipBlocklist                ?? prevBlocklist,
        enforceIpAllowlist:         parsed.data.enforceIpAllowlist         ?? prevEnforce,
        apiGlobalRequestsPerMinute: parsed.data.apiGlobalRequestsPerMinute ?? Number(prevSec.apiGlobalRequestsPerMinute ?? 0),
        apiKeyRequestsPerMinute:    parsed.data.apiKeyRequestsPerMinute    ?? Number(prevSec.apiKeyRequestsPerMinute ?? 0),
        requireApiKeyExpiry:        parsed.data.requireApiKeyExpiry        ?? Boolean(prevSec.requireApiKeyExpiry ?? false),
        maxApiKeyExpiryDays:        parsed.data.maxApiKeyExpiryDays        ?? Number(prevSec.maxApiKeyExpiryDays ?? 0),
        idleLogoutEnabled:          parsed.data.idleLogoutEnabled          ?? prevSec.idleLogoutEnabled !== false,
        idleLogoutMinutes:          parsed.data.idleLogoutMinutes          ?? Math.min(
          480,
          Math.max(5, Number(prevSec.idleLogoutMinutes ?? 30)),
        ),
      }
      await fastify.prisma.instanceConfig.update({
        where: { id: instance.id },
        data: { remoteAccessConfig: { ...raw, security: nextSec } },
      })
      invalidateApiProtectionCache()
      invalidateAccessControlCache()

      const user = request.auth!.user
      await logIpPolicyChanges(fastify, {
        actorUserId: user.id,
        actorName: user.name,
        actorIp: normalizeClientIp(clientIpFromRequest(request)),
        prevBlocklist,
        nextBlocklist: nextSec.ipBlocklist,
        prevAllowlist,
        nextAllowlist: nextSec.ipAllowlist,
        prevEnforce,
        nextEnforce: nextSec.enforceIpAllowlist,
      })

      reply.send({ data: nextSec })
    }
  )

  fastify.get(
    "/settings/access-control/status",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const raw = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}
      const access = parseAccessControlConfig(raw.security)

      const [userCount, activeSessions, ownerCount] = await Promise.all([
        fastify.prisma.user.count(),
        fastify.prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
        fastify.prisma.user.count({ where: { role: "OWNER" } }),
      ])

      reply.send({
        data: {
          instanceInitialized: Boolean(instance),
          setupLocked: Boolean(instance),
          userCount,
          activeSessions,
          ownerCount,
          publicSignupEnabled: access.publicSignupEnabled,
          sessionTimeoutMinutes: access.sessionTimeoutMinutes,
          loginAlertsEnabled: access.loginAlertsEnabled,
          maxFailedLogins: access.maxFailedLogins,
          idleLogoutEnabled: access.idleLogoutEnabled,
          idleLogoutMinutes: access.idleLogoutMinutes,
          passwordHashing: "Argon2id",
          sessionStorage: "hashed",
          cookieFlags: "httpOnly, SameSite=Lax",
        },
      })
    },
  )

  fastify.post(
    "/settings/access-control/revoke-all-sessions",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const user = request.auth!.user
      const currentToken = request.cookies[apiConfig.SESSION_COOKIE_NAME]
      const currentHash = currentToken ? hashToken(currentToken) : null

      const result = await fastify.prisma.session.deleteMany({
        where: {
          expiresAt: { gt: new Date() },
          ...(currentHash ? { tokenHash: { not: currentHash } } : {}),
        },
      })

      await recordSecurityEvent(fastify, {
        userId: user.id,
        type: "auth.sessions_revoked",
        title: "Sessions revoked",
        message: `${user.name} revoked ${result.count} active session(s) instance-wide.`,
        metadata: { status: "policy" },
      })

      reply.send({ data: { revoked: result.count } })
    },
  )

  fastify.get(
    "/settings/api-protection/status",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const raw = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}
      const protection = parseApiProtectionConfig(raw.security)

      const minute = String(Math.floor(Date.now() / 60_000))
      let requestsThisMinute: number | null = null
      if (protection.apiGlobalRequestsPerMinute > 0) {
        const rawCount = await fastify.redis.get(`arciin:rpm:global:${minute}`)
        requestsThisMinute = rawCount ? Number(rawCount) : 0
      }

      const activeApiKeys = await fastify.prisma.apiKey.count({
        where: { revokedAt: null },
      })

      reply.send({
        data: {
          activeApiKeys,
          requestsThisMinute,
          globalLimitPerMinute: protection.apiGlobalRequestsPerMinute,
          globalLimitEnabled: protection.apiGlobalRequestsPerMinute > 0,
          perKeyLimitPerMinute: protection.apiKeyRequestsPerMinute,
          perKeyLimitEnabled: protection.apiKeyRequestsPerMinute > 0,
          allowlistCount: protection.ipAllowlist.length,
          blocklistCount: protection.ipBlocklist.length,
          enforceIpAllowlist: protection.enforceIpAllowlist,
          requireApiKeyExpiry: protection.requireApiKeyExpiry,
          maxApiKeyExpiryDays: protection.maxApiKeyExpiryDays,
        },
      })
    },
  )

  fastify.post(
    "/settings/api-protection/ip-rules",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = z
        .object({
          action: z.enum(["block", "allow", "unblock", "disallow"]),
          ip: z.string().min(1).max(120),
        })
        .safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid IP rule payload." } })
        return
      }

      const normalized = normalizeIpRule(parsed.data.ip)
      if (!normalized) {
        reply.status(400).send({
          error: { code: "INVALID_IP", message: "Enter a valid IPv4 address or CIDR (e.g. 203.0.113.10 or 10.0.0.0/8)." },
        })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({ error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." } })
        return
      }

      const raw = (instance.remoteAccessConfig as Record<string, unknown> | null) || {}
      const prevSec = (raw.security as Record<string, unknown> | null) || {}
      const protection = parseApiProtectionConfig(prevSec)

      let blocklist = [...protection.ipBlocklist]
      let allowlist = [...protection.ipAllowlist]

      switch (parsed.data.action) {
        case "block":
          if (!blocklist.includes(normalized)) blocklist.push(normalized)
          allowlist = allowlist.filter((x) => x !== normalized)
          break
        case "unblock":
          blocklist = blocklist.filter((x) => x !== normalized)
          break
        case "allow":
          if (!allowlist.includes(normalized)) allowlist.push(normalized)
          blocklist = blocklist.filter((x) => x !== normalized)
          break
        case "disallow":
          allowlist = allowlist.filter((x) => x !== normalized)
          break
      }

      const nextSec = {
        ...prevSec,
        ipBlocklist: blocklist,
        ipAllowlist: allowlist,
      }

      const prevBlocklist = [...protection.ipBlocklist]
      const prevAllowlist = [...protection.ipAllowlist]

      await fastify.prisma.instanceConfig.update({
        where: { id: instance.id },
        data: { remoteAccessConfig: { ...raw, security: nextSec } },
      })
      invalidateApiProtectionCache()

      const user = request.auth!.user
      await logIpPolicyChanges(fastify, {
        actorUserId: user.id,
        actorName: user.name,
        actorIp: normalizeClientIp(clientIpFromRequest(request)),
        prevBlocklist,
        nextBlocklist: blocklist,
        prevAllowlist,
        nextAllowlist: allowlist,
        prevEnforce: protection.enforceIpAllowlist,
        nextEnforce: protection.enforceIpAllowlist,
      })

      reply.send({
        data: {
          ipBlocklist: blocklist,
          ipAllowlist: allowlist,
        },
      })
    },
  )

  // ── AI Agent settings ────────────────────────────────────────────────────────

  function getAiCfg(instance: { aiConfig: unknown }): Record<string, unknown> {
    return (instance.aiConfig as Record<string, unknown> | null) ?? {}
  }

  fastify.get(
    "/settings/ai",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const cfg = getAiCfg(instance ?? { aiConfig: null })
      reply.send({ data: parseAiConfig(cfg) })
    }
  )

  fastify.patch(
    "/settings/ai",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = aiSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload." } })
        return
      }
      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({ error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." } })
        return
      }
      const prev = getAiCfg(instance)
      const next: Record<string, unknown> = { ...prev, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) }
      await fastify.prisma.instanceConfig.update({ where: { id: instance.id }, data: { aiConfig: next as unknown as import("@prisma/client").Prisma.InputJsonValue } })
      reply.send({ data: parseAiConfig(next) })
    }
  )

  // ── AI Security settings ─────────────────────────────────────────────────────

  fastify.get(
    "/settings/ai-security",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const cfg = getAiCfg(instance ?? { aiConfig: null })
      const sec = (cfg.security as Record<string, unknown> | null) ?? {}
      reply.send({ data: parseAiSecurityConfig(sec) })
    }
  )

  fastify.patch(
    "/settings/ai-security",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = aiSecuritySchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid payload." } })
        return
      }
      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({ error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." } })
        return
      }
      const prev = getAiCfg(instance)
      const prevSec = (prev.security as Record<string, unknown> | null) ?? {}
      const nextSec: Record<string, unknown> = { ...prevSec, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) }
      if (parsed.data.libraryToolAccess !== undefined) {
        nextSec.libraryToolAccess = parsed.data.libraryToolAccess
        nextSec.readOnlyTools = parsed.data.libraryToolAccess === "vision_only"
      } else if (parsed.data.readOnlyTools !== undefined) {
        nextSec.libraryToolAccess = parsed.data.readOnlyTools ? "vision_only" : "full"
        nextSec.readOnlyTools = parsed.data.readOnlyTools
      }
      await fastify.prisma.instanceConfig.update({ where: { id: instance.id }, data: { aiConfig: { ...prev, security: nextSec } as unknown as import("@prisma/client").Prisma.InputJsonValue } })
      reply.send({ data: parseAiSecurityConfig(nextSec) })
    }
  )

  fastify.post(
    "/settings/clear-data",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = clearDataSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid clear-data payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const user = request.auth!.user
      try {
        await clearInstanceContent(fastify.prisma, user.id, parsed.data.password, {
          clearChat: parsed.data.clearChat,
          clearMedia: parsed.data.clearMedia,
          clearAppData: parsed.data.clearAppData ?? false,
        })
      } catch (err) {
        if (err instanceof ClearInstanceContentError) {
          if (err.code === "INVALID_PASSWORD") {
            reply.status(401).send({
              error: { code: "INVALID_PASSWORD", message: err.message },
            })
            return
          }
          if (err.code === "NOTHING_SELECTED") {
            reply.status(400).send({
              error: { code: "VALIDATION_ERROR", message: err.message },
            })
            return
          }
        }
        reply.status(500).send({
          error: {
            code: "CLEAR_FAILED",
            message: err instanceof Error ? err.message : "Could not clear instance data.",
          },
        })
        return
      }

      reply.send({ data: { ok: true as const } })
    },
  )

  fastify.get(
    "/settings/mobile-connection",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      if (!request.auth) return
      try {
        await purgeExpiredMobilePairingCodes(fastify.prisma)

        const active = await fastify.prisma.mobilePairingCode.findFirst({
          where: {
            createdById: request.auth.user.id,
            usedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: "desc" },
        })

        const urls = await resolveMobileServerUrls(fastify.prisma, request)
        const devices = await listMobileConnectedDevices(fastify.prisma)

        reply.send({
          data: {
            ttlMinutes: MOBILE_PAIRING_CODE_TTL_MINUTES,
            activeCode: active
              ? {
                  expiresAt: active.expiresAt.toISOString(),
                  createdAt: active.createdAt.toISOString(),
                }
              : null,
            server: urls,
            devices,
          },
        })
      } catch (err) {
        if (isPrismaMissingTableError(err)) {
          reply.status(503).send({ error: DATABASE_MIGRATION_REQUIRED })
          return
        }
        throw err
      }
    },
  )

  fastify.post(
    "/settings/mobile-connection/code",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      if (!request.auth) return
      try {
        const { code, expiresAt } = await createMobilePairingCode(
          fastify.prisma,
          request.auth.user.id,
        )

        reply.send({
          data: {
            code,
            expiresAt: expiresAt.toISOString(),
            ttlMinutes: MOBILE_PAIRING_CODE_TTL_MINUTES,
          },
        })
      } catch (err) {
        if (isPrismaMissingTableError(err)) {
          reply.status(503).send({ error: DATABASE_MIGRATION_REQUIRED })
          return
        }
        throw err
      }
    },
  )

  fastify.delete(
    "/settings/mobile-connection/code",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      if (!request.auth) return
      try {
        await revokeActiveMobilePairingCodes(fastify.prisma, request.auth.user.id)
        reply.send({ data: { revoked: true as const } })
      } catch (err) {
        if (isPrismaMissingTableError(err)) {
          reply.status(503).send({ error: DATABASE_MIGRATION_REQUIRED })
          return
        }
        throw err
      }
    },
  )

  fastify.delete(
    "/settings/mobile-connection/devices/:id",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      if (!request.auth) return
      const { id } = request.params as { id: string }

      try {
        const removed = await revokeMobileConnectedDevice(fastify.prisma, id)
        if (!removed) {
          reply.status(404).send({
            error: {
              code: "MOBILE_SESSION_NOT_FOUND",
              message: "That mobile session is not active or was already disconnected.",
            },
          })
          return
        }

        await recordSecurityEvent(fastify, {
          userId: request.auth.user.id,
          type: "auth.sessions_revoked",
          title: "Mobile device disconnected",
          message: `${request.auth.user.name} revoked mobile access for ${removed.user.name} (${parseMobileDeviceName(removed.userAgent)}).`,
          metadata: { status: "mobile_disconnect", actorUserId: removed.user.id },
        })

        reply.send({ data: { revoked: true as const } })
      } catch (err) {
        if (isPrismaMissingTableError(err)) {
          reply.status(503).send({ error: DATABASE_MIGRATION_REQUIRED })
          return
        }
        throw err
      }
    },
  )

  fastify.get(
    "/settings/mobile-app",
    { preHandler: requireRole(["OWNER"]) },
    async (_request, reply) => {
      reply.send({ data: await getMobileAppInstallStatus() })
    },
  )

  fastify.post(
    "/settings/mobile-app/install",
    { preHandler: requireRole(["OWNER"]) },
    async (request, reply) => {
      if (
        await checkEndpointRateLimit(request, reply, {
          key: `mobile-app-install:${request.ip}`,
          limit: 3,
          windowSec: 3600,
        })
      ) {
        return
      }

      try {
        reply.status(202).send({ data: await startMobileAppInstall() })
      } catch (err) {
        reply.status(400).send({
          error: {
            code: "MOBILE_INSTALL_FAILED",
            message: err instanceof Error ? err.message : "Could not start mobile install.",
          },
        })
      }
    },
  )
}
