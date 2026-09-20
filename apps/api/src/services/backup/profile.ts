import { randomBytes } from "node:crypto"

import {
  BACKUP_CREDENTIAL_BYTES,
  BACKUP_CREDENTIAL_PREFIX,
  BACKUP_DISPLAY_NAME_MAX,
  BACKUP_HEARTBEAT_THROTTLE_MS,
  BACKUP_SOURCE_PATH_ID_MAX,
  SYNC_ROOT_KINDS,
  type SyncRootKindInput,
} from "@arciin/config"
import type {
  DeviceBackupHealth,
  DeviceBackupProfile,
  Prisma,
  PrismaClient,
  SyncRootKind,
} from "@prisma/client"

import { hashToken } from "@/services/security/auth"
import { slugify } from "@/services/slug"
import {
  ownershipAuditRecord,
  rootsToWithdraw,
  withdrawalAuditRecord,
} from "./serialize"

import { BackupError } from "./errors"
import { ensureComputersLibrary, ensureDeviceFolder, folderSlugForSegment } from "./library"

const HEALTH_VALUES = new Set<DeviceBackupHealth>([
  "UP_TO_DATE",
  "SYNCING",
  "PAUSED",
  "OFFLINE",
  "ERROR",
])

export function generateBackupCredential(): string {
  return `${BACKUP_CREDENTIAL_PREFIX}${randomBytes(BACKUP_CREDENTIAL_BYTES).toString("base64url")}`
}

export function hashBackupCredential(credential: string): string {
  return hashToken(credential)
}

