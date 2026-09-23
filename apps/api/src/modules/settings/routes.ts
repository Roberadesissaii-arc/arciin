import {
  AI_EMOJI_USAGE_LEVELS,
  AI_LIBRARY_TOOL_ACCESS_LEVELS,
  normalizeIpRule,
  parseAccessControlConfig,
  parseAiConfig,
  parseAiSecurityConfig,
  parseApiProtectionConfig,
  MOBILE_PAIRING_CODE_TTL_MINUTES,
  renderDiscordTestMessage,
  renderEmailTestMessage,
} from "@arciin/shared"
import path from "node:path"

import { Prisma } from "@prisma/client"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { apiConfig } from "@/config"
import { getUploadLimits, setUploadLimits } from "@/services/config/upload-limits"
import { invalidateAccessControlCache } from "@/services/security/access-control-settings"
import { invalidateApiProtectionCache } from "@/services/security/instance-security"
import { hashToken, requireFeature, requireSessionRole } from "@/services/security/auth"
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
import {
  resolveLocalAccessUrls,
  resolveMobileLocalAccessUrls,
} from "@/services/remote-access/local-access-urls"
import { resolveCloudflareTunnelTarget } from "@/services/remote-access/tunnel-target"
import {
  emailConfigSchema,
  mergeEmailConfig,
  parseStoredEmailConfig,
  serializeEmailConfig,
} from "@/services/email/email-config"
import {
  loadEmailConfig,
  resolveNotifyRecipient,
  sendEmail,
} from "@/services/email/send-email"
import { announcePublicUrlChange, notifyPublicUrlChanged } from "@/services/email/notify-public-url"
import {
  discordConfigSchema,
  mergeDiscordConfig,
  parseStoredDiscordConfig,
  serializeDiscordConfig,
} from "@/services/discord/discord-config"
import { loadDiscordConfig, sendDiscordMessage } from "@/services/discord/send-discord"
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
  // Without this the field is stripped by the schema, the write is a no-op, and
  // the switch springs back on the next refetch — indistinguishable from a UI
  // that refuses to stay on.
  canvasImages: z.boolean().optional(),
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      reply.send({
        data: {
          instanceName: instance?.instanceName ?? "Arciin",
          version: apiConfig.appVersion,
          initializedAt: instance?.initializedAt?.toISOString() ?? null,
        },
      })
    }
  )

  fastify.patch(
    "/settings/general",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
      reply.send({
        data: {
          instanceName: updated.instanceName,
          version: apiConfig.appVersion,
          initializedAt: instance.initializedAt?.toISOString() ?? null,
        },
      })
    }
  )

  fastify.get(
    "/settings/storage",
    {
      preHandler: requireSessionRole(["OWNER", "ADMIN"]),
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
      preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
      preHandler: requireSessionRole(["OWNER", "ADMIN"]),
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER"]) },
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
      preHandler: requireSessionRole(["OWNER", "ADMIN"]),
    },
    async (request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const config = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}
      const urls = await resolveMobileServerUrls(fastify.prisma, request)
      const mobileLocal = resolveMobileLocalAccessUrls()
      const desktopLocal = resolveLocalAccessUrls()

      reply.send({
        data: {
          publicUrl: instance?.publicUrl ?? null,
          mobilePublicUrl:
            typeof config.mobilePublicUrl === "string" ? config.mobilePublicUrl : null,
          /**
           * These describe the desktop web app, which is what the page is
           * about and what the tunnel forwards to. They were built from the
           * mobile resolver, so every address on the page — "This machine" and
           * each LAN row — rendered the mobile port and claimed to be the
           * server's address.
           */
          localUrl: desktopLocal.localUrl,
          loopbackUrl: desktopLocal.loopbackUrl,
          lanUrls: desktopLocal.lanUrls,
          primaryLanUrl: desktopLocal.primaryLanUrl,
          /** The mobile PWA is a second entry point on its own port. */
          mobileLocal: {
            loopbackUrl: mobileLocal.loopbackUrl,
            lanUrls: mobileLocal.lanUrls,
            primaryLanUrl: mobileLocal.primaryLanUrl,
            webPort: mobileLocal.webPort,
          },
          webPort: desktopLocal.webPort,
          currentUrl:
            (typeof config.mobilePublicUrl === "string" ? config.mobilePublicUrl : null) ??
            instance?.publicUrl ??
            urls.requestOrigin ??
            desktopLocal.localUrl,
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
      preHandler: requireSessionRole(["OWNER", "ADMIN"]),
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
      const desktopLocal = resolveLocalAccessUrls()

      reply.send({
        data: {
          publicUrl: updated.publicUrl ?? null,
          mobilePublicUrl:
            typeof raw.mobilePublicUrl === "string" ? raw.mobilePublicUrl : null,
          localUrl: desktopLocal.localUrl,
          loopbackUrl: desktopLocal.loopbackUrl,
          lanUrls: desktopLocal.lanUrls,
          primaryLanUrl: desktopLocal.primaryLanUrl,
          mobileLocal: {
            loopbackUrl: mobileLocal.loopbackUrl,
            lanUrls: mobileLocal.lanUrls,
            primaryLanUrl: mobileLocal.primaryLanUrl,
            webPort: mobileLocal.webPort,
          },
          webPort: desktopLocal.webPort,
          currentUrl:
            (typeof raw.mobilePublicUrl === "string" ? raw.mobilePublicUrl : null) ??
            updated.publicUrl ??
            urls.requestOrigin ??
            desktopLocal.localUrl,
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    {
      preHandler: [
        requireSessionRole(["OWNER", "ADMIN"]),
        // The remote-access helper is a Pro capability. Stopping a tunnel is
        // deliberately left ungated: an entitlement lapse must never leave a
        // customer unable to close their own front door.
        requireFeature("ops.remote_access_helper"),
      ],
    },
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
        // Explicit user action: always mint a fresh address so a reset really resets
        // (and therefore actually notifies).
        const url = await startCloudflareQuickTunnel(localTarget, { force: true })

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
    {
      preHandler: [
        requireSessionRole(["OWNER", "ADMIN"]),
        // The remote-access helper is a Pro capability. Stopping a tunnel is
        // deliberately left ungated: an entitlement lapse must never leave a
        // customer unable to close their own front door.
        requireFeature("ops.remote_access_helper"),
      ],
    },
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

      // Deliberately the *same* target as /start. Only one cloudflared process
      // can exist, so a separate mobile tunnel could only ever be created by
      // killing the desktop one — which is exactly the bug this endpoint used
      // to cause. One tunnel fronts the desktop origin and apps/web/proxy.ts
      // serves the mobile PWA to phones on that same domain.
      const localTarget = resolveCloudflareTunnelTarget()

      try {
        // Explicit user action: always mint a fresh address so a reset really resets
        // (and therefore actually notifies).
        const url = await startCloudflareQuickTunnel(localTarget, { force: true })

        if (request.auth) {
          await fastify.prisma.activityEvent.create({
            data: {
              userId: request.auth.user.id,
              type: "settings.cloudflare_tunnel_started",
              title: "Cloudflare quick tunnel started",
              message: `Public URL set to ${url} (serves desktop and mobile)`,
            },
          })
        }

        reply.send({
          data: {
            ...getCloudflareTunnelState(),
            publicUrl: url,
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      stopCloudflareQuickTunnel()
      reply.send({ data: getCloudflareTunnelState() })
    },
  )

  // ---------------------------------------------------------------------------
  // Email delivery
  //
  // The instance mails you the new public address when the tunnel restarts,
  // because that restart normally happens while you are away from the server —
  // which is exactly when the old link stops working and you cannot read the
  // new one off the screen.
  // ---------------------------------------------------------------------------

  fastify.get(
    "/settings/email",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const config = await loadEmailConfig(fastify.prisma)
      const fallbackRecipient = await resolveNotifyRecipient(fastify.prisma, config)

      reply.send({
        data: {
          ...serializeEmailConfig(config),
          // Shown as the placeholder so the owner can see where mail will go
          // before they set an explicit address.
          effectiveNotifyAddress: fallbackRecipient,
        },
      })
    },
  )

  fastify.put(
    "/settings/email",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = emailConfigSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid email settings.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({
          error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." },
        })
        return
      }

      const existing = parseStoredEmailConfig(instance.emailConfig)
      const merged = mergeEmailConfig(existing, parsed.data)

      const updated = await fastify.prisma.instanceConfig.update({
        where: { id: instance.id },
        data: { emailConfig: merged as unknown as object },
        select: { emailConfig: true },
      })

      await recordSecurityEvent(fastify, {
        type: "settings.email_updated",
        title: "Email settings updated",
        // Host only — never the username, never the password.
        message: `SMTP delivery configured via ${merged.host}.`,
        metadata: { reason: `${merged.host}:${merged.port}` },
      }).catch(() => {})

      reply.send({ data: serializeEmailConfig(parseStoredEmailConfig(updated.emailConfig)) })
    },
  )

  fastify.delete(
    "/settings/email",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({
          error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." },
        })
        return
      }

      await fastify.prisma.instanceConfig.update({
        where: { id: instance.id },
        data: { emailConfig: Prisma.DbNull },
      })

      reply.send({ data: serializeEmailConfig(null) })
    },
  )

  fastify.post(
    "/settings/email/test",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      if (
        await checkEndpointRateLimit(request, reply, {
          // A test button that talks to an arbitrary host is an outbound-request
          // primitive; rate limit it like one.
          key: `settings-email-test:${request.auth?.user.id ?? request.ip}`,
          limit: 5,
          windowSec: 300,
          perIp: false,
        })
      ) {
        return
      }

      const config = await loadEmailConfig(fastify.prisma)
      if (!config) {
        reply.status(409).send({
          error: {
            code: "EMAIL_NOT_CONFIGURED",
            message: "Save your SMTP settings before sending a test.",
          },
        })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst({
        select: { instanceName: true },
      })
      const to = await resolveNotifyRecipient(fastify.prisma, config)

      const result = await sendEmail(fastify, {
        to,
        config,
        message: renderEmailTestMessage(instance?.instanceName ?? "Arciin"),
      })

      if (!result.ok) {
        reply.status(result.code === "SEND_FAILED" ? 502 : 409).send({
          error: { code: result.code, message: result.message },
        })
        return
      }

      reply.send({ data: { sent: true, to: result.to } })
    },
  )

  // ---------------------------------------------------------------------------
  // Discord delivery
  // ---------------------------------------------------------------------------

  fastify.get(
    "/settings/discord",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const config = await loadDiscordConfig(fastify.prisma)
      reply.send({ data: serializeDiscordConfig(config) })
    },
  )

  fastify.put(
    "/settings/discord",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = discordConfigSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid Discord settings.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({
          error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." },
        })
        return
      }

      const merged = mergeDiscordConfig(
        parseStoredDiscordConfig(instance.discordConfig),
        parsed.data,
      )

      const updated = await fastify.prisma.instanceConfig.update({
        where: { id: instance.id },
        data: { discordConfig: merged as unknown as object },
        select: { discordConfig: true },
      })

      // No webhook detail in the audit trail — the URL is the credential.
      await recordSecurityEvent(fastify, {
        type: "settings.discord_updated",
        title: "Discord settings updated",
        message: merged.webhookUrlEncrypted
          ? "A Discord webhook is configured for this instance."
          : "The Discord webhook was removed.",
      }).catch(() => {})

      reply.send({ data: serializeDiscordConfig(parseStoredDiscordConfig(updated.discordConfig)) })
    },
  )

  fastify.delete(
    "/settings/discord",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      if (!instance) {
        reply.status(409).send({
          error: { code: "INSTANCE_NOT_READY", message: "Instance not initialized." },
        })
        return
      }

      await fastify.prisma.instanceConfig.update({
        where: { id: instance.id },
        data: { discordConfig: Prisma.DbNull },
      })

      reply.send({ data: serializeDiscordConfig(null) })
    },
  )

  fastify.post(
    "/settings/discord/test",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      if (
        await checkEndpointRateLimit(request, reply, {
          // Posting to a user-supplied URL is an outbound-request primitive.
          key: `settings-discord-test:${request.auth?.user.id ?? request.ip}`,
          limit: 5,
          windowSec: 300,
          perIp: false,
        })
      ) {
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst({
        select: { instanceName: true },
      })
      const result = await sendDiscordMessage(fastify, {
        payload: renderDiscordTestMessage(instance?.instanceName ?? "Arciin"),
      })

      if (!result.ok) {
        reply.status(result.code === "SEND_FAILED" ? 502 : 409).send({
          error: { code: result.code, message: result.message },
        })
        return
      }

      reply.send({ data: { sent: true } })
    },
  )

  /** Re-send the current address on demand — "text me the link" from Settings. */
  fastify.post(
    "/settings/email/send-current-url",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      if (
        await checkEndpointRateLimit(request, reply, {
          key: `settings-email-url:${request.auth?.user.id ?? request.ip}`,
          limit: 5,
          windowSec: 300,
          perIp: false,
        })
      ) {
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()
      const config = (instance?.remoteAccessConfig as Record<string, unknown> | null) || {}
      const publicUrl =
        (typeof config.mobilePublicUrl === "string" ? config.mobilePublicUrl : null) ??
        instance?.publicUrl ??
        null

      if (!publicUrl) {
        reply.status(409).send({
          error: {
            code: "NO_PUBLIC_URL",
            message: "This instance has no public address yet. Generate one first.",
          },
        })
        return
      }

      // Both channels, once each. Succeeding on either is a success — someone
      // with Discord but no SMTP account still gets their link.
      const announced = await announcePublicUrlChange(fastify, { publicUrl })
      if (announced.email || announced.discord) {
        reply.send({
          data: {
            sent: true,
            via: [announced.email ? "email" : null, announced.discord ? "discord" : null].filter(
              Boolean,
            ),
          },
        })
        return
      }

      // Nothing went out. Re-run the email path only to recover a reason for
      // the error message; it already failed, so this cannot double-send.
      const result = await notifyPublicUrlChanged(fastify, { publicUrl })
      if (!result.sent) {
        reply.status(result.reason === "SEND_FAILED" ? 502 : 409).send({
          error: {
            code: result.reason ?? "EMAIL_FAILED",
            message:
              result.reason === "NOT_CONFIGURED"
                ? "Configure SMTP settings first."
                : result.reason === "NO_RECIPIENT"
                  ? "No notification address is set."
                  : result.reason === "DISABLED"
                    ? "Address-change emails are turned off."
                    : "Could not send the email.",
          },
        })
        return
      }

      reply.send({ data: { sent: true } })
    },
  )

  fastify.get(
    "/settings/security/log",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const cfg = getAiCfg(instance ?? { aiConfig: null })
      reply.send({ data: parseAiConfig(cfg) })
    }
  )

  fastify.patch(
    "/settings/ai",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const cfg = getAiCfg(instance ?? { aiConfig: null })
      const sec = (cfg.security as Record<string, unknown> | null) ?? {}
      reply.send({ data: parseAiSecurityConfig(sec) })
    }
  )

  fastify.patch(
    "/settings/ai-security",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
    { preHandler: requireSessionRole(["OWNER"]) },
    async (_request, reply) => {
      reply.send({ data: await getMobileAppInstallStatus() })
    },
  )

  const mobileInstallBodySchema = z.object({
    /** Optional host sudo password for apt. Never logged. */
    sudoPassword: z.string().max(256).optional(),
  })

  fastify.post(
    "/settings/mobile-app/install",
    { preHandler: requireSessionRole(["OWNER"]) },
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

      const parsed = mobileInstallBodySchema.safeParse(request.body ?? {})
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid install payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      try {
        reply.status(202).send({
          data: await startMobileAppInstall({
            sudoPassword: parsed.data.sudoPassword,
          }),
        })
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
