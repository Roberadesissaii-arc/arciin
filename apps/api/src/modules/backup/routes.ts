import {
  BACKUP_CLIENT_ENTRY_ID_MAX,
  BACKUP_DISPLAY_NAME_MAX,
  BACKUP_ENABLE_RATE_LIMIT,
  BACKUP_HEARTBEAT_RATE_LIMIT,
  BACKUP_OPERATION_ID_MAX,
  BACKUP_SOURCE_PATH_ID_MAX,
  BACKUP_SYNC_RATE_LIMIT,
  BACKUP_UPLOAD_RATE_LIMIT,
} from "@arciin/config"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { recordSecurityEvent } from "@/services/security/security-events"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import { requireSessionRole } from "@/services/security/auth"
import { serializeAsset, serializeFolder } from "@/services/serializers"
import { attachAssetSourceContext } from "@/services/backup/source-context"
import { assertBackupOwner, requireBackupGrant } from "@/services/backup/auth"
import { BackupError } from "@/services/backup/errors"
import { ingestBackupFile } from "@/services/backup/ingest"
import {
  disableBackupProfile,
  enableBackupProfile,
  heartbeatBackupProfile,
  listBackupProfilesForViewer,
  loadBackupProfile,
  parseSyncRootKind,
  rotateBackupCredential,
  upsertSyncRoot,
} from "@/services/backup/profile"
import { ensureComputersLibrary } from "@/services/backup/library"
import {
  serializeBackupEntry,
  serializeBackupProfile,
  serializeBackupRoot,
  serializeComputerCard,
} from "@/services/backup/serialize"
import {
  findEntry,
  getOwnedRoot,
  moveSyncEntry,
  tombstoneSyncEntry,
  upsertFolderEntry,
} from "@/services/backup/sync"
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  hashRequestFingerprint,
} from "@/services/uploads/idempotency-store"

const enableSchema = z.object({
  deviceId: z.string().min(1),
  rotateCredential: z.boolean().optional(),
  roots: z
    .array(
      z.object({
        kind: z.string().min(1),
        displayName: z.string().max(BACKUP_DISPLAY_NAME_MAX).optional(),
        sourcePathIdentifier: z.string().min(1).max(BACKUP_SOURCE_PATH_ID_MAX),
      }),
    )
    .max(32)
    .optional(),
})

const rootSchema = z.object({
  kind: z.string().min(1),
  displayName: z.string().max(BACKUP_DISPLAY_NAME_MAX).optional(),
  sourcePathIdentifier: z.string().min(1).max(BACKUP_SOURCE_PATH_ID_MAX),
})

const heartbeatSchema = z.object({
  health: z.enum(["UP_TO_DATE", "SYNCING", "PAUSED", "OFFLINE", "ERROR"]).optional(),
  lastError: z.string().max(500).nullable().optional(),
})

const folderEntrySchema = z.object({
  syncRootId: z.string().min(1),
  clientEntryId: z.string().min(1).max(BACKUP_CLIENT_ENTRY_ID_MAX),
  relativePath: z.string().min(1),
  operationId: z.string().min(1).max(BACKUP_OPERATION_ID_MAX).optional(),
  modifiedAtClient: z.string().datetime().optional(),
})

const moveSchema = z.object({
  syncRootId: z.string().min(1),
  relativePath: z.string().min(1),
  operationId: z.string().min(1).max(BACKUP_OPERATION_ID_MAX).optional(),
})

const tombstoneSchema = z.object({
  syncRootId: z.string().min(1),
  operationId: z.string().min(1).max(BACKUP_OPERATION_ID_MAX).optional(),
})

function sendBackupError(reply: FastifyReply, error: unknown) {
  if (error instanceof BackupError) {
    reply.status(error.status).send({ error: { code: error.code, message: error.message } })
    return true
  }
  return false
}

async function withIdempotency(
  prisma: FastifyInstance["prisma"],
  input: { scope: string; key: string | undefined; fingerprint: string },
  reply: FastifyReply,
  run: () => Promise<{ status: number; body: unknown }>,
) {
  if (!input.key) {
    const result = await run()
    reply.status(result.status).send(result.body)
    return
  }

  const decision = await beginIdempotentRequest(prisma, {
    scope: input.scope,
    key: input.key,
    requestHash: hashRequestFingerprint(input.fingerprint),
  })
  if (decision.action === "replay") {
    reply.status(decision.responseCode).send(decision.responseBody)
    return
  }
  if (decision.action === "conflict") {
    reply.status(409).send({
      error: { code: "BACKUP_IDEMPOTENCY_CONFLICT", message: decision.message },
    })
    return
  }
  if (decision.action === "in_flight") {
    reply.status(409).send({
      error: { code: "BACKUP_IDEMPOTENCY_CONFLICT", message: decision.message },
    })
    return
  }

  try {
    const result = await run()
    await completeIdempotentRequest(prisma, {
      scope: input.scope,
      key: input.key,
      responseCode: result.status,
      responseBody: result.body,
    })
    reply.status(result.status).send(result.body)
  } catch (error) {
    await failIdempotentRequest(prisma, { scope: input.scope, key: input.key })
    throw error
  }
}

