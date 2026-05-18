import { access, statfs } from "node:fs/promises"
import path from "node:path"

import {
  AI_EMOJI_USAGE_LEVELS,
  AI_LIBRARY_TOOL_ACCESS_LEVELS,
  normalizeIpRule,
  parseAccessControlConfig,
  parseAiConfig,
  parseAiSecurityConfig,
  parseApiProtectionConfig,
} from "@arciin/shared"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { apiConfig } from "@/config"
import { invalidateAccessControlCache } from "@/services/security/access-control-settings"
import { invalidateApiProtectionCache } from "@/services/security/instance-security"
import { hashToken, requireRole } from "@/services/security/auth"
import { clientIpFromRequest, normalizeClientIp } from "@/services/security/client-ip"
import { logIpPolicyChanges } from "@/services/security/log-ip-policy-changes"
import { isSecurityLogType, recordSecurityEvent } from "@/services/security/security-events"
import { serializeActivity } from "@/services/serializers"
import { ClearInstanceContentError, clearInstanceContent } from "@/services/settings/clear-instance-content"
import {
  getCloudflareTunnelState,
  startCloudflareQuickTunnel,
  stopCloudflareQuickTunnel,
} from "@/services/remote-access/cloudflare-tunnel"
import { resolveStorageUsageBytes } from "@/services/storage/local-storage"

const generalSchema = z.object({
  instanceName: z.string().min(1).max(80),
})

const storageSchema = z.object({
  storageRoot: z.string().min(1),
})

const remoteAccessSchema = z.object({
  publicUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  mode: z.enum(["local", "reverse-proxy", "cloudflare-tunnel"]).optional(),
  reverseProxyEnabled: z.boolean().optional(),
  cloudflareTunnelEnabled: z.boolean().optional(),
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

      const storageRoot = instance?.storageRoot || defaultStorage?.rootPath || "./data/arciin"
      const storageAgg = await fastify.prisma.storageObject.aggregate({
        _sum: { sizeBytes: true },
      })
      const trackedBytes = Number(storageAgg._sum.sizeBytes ?? 0)
      const usageBytes = await resolveStorageUsageBytes(storageRoot, trackedBytes)
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

      const storageRoot = path.resolve(parsed.data.storageRoot)
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
          usageBytes: await resolveStorageUsageBytes(
            storageRoot,
            Number(
              (
                await fastify.prisma.storageObject.aggregate({
                  _sum: { sizeBytes: true },
                })
              )._sum.sizeBytes ?? 0,
            ),
          ),
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

      const prevConfig = (instance.remoteAccessConfig as Record<string, unknown> | null) || {}
      const nextConfig = {
        reverseProxyEnabled:
          parsed.data.reverseProxyEnabled !== undefined
            ? parsed.data.reverseProxyEnabled
            : Boolean(prevConfig.reverseProxyEnabled),
        cloudflareTunnelEnabled:
          parsed.data.cloudflareTunnelEnabled !== undefined
            ? parsed.data.cloudflareTunnelEnabled
            : Boolean(prevConfig.cloudflareTunnelEnabled),
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

  fastify.get(
    "/settings/cloudflare-tunnel",
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const tunnel = getCloudflareTunnelState()
      const instance = await fastify.prisma.instanceConfig.findFirst()
      reply.send({
        data: {
          ...tunnel,
          cloudflareTunnelEnabled: Boolean(
            (instance?.remoteAccessConfig as Record<string, unknown> | null)?.cloudflareTunnelEnabled,
          ),
          publicUrl: instance?.publicUrl ?? null,
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

      const localTarget = process.env.ARCIIN_PUBLIC_URL || "http://localhost:3000"

      try {
        const url = await startCloudflareQuickTunnel(localTarget)
        const prevConfig = (instance.remoteAccessConfig as Record<string, unknown> | null) || {}
        await fastify.prisma.instanceConfig.update({
          where: { id: instance.id },
          data: {
            publicUrl: url,
            remoteAccessMode: "cloudflare-tunnel",
            remoteAccessConfig: {
              ...prevConfig,
              cloudflareTunnelEnabled: true,
              reverseProxyEnabled: false,
            },
          },
        })

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
      reply.send({ data: events.map(serializeActivity) })
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
}
