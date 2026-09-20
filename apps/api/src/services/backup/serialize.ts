import type {
  Device,
  DeviceBackupProfile,
  SyncEntry,
  SyncRoot,
} from "@prisma/client"
import type {
  BackupEntryPublic,
  BackupProfilePublic,
  BackupRootPublic,
  ComputerCardPublic,
  DeviceBackupSummary,
} from "@arciin/types"

export function serializeBackupEntry(entry: SyncEntry): BackupEntryPublic {
  return {
    id: entry.id,
    syncRootId: entry.syncRootId,
    clientEntryId: entry.clientEntryId,
    relativePath: entry.relativePath,
    entryType: entry.entryType,
    assetId: entry.assetId,
    folderId: entry.folderId,
    sizeBytes: entry.sizeBytes == null ? null : Number(entry.sizeBytes),
    contentHash: entry.contentHash,
    modifiedAtClient: entry.modifiedAtClient?.toISOString() ?? null,
    syncState: entry.syncState,
  }
}

export function isProtectedRootStatus(status: string): boolean {
  return status !== "DISABLED"
}

/** A root as the protection rules need to see it. */
type CountableRoot = { status: string; acknowledgedAt?: Date | string | null }

/**
 * Whether a root counts as actively protected.
 *
 * Two regimes, chosen by whether this computer has ever reported ownership:
 *
 * - **Legacy** (`ownershipObserved` false) — status alone, exactly as before.
 *   The Desktop installed in production predates ownership reporting, and
 *   demanding an acknowledgement it cannot yet send would strip protection
 *   from folders it is genuinely backing up.
 * - **Ownership-aware** — the computer must also have claimed the root. This
 *   is what stops a root the server invented, that no computer holds, from
 *   counting toward a protection promise.
 *
 * `fileCount` is deliberately absent from both. An empty protected folder is
 * normal, and inferring protection from contents is the bug this replaces.
 */
export function isProtectedRoot(root: CountableRoot, ownershipObserved: boolean): boolean {
  if (!isProtectedRootStatus(root.status)) return false
  if (!ownershipObserved) return true
  return Boolean(root.acknowledgedAt)
}

export function countProtectedRoots(
  roots: CountableRoot[],
  ownershipObserved = false,
): number {
  return roots.filter((root) => isProtectedRoot(root, ownershipObserved)).length
}

/**
 * Which roots a present ownership statement withdraws.
 *
 * Pure on purpose: the decision is the part worth testing, and keeping it out
 * of the Prisma shell keeps it out of reach of anything that could quietly turn
 * "we heard nothing" into "it owns nothing".
 *
 * Only a root the computer once acknowledged can be withdrawn. One it never
 * claimed was never owned, so there is nothing to take away — it simply keeps
 * failing the acknowledgement test in the count. Identifiers naming no known
 * root are ignored: a heartbeat may not conjure roots.
 */
export function rootsToWithdraw<T extends { id: string; sourcePathIdentifier: string; status: string; acknowledgedAt?: Date | string | null }>(
  activeRoots: T[],
  ownedRootSourceIdentifiers: string[],
): T[] {
  const owned = new Set(ownedRootSourceIdentifiers.map((id) => id.trim()).filter(Boolean))
  return activeRoots.filter(
    (root) =>
      isProtectedRootStatus(root.status) &&
      Boolean(root.acknowledgedAt) &&
      !owned.has(root.sourcePathIdentifier),
  )
}

/** Why a root was withdrawn. One value today; named so a log line is greppable. */
export const OWNERSHIP_WITHDRAWAL_REASON = "OWNERSHIP_HEARTBEAT_WITHDRAWAL"

type AuditRoot = {
  id: string
  displayName: string
  sourcePathIdentifier: string
  status: string
  acknowledgedAt?: Date | string | null
}

/**
 * What to record when a computer states which roots it owns.
 *
 * Withdrawal is the one thing the server does that silently ends protection,
 * and it left no trace at all: three real roots were withdrawn and afterwards
 * there was no way to tell what the heartbeat had actually said. Bounding the
 * question to "which identifiers arrived, and which roots did that remove" is
 * the difference between a provable incident and an unprovable one.
 *
 * Only opaque identifiers appear here. `sourcePathIdentifier` is a one-way hash
 * and carries no local path, and nothing about the credential the heartbeat
 * authenticated with is included.
 */
export function ownershipAuditRecord(input: {
  profileId: string
  deviceId: string
  receivedIdentifiers: string[]
  activeRoots: AuditRoot[]
  withdrawing: AuditRoot[]
}) {
  return {
    profileId: input.profileId,
    deviceId: input.deviceId,
    at: new Date().toISOString(),
    receivedCount: input.receivedIdentifiers.length,
    received: input.receivedIdentifiers,
    acknowledgedActive: input.activeRoots
      .filter((root) => Boolean(root.acknowledgedAt))
      .map((root) => root.sourcePathIdentifier),
    withdrawing: input.withdrawing.map((root) => ({
      rootId: root.id,
      displayName: root.displayName,
      sourcePathIdentifier: root.sourcePathIdentifier,
    })),
  }
}