export async function revokeBackupGrantsForDevice(
  prisma: PrismaClient | Prisma.TransactionClient,
  deviceId: string,
) {
  await prisma.deviceBackupGrant.updateMany({
    where: { deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function revokeBackupGrantsForProfile(
  prisma: PrismaClient | Prisma.TransactionClient,
  profileId: string,
) {
  await prisma.deviceBackupGrant.updateMany({
    where: { profileId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

async function issueGrant(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: { profileId: string; deviceId: string; userId: string },
) {
  await revokeBackupGrantsForProfile(prisma, input.profileId)
  const credential = generateBackupCredential()
  await prisma.deviceBackupGrant.create({
    data: {
      profileId: input.profileId,
      deviceId: input.deviceId,
      userId: input.userId,
      credentialHash: hashBackupCredential(credential),
    },
  })
  return credential
}

export function parseSyncRootKind(value: string): SyncRootKind {
  const key = value.trim().toUpperCase()
  if (!(SYNC_ROOT_KINDS as readonly string[]).includes(key)) {
    throw new BackupError("VALIDATION_ERROR", "Unsupported sync root kind.", 400)
  }
  return key as SyncRootKind
}

export async function enableBackupProfile(
  prisma: PrismaClient,
  input: {
    userId: string
    deviceId: string
    rotateCredential?: boolean
    roots?: Array<{
      kind: string
      displayName?: string
      sourcePathIdentifier: string
    }>
  },
) {
  const device = await prisma.device.findUnique({ where: { id: input.deviceId } })
  if (!device || device.status !== "ACTIVE" || device.revokedAt) {
    throw new BackupError("BACKUP_DEVICE_UNPAIRED", "Pair this computer before enabling backup.", 403)
  }

  const library = await ensureComputersLibrary(prisma)
  const folder = await ensureDeviceFolder(prisma, {
    deviceId: device.id,
    deviceName: device.name,
    libraryId: library.id,
  })

  const existing = await prisma.deviceBackupProfile.findUnique({
    where: { deviceId_userId: { deviceId: device.id, userId: input.userId } },
  })
  const wasDisabled = existing?.status === "DISABLED"

  const profile = existing
    ? await prisma.deviceBackupProfile.update({
        where: { id: existing.id },
        data: {
          status: "ENABLED",
          health: existing.health === "DISABLED" ? "OFFLINE" : existing.health,
          folderId: folder.id,
          lastError: null,
        },
      })
    : await prisma.deviceBackupProfile.create({
        data: {
          deviceId: device.id,
          userId: input.userId,
          folderId: folder.id,
          status: "ENABLED",
          health: "OFFLINE",
        },
      })

  if (input.roots?.length) {
    for (const root of input.roots) {
      await upsertSyncRoot(prisma, {
        profileId: profile.id,
        userId: input.userId,
        deviceId: device.id,
        kind: parseSyncRootKind(root.kind),
        displayName: (root.displayName ?? root.kind).trim().slice(0, BACKUP_DISPLAY_NAME_MAX),
        sourcePathIdentifier: root.sourcePathIdentifier.trim().slice(0, BACKUP_SOURCE_PATH_ID_MAX),
        libraryId: library.id,
        deviceFolderId: folder.id,
      })
    }
  }

  const activeGrant = await prisma.deviceBackupGrant.findFirst({
    where: { profileId: profile.id, revokedAt: null },
  })

  let credential: string | null = null
  if (!activeGrant || input.rotateCredential || wasDisabled) {
    credential = await issueGrant(prisma, {
      profileId: profile.id,
      deviceId: device.id,
      userId: input.userId,
    })
  }

  return {
    profile: await loadBackupProfile(prisma, profile.id),
    credential,
    credentialIssued: Boolean(credential),
  }
}

export async function disableBackupProfile(prisma: PrismaClient, profileId: string) {
  const profile = await prisma.deviceBackupProfile.findUnique({ where: { id: profileId } })
  if (!profile) {
    throw new BackupError("BACKUP_NOT_FOUND", "Backup profile not found.", 404)
  }
  await revokeBackupGrantsForProfile(prisma, profileId)
  await prisma.syncRoot.updateMany({
    where: { profileId, status: { not: "DISABLED" } },
    data: { status: "DISABLED" },
  })
  return prisma.deviceBackupProfile.update({
    where: { id: profileId },
    data: { status: "DISABLED", health: "DISABLED" },
  })
}

export async function reenableBackupProfile(
  prisma: PrismaClient,
  input: {
    profileId: string
    roots?: Array<{
      kind: string
      displayName?: string
      sourcePathIdentifier: string
    }>
  },
) {
  const profile = await prisma.deviceBackupProfile.findUnique({ where: { id: input.profileId } })
  if (!profile) {
    throw new BackupError("BACKUP_NOT_FOUND", "Backup profile not found.", 404)
  }
  return enableBackupProfile(prisma, {
    userId: profile.userId,
    deviceId: profile.deviceId,
    rotateCredential: true,
    roots: input.roots,
  })
}

export async function disableSyncRoot(prisma: PrismaClient, rootId: string) {
  const root = await prisma.syncRoot.findUnique({ where: { id: rootId } })
  if (!root) {
    throw new BackupError("BACKUP_ROOT_NOT_FOUND", "Protected folder not found.", 404)
  }
  if (root.status === "DISABLED") return root
  return prisma.syncRoot.update({
    where: { id: rootId },
    data: { status: "DISABLED" },
  })
}

export async function enableSyncRoot(prisma: PrismaClient, rootId: string) {
  const root = await prisma.syncRoot.findUnique({
    where: { id: rootId },
    include: { profile: true },
  })
  if (!root) {
    throw new BackupError("BACKUP_ROOT_NOT_FOUND", "Protected folder not found.", 404)
  }
  if (root.profile.status === "DISABLED") {
    throw new BackupError("BACKUP_DISABLED", "Enable computer backup before protecting this folder.", 403)
  }
  if (root.status !== "DISABLED") return root
  return prisma.syncRoot.update({
    where: { id: rootId },
    data: { status: "PROTECTED" },
  })
}

export async function loadSyncRoot(prisma: PrismaClient, rootId: string) {
  const root = await prisma.syncRoot.findUnique({
    where: { id: rootId },
    include: { profile: true },
  })
  if (!root) {
    throw new BackupError("BACKUP_ROOT_NOT_FOUND", "Protected folder not found.", 404)
  }
  return root
}

export async function rotateBackupCredential(prisma: PrismaClient, profileId: string) {
  const profile = await prisma.deviceBackupProfile.findUnique({ where: { id: profileId } })
  if (!profile) {
    throw new BackupError("BACKUP_NOT_FOUND", "Backup profile not found.", 404)
  }
  if (profile.status === "DISABLED") {
    throw new BackupError("BACKUP_DISABLED", "Enable computer backup before rotating the credential.", 403)
  }
  const credential = await issueGrant(prisma, {
    profileId: profile.id,
    deviceId: profile.deviceId,
    userId: profile.userId,
  })
  return {
    profile: await loadBackupProfile(prisma, profile.id),
    credential,
    credentialIssued: true,
  }
}

export async function loadBackupProfile(prisma: PrismaClient, profileId: string) {
  const profile = await prisma.deviceBackupProfile.findUnique({
    where: { id: profileId },
    include: { roots: { orderBy: { createdAt: "asc" } }, device: true },
  })
  if (!profile) {
    throw new BackupError("BACKUP_NOT_FOUND", "Backup profile not found.", 404)
  }
  return profile
}

export async function listBackupProfilesForViewer(
  prisma: PrismaClient,
  viewer: { id: string; role: string },
) {
  return prisma.deviceBackupProfile.findMany({
    where: {
      status: "ENABLED",
      device: { status: "ACTIVE", revokedAt: null },
      ...(viewer.role === "OWNER" || viewer.role === "ADMIN" ? {} : { userId: viewer.id }),
    },
    include: { roots: { orderBy: { createdAt: "asc" } }, device: true },
    orderBy: [{ lastSyncAt: "desc" }, { updatedAt: "desc" }],
  })
}

/** Minimal logger shape so callers can pass `request.log` without coupling. */
type BackupAuditLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void
}

/**
 * Apply an authoritative ownership statement from the computer.
 *
 * Only a *present* list says anything. A computer that is offline, mid-error,
 * paused, or simply older than this field sends nothing, and silence must never
 * be read as "owns nothing" — that would end protection for every root the
 * moment a laptop was closed.
 *
 * Withdrawal runs through `disableSyncRoot`, so the root, its entries and every
 * stored file survive. Removing a folder from backup stops future protection;
 * it does not delete the backup already taken.
 */
export async function applyRootOwnership(
  prisma: PrismaClient,
  profile: DeviceBackupProfile,
  ownedRootSourceIdentifiers: string[],
  log?: BackupAuditLogger,
) {
  const activeRoots = await prisma.syncRoot.findMany({
    where: { profileId: profile.id, status: { not: "DISABLED" } },
  })

  const withdrawing = rootsToWithdraw(activeRoots, ownedRootSourceIdentifiers)

  // Recorded before the writes, so the statement survives even if a write
  // fails partway.
  log?.info(
    ownershipAuditRecord({
      profileId: profile.id,
      deviceId: profile.deviceId,
      receivedIdentifiers: ownedRootSourceIdentifiers,
      activeRoots,
      withdrawing,
    }),
    "backup ownership statement received",
  )

  for (const root of withdrawing) {
    await disableSyncRoot(prisma, root.id)
    log?.info(
      withdrawalAuditRecord({ profileId: profile.id, deviceId: profile.deviceId, root }),
      "backup root withdrawn by ownership heartbeat",
    )
  }

  return prisma.deviceBackupProfile.update({
    where: { id: profile.id },
    data: { rootOwnershipObservedAt: profile.rootOwnershipObservedAt ?? new Date() },
  })
}

export async function heartbeatBackupProfile(
  prisma: PrismaClient,
  profile: DeviceBackupProfile,
  input: {
    health?: string
    lastError?: string | null
    ownedRootSourceIdentifiers?: string[]
  },
  log?: BackupAuditLogger,
) {
  // Ownership is applied before anything else, and before the heartbeat
  // throttle below can return early: a throttled heartbeat still carries an
  // authoritative statement, and dropping it would leave a withdrawn root
  // protected until the client happened to change health.
  let current = profile
  if (input.ownedRootSourceIdentifiers !== undefined) {
    current = await applyRootOwnership(prisma, profile, input.ownedRootSourceIdentifiers, log)
  }
  profile = current

  const requested = input.health ? input.health.trim().toUpperCase() : profile.health
  if (requested && !HEALTH_VALUES.has(requested as DeviceBackupHealth)) {
    throw new BackupError("VALIDATION_ERROR", "Unsupported backup health.", 400)
  }

  let health = (requested || profile.health) as DeviceBackupHealth
  if (health === "UP_TO_DATE") {
    const protectedCount = await prisma.syncRoot.count({
      where: { profileId: profile.id, status: { not: "DISABLED" } },
    })
    if (protectedCount === 0) health = "OFFLINE"
  }

  const now = Date.now()
  if (
    profile.lastHeartbeatAt &&
    now - profile.lastHeartbeatAt.getTime() < BACKUP_HEARTBEAT_THROTTLE_MS &&
    profile.health === health &&
    (input.lastError ?? null) === profile.lastError
  ) {
    return profile
  }

  return prisma.deviceBackupProfile.update({
    where: { id: profile.id },
    data: {
      health: health as DeviceBackupHealth,
      lastHeartbeatAt: new Date(),
      lastError: input.lastError === undefined ? profile.lastError : input.lastError,
    },
  })
}

export async function upsertSyncRoot(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    profileId: string
    userId: string
    deviceId: string
    kind: SyncRootKind | SyncRootKindInput
    displayName: string
    sourcePathIdentifier: string
    libraryId: string
    deviceFolderId: string
    /**
     * Set only when the computer itself is registering the root with its sync
     * grant. Backup setup runs through here too, over a user session, and that
     * is precisely the call that must NOT count as the computer claiming
     * anything — it is how an unowned root got created in the first place.
     */
    acknowledge?: boolean
  },
) {
  const identifier = input.sourcePathIdentifier.trim()
  if (!identifier) {
    throw new BackupError("VALIDATION_ERROR", "sourcePathIdentifier is required.", 400)
  }
  if (identifier.length > BACKUP_SOURCE_PATH_ID_MAX) {
    throw new BackupError("PATH_TOO_LONG", "sourcePathIdentifier is too long.", 400)
  }
  if (identifier.includes("/") || identifier.includes("\\") || identifier.includes("..")) {
    throw new BackupError("PATH_INVALID", "sourcePathIdentifier must be an opaque id, not a path.", 400)
  }

  const displayName = input.displayName.trim().slice(0, BACKUP_DISPLAY_NAME_MAX) || String(input.kind)
  const existing = await prisma.syncRoot.findUnique({
    where: {
      profileId_sourcePathIdentifier: {
        profileId: input.profileId,
        sourcePathIdentifier: identifier,
      },
    },
  })

  if (existing) {
    return prisma.syncRoot.update({
      where: { id: existing.id },
      data: {
        kind: input.kind as SyncRootKind,
        displayName,
        status: "PROTECTED",
        // Re-acknowledging is idempotent: the stamp is only ever set, never
        // moved and never cleared, so a client that retries does not rewrite
        // when the root was first claimed.
        ...(input.acknowledge && !existing.acknowledgedAt
          ? { acknowledgedAt: new Date() }
          : {}),
      },
    })
  }

  const slug = folderSlugForSegment(displayName, `root-${identifier.slice(0, 8)}`)
  const pathCache = `device-${input.deviceId}/${slug}`
  const folder =
    (await prisma.folder.findFirst({
      where: { libraryId: input.libraryId, pathCache, deletedAt: null },
    })) ??
    (await prisma.folder.create({
      data: {
        libraryId: input.libraryId,
        parentFolderId: input.deviceFolderId,
        name: displayName,
        slug: slugify(slug) || slug,
        pathCache,
      },
    }))

  return prisma.syncRoot.create({
    data: {
      profileId: input.profileId,
      deviceId: input.deviceId,
      userId: input.userId,
      kind: input.kind as SyncRootKind,
      displayName,
      sourcePathIdentifier: identifier,
      acknowledgedAt: input.acknowledge ? new Date() : null,
      folderId: folder.id,
    },
  })
}

export async function refreshBackupCounters(prisma: PrismaClient, profileId: string) {
  const roots = await prisma.syncRoot.findMany({
    where: { profileId },
    select: { id: true },
  })

  let profileFiles = 0
  let profileFolders = 0
  let profileBytes = 0n

  for (const root of roots) {
    const [files, folders, bytes] = await Promise.all([
      prisma.syncEntry.count({
        where: { syncRootId: root.id, entryType: "FILE", syncState: "ACTIVE" },
      }),
      prisma.syncEntry.count({
        where: { syncRootId: root.id, entryType: "FOLDER", syncState: "ACTIVE" },
      }),
      prisma.syncEntry.aggregate({
        where: { syncRootId: root.id, entryType: "FILE", syncState: "ACTIVE" },
        _sum: { sizeBytes: true },
      }),
    ])
    const byteCount = bytes._sum.sizeBytes ?? 0n
    await prisma.syncRoot.update({
      where: { id: root.id },
      data: { fileCount: files, folderCount: folders, byteCount },
    })
    profileFiles += files
    profileFolders += folders
    profileBytes += byteCount
  }

  await prisma.deviceBackupProfile.update({
    where: { id: profileId },
    data: {
      fileCount: profileFiles,
      folderCount: profileFolders,
      byteCount: profileBytes,
      lastSyncAt: new Date(),
    },
  })
}
