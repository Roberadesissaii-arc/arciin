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

export function serializeBackupRoot(root: SyncRoot): BackupRootPublic {
  return {
    id: root.id,
    kind: root.kind,
    displayName: root.displayName,
    sourcePathIdentifier: root.sourcePathIdentifier,
    folderId: root.folderId,
    status: root.status,
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
    health: profile.health,
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
    health: profile.health,
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
    health: profile.health,
    rootCount: profile.roots.length,
    fileCount: profile.fileCount,
    byteCount: Number(profile.byteCount),
    lastSyncAt: profile.lastSyncAt?.toISOString() ?? null,
  }
}