/** What to record for each root actually withdrawn. */
export function withdrawalAuditRecord(input: {
  profileId: string
  deviceId: string
  root: AuditRoot
}) {
  return {
    reason: OWNERSHIP_WITHDRAWAL_REASON,
    profileId: input.profileId,
    deviceId: input.deviceId,
    rootId: input.root.id,
    displayName: input.root.displayName,
    sourcePathIdentifier: input.root.sourcePathIdentifier,
  }
}

export function presentedBackupHealth(input: {
  profileStatus: string
  health: ComputerCardPublic["health"]
  roots: CountableRoot[]
  ownershipObserved?: boolean
}): ComputerCardPublic["health"] {
  if (input.profileStatus === "DISABLED") return "DISABLED"
  if (
    countProtectedRoots(input.roots, input.ownershipObserved ?? false) === 0 &&
    input.health === "UP_TO_DATE"
  ) {
    return "OFFLINE"
  }
  return input.health
}

export function serializeBackupRoot(root: SyncRoot): BackupRootPublic {
  return {
    id: root.id,
    kind: root.kind,
    displayName: root.displayName,
    sourcePathIdentifier: root.sourcePathIdentifier,
    folderId: root.folderId,
    status: root.status,
    acknowledgedAt: root.acknowledgedAt?.toISOString() ?? null,
    fileCount: root.fileCount,
    folderCount: root.folderCount,
    byteCount: Number(root.byteCount),
    lastSyncAt: root.lastSyncAt?.toISOString() ?? null,
  }
}

export function serializeBackupProfile(
  profile: DeviceBackupProfile & { roots: SyncRoot[]; device: Device },
): BackupProfilePublic {
  return {
    id: profile.id,
    deviceId: profile.deviceId,
    userId: profile.userId,
    folderId: profile.folderId,
    status: profile.status,
    health: presentedBackupHealth({
      profileStatus: profile.status,
      health: profile.health,
      roots: profile.roots,
      ownershipObserved: Boolean(profile.rootOwnershipObservedAt),
    }),
    lastSyncAt: profile.lastSyncAt?.toISOString() ?? null,
    lastHeartbeatAt: profile.lastHeartbeatAt?.toISOString() ?? null,
    lastError: profile.lastError,
    fileCount: profile.fileCount,
    folderCount: profile.folderCount,
    byteCount: Number(profile.byteCount),
    roots: profile.roots.map(serializeBackupRoot),
    device: {
      id: profile.device.id,
      name: profile.device.name,
      platform: profile.device.platform,
    },
  }
}

export function serializeComputerCard(
  profile: DeviceBackupProfile & { roots: SyncRoot[]; device: Device },
): ComputerCardPublic {
  return {
    deviceId: profile.deviceId,
    profileId: profile.id,
    name: profile.device.name,
    platform: profile.device.platform,
    health: presentedBackupHealth({
      profileStatus: profile.status,
      health: profile.health,
      roots: profile.roots,
    }),
    lastSyncAt: profile.lastSyncAt?.toISOString() ?? null,
    lastHeartbeatAt: profile.lastHeartbeatAt?.toISOString() ?? null,
    fileCount: profile.fileCount,
    byteCount: Number(profile.byteCount),
    roots: profile.roots.map(serializeBackupRoot),
  }
}

export function serializeDeviceBackupSummary(
  profile: (DeviceBackupProfile & { roots: SyncRoot[] }) | null,
): DeviceBackupSummary | null {
  if (!profile || profile.status === "DISABLED") {
    return profile
      ? {
          profileId: profile.id,
          enabled: false,
          health: "DISABLED",
          rootCount: 0,
          fileCount: profile.fileCount,
          byteCount: Number(profile.byteCount),
          lastSyncAt: profile.lastSyncAt?.toISOString() ?? null,
        }
      : null
  }
  return {
    profileId: profile.id,
    enabled: true,
    health: presentedBackupHealth({
      profileStatus: profile.status,
      health: profile.health,
      roots: profile.roots,
      ownershipObserved: Boolean(profile.rootOwnershipObservedAt),
    }),
    rootCount: countProtectedRoots(profile.roots, Boolean(profile.rootOwnershipObservedAt)),
    fileCount: profile.fileCount,
    byteCount: Number(profile.byteCount),
    lastSyncAt: profile.lastSyncAt?.toISOString() ?? null,
  }
}