const manageBackup = {
  preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER"]),
}

const readBackup = {
  preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
}

export async function registerBackupRoutes(fastify: FastifyInstance) {
  fastify.post("/backup/profiles", manageBackup, async (request, reply) => {
    if (!request.auth) return
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `backup-enable:${request.auth.user.id}`,
        ...BACKUP_ENABLE_RATE_LIMIT,
        perIp: false,
      })
    ) {
      return
    }
    const parsed = enableSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid backup payload.", details: parsed.error.flatten() },
      })
      return
    }
    try {
      const result = await enableBackupProfile(fastify.prisma, {
        userId: request.auth.user.id,
        deviceId: parsed.data.deviceId,
        rotateCredential: parsed.data.rotateCredential,
        roots: parsed.data.roots,
      })
      await recordSecurityEvent(fastify, {
        userId: request.auth.user.id,
        type: "security.backup_enabled",
        title: "Computer backup enabled",
        message: `Backup authorized for ${result.profile.device.name}.`,
        metadata: { deviceId: result.profile.deviceId, profileId: result.profile.id },
      })
      reply.status(result.credentialIssued ? 201 : 200).send({
        data: {
          profile: serializeBackupProfile(result.profile),
          credential: result.credential,
          credentialIssued: result.credentialIssued,
        },
      })
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })

  fastify.get("/backup/profiles", readBackup, async (request, reply) => {
    if (!request.auth) return
    const profiles = await listBackupProfilesForViewer(fastify.prisma, request.auth.user)
    reply.send({ data: profiles.map(serializeBackupProfile) })
  })

  fastify.get("/backup/profiles/:profileId", readBackup, async (request, reply) => {
    if (!request.auth) return
    const params = z.object({ profileId: z.string() }).parse(request.params)
    try {
      const profile = await loadBackupProfile(fastify.prisma, params.profileId)
      assertBackupOwner(request.auth.user, profile.userId)
      reply.send({ data: serializeBackupProfile(profile) })
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })

  fastify.post("/backup/profiles/:profileId/disable", manageBackup, async (request, reply) => {
    if (!request.auth) return
    const params = z.object({ profileId: z.string() }).parse(request.params)
    try {
      const profile = await loadBackupProfile(fastify.prisma, params.profileId)
      assertBackupOwner(request.auth.user, profile.userId)
      await disableBackupProfile(fastify.prisma, profile.id)
      await recordSecurityEvent(fastify, {
        userId: request.auth.user.id,
        type: "security.backup_disabled",
        title: "Computer backup disabled",
        message: `Backup disabled for ${profile.device.name}.`,
        metadata: { deviceId: profile.deviceId, profileId: profile.id },
      })
      reply.send({ data: { id: profile.id, status: "DISABLED" } })
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })

  fastify.post("/backup/profiles/:profileId/rotate", manageBackup, async (request, reply) => {
    if (!request.auth) return
    const params = z.object({ profileId: z.string() }).parse(request.params)
    try {
      const profile = await loadBackupProfile(fastify.prisma, params.profileId)
      assertBackupOwner(request.auth.user, profile.userId)
      const result = await rotateBackupCredential(fastify.prisma, profile.id)
      await recordSecurityEvent(fastify, {
        userId: request.auth.user.id,
        type: "security.backup_grant_issued",
        title: "Backup credential rotated",
        message: `A new backup credential was issued for ${profile.device.name}.`,
        metadata: { deviceId: profile.deviceId, profileId: profile.id },
      })
      reply.send({
        data: {
          profile: serializeBackupProfile(result.profile),
          credential: result.credential,
          credentialIssued: true,
        },
      })
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })

  fastify.get("/computers", readBackup, async (request, reply) => {
    if (!request.auth) return
    const profiles = await listBackupProfilesForViewer(fastify.prisma, request.auth.user)
    reply.send({ data: profiles.map(serializeComputerCard) })
  })

  fastify.get("/computers/:deviceId", readBackup, async (request, reply) => {
    if (!request.auth) return
    const params = z.object({ deviceId: z.string() }).parse(request.params)
    const profiles = await listBackupProfilesForViewer(fastify.prisma, request.auth.user)
    const profile = profiles.find((item) => item.deviceId === params.deviceId)
    if (!profile) {
      reply.status(404).send({ error: { code: "BACKUP_NOT_FOUND", message: "Computer not found." } })
      return
    }
    reply.send({ data: serializeComputerCard(profile) })
  })

  fastify.get("/computers/:deviceId/browse", readBackup, async (request, reply) => {
    if (!request.auth) return
    const params = z.object({ deviceId: z.string() }).parse(request.params)
    const query = z.object({ folderId: z.string().optional() }).parse(request.query)
    const profiles = await listBackupProfilesForViewer(fastify.prisma, request.auth.user)
    const profile = profiles.find((item) => item.deviceId === params.deviceId)
    if (!profile) {
      reply.status(404).send({ error: { code: "BACKUP_NOT_FOUND", message: "Computer not found." } })
      return
    }
    const folderId = query.folderId ?? profile.folderId
    const folder = await fastify.prisma.folder.findFirst({
      where: { id: folderId, deletedAt: null },
    })
    if (!folder) {
      reply.status(404).send({ error: { code: "BACKUP_NOT_FOUND", message: "Folder not found." } })
      return
    }
    const allowedRoots = new Set([profile.folderId, ...profile.roots.map((root) => root.folderId)])
    const inTree =
      folder.id === profile.folderId ||
      folder.pathCache.startsWith(`device-${profile.deviceId}/`) ||
      allowedRoots.has(folder.id)
    if (!inTree) {
      reply.status(403).send({ error: { code: "BACKUP_FORBIDDEN", message: "Folder is outside this computer." } })
      return
    }

    const [folders, assets] = await Promise.all([
      fastify.prisma.folder.findMany({
        where: { parentFolderId: folder.id, deletedAt: null },
        orderBy: { name: "asc" },
        include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
      }),
      fastify.prisma.asset.findMany({
        where: { folderId: folder.id, deletedAt: null, archivedAt: null },
        orderBy: { originalFilename: "asc" },
        take: 500,
      }),
    ])

    reply.send({
      data: {
        computer: serializeComputerCard(profile),
        folder: serializeFolder(folder, assets.length),
        folders: folders.map((item) => serializeFolder(item, item._count.assets)),
        assets: await attachAssetSourceContext(fastify.prisma, assets.map(serializeAsset)),
        readOnly: true,
      },
    })
  })

  const syncAuth = { preHandler: requireBackupGrant() }

  fastify.get("/backup/me", syncAuth, async (request, reply) => {
    const ctx = request.backupGrant!
    const profile = await loadBackupProfile(fastify.prisma, ctx.profile.id)
    reply.send({ data: serializeBackupProfile(profile) })
  })

  fastify.post("/backup/heartbeat", syncAuth, async (request, reply) => {
    const ctx = request.backupGrant!
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `backup-heartbeat:${ctx.grant.id}`,
        ...BACKUP_HEARTBEAT_RATE_LIMIT,
        perIp: false,
      })
    ) {
      return
    }
    const parsed = heartbeatSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid heartbeat.", details: parsed.error.flatten() },
      })
      return
    }
    try {
      const profile = await heartbeatBackupProfile(fastify.prisma, ctx.profile, parsed.data)
      reply.send({
        data: {
          health: profile.health,
          lastHeartbeatAt: profile.lastHeartbeatAt?.toISOString() ?? null,
        },
      })
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })

  fastify.post("/backup/roots", syncAuth, async (request, reply) => {
    const ctx = request.backupGrant!
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `backup-sync:${ctx.grant.id}`,
        ...BACKUP_SYNC_RATE_LIMIT,
        perIp: false,
      })
    ) {
      return
    }
    const parsed = rootSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid sync root.", details: parsed.error.flatten() },
      })
      return
    }
    try {
      const library = await ensureComputersLibrary(fastify.prisma)
      const profile = await loadBackupProfile(fastify.prisma, ctx.profile.id)
      const root = await upsertSyncRoot(fastify.prisma, {
        profileId: profile.id,
        userId: ctx.user.id,
        deviceId: ctx.device.id,
        kind: parseSyncRootKind(parsed.data.kind),
        displayName: parsed.data.displayName ?? parsed.data.kind,
        sourcePathIdentifier: parsed.data.sourcePathIdentifier,
        libraryId: library.id,
        deviceFolderId: profile.folderId,
      })
      reply.status(201).send({ data: serializeBackupRoot(root) })
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })

  fastify.post("/backup/folders", syncAuth, async (request, reply) => {
    const ctx = request.backupGrant!
    const parsed = folderEntrySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid folder entry.", details: parsed.error.flatten() },
      })
      return
    }
    try {
      const root = await getOwnedRoot(fastify.prisma, {
        rootId: parsed.data.syncRootId,
        profileId: ctx.profile.id,
      })
      await withIdempotency(
        fastify.prisma,
        {
          scope: `backup:${ctx.grant.id}`,
          key: parsed.data.operationId,
          fingerprint: `folder:${parsed.data.clientEntryId}:${parsed.data.relativePath}`,
        },
        reply,
        async () => {
          const entry = await upsertFolderEntry(fastify.prisma, {
            root,
            clientEntryId: parsed.data.clientEntryId,
            relativePath: parsed.data.relativePath,
            modifiedAtClient: parsed.data.modifiedAtClient
              ? new Date(parsed.data.modifiedAtClient)
              : null,
          })
          return { status: 200, body: { data: serializeBackupEntry(entry) } }
        },
      )
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })

  fastify.post("/backup/files", syncAuth, async (request, reply) => {
    const ctx = request.backupGrant!
    if (
      await checkEndpointRateLimit(request, reply, {
        key: `backup-upload:${ctx.grant.id}`,
        ...BACKUP_UPLOAD_RATE_LIMIT,
        perIp: false,
      })
    ) {
      return
    }
    const file = await request.file()
    if (!file) {
      reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "A file is required." } })
      return
    }
    const fields = file.fields as Record<string, { value?: string } | undefined>
    const syncRootId = String(fields.syncRootId?.value ?? "")
    const clientEntryId = String(fields.clientEntryId?.value ?? "")
    const relativePath = String(fields.relativePath?.value ?? "")
    const operationId = fields.operationId?.value ? String(fields.operationId.value) : undefined
    if (!syncRootId || !clientEntryId || !relativePath) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "syncRootId, clientEntryId, and relativePath are required." },
      })
      return
    }
    try {
      const root = await getOwnedRoot(fastify.prisma, {
        rootId: syncRootId,
        profileId: ctx.profile.id,
      })
      await withIdempotency(
        fastify.prisma,
        {
          scope: `backup:${ctx.grant.id}`,
          key: operationId,
          fingerprint: `file:${clientEntryId}:${relativePath}:${file.filename}`,
        },
        reply,
        async () => {
          const entry = await ingestBackupFile(fastify.prisma, {
            root,
            userId: ctx.user.id,
            clientEntryId,
            relativePath,
            file,
            log: request.log,
          })
          return { status: 200, body: { data: serializeBackupEntry(entry) } }
        },
      )
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })

  fastify.post("/backup/entries/:clientEntryId/move", syncAuth, async (request, reply) => {
    const ctx = request.backupGrant!
    const params = z.object({ clientEntryId: z.string() }).parse(request.params)
    const parsed = moveSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid move payload.", details: parsed.error.flatten() },
      })
      return
    }
    try {
      const root = await getOwnedRoot(fastify.prisma, {
        rootId: parsed.data.syncRootId,
        profileId: ctx.profile.id,
      })
      await withIdempotency(
        fastify.prisma,
        {
          scope: `backup:${ctx.grant.id}`,
          key: parsed.data.operationId,
          fingerprint: `move:${params.clientEntryId}:${parsed.data.relativePath}`,
        },
        reply,
        async () => {
          const entry = await moveSyncEntry(fastify.prisma, {
            root,
            clientEntryId: params.clientEntryId,
            relativePath: parsed.data.relativePath,
          })
          return { status: 200, body: { data: serializeBackupEntry(entry) } }
        },
      )
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })

  fastify.post("/backup/entries/:clientEntryId/tombstone", syncAuth, async (request, reply) => {
    const ctx = request.backupGrant!
    const params = z.object({ clientEntryId: z.string() }).parse(request.params)
    const parsed = tombstoneSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Invalid tombstone payload.", details: parsed.error.flatten() },
      })
      return
    }
    try {
      const root = await getOwnedRoot(fastify.prisma, {
        rootId: parsed.data.syncRootId,
        profileId: ctx.profile.id,
      })
      await findEntry(fastify.prisma, { rootId: root.id, clientEntryId: params.clientEntryId })
      await withIdempotency(
        fastify.prisma,
        {
          scope: `backup:${ctx.grant.id}`,
          key: parsed.data.operationId,
          fingerprint: `tombstone:${params.clientEntryId}`,
        },
        reply,
        async () => {
          const entry = await tombstoneSyncEntry(fastify.prisma, {
            root,
            clientEntryId: params.clientEntryId,
            ownerId: ctx.user.id,
          })
          return { status: 200, body: { data: serializeBackupEntry(entry) } }
        },
      )
    } catch (error) {
      if (!sendBackupError(reply, error)) throw error
    }
  })
}
