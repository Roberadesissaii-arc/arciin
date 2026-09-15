import type { DevicePlatform } from "./devices"

export type DeviceBackupStatus = "ENABLED" | "DISABLED"
export type DeviceBackupHealth = "UP_TO_DATE" | "SYNCING" | "PAUSED" | "OFFLINE" | "ERROR" | "DISABLED"
export type SyncRootKind = "DESKTOP" | "DOCUMENTS" | "PICTURES" | "VIDEOS" | "MUSIC" | "DOWNLOADS" | "CUSTOM"
export type SyncRootStatus = "PROTECTED" | "SYNCING" | "PAUSED" | "ERROR" | "DISABLED"
export type SyncEntryType = "FILE" | "FOLDER"
export type SyncEntryState = "ACTIVE" | "TOMBSTONED"

export type DeviceBackupSummary = {
  profileId: string
  enabled: boolean
  health: DeviceBackupHealth
  rootCount: number
  fileCount: number
  byteCount: number
  lastSyncAt: string | null
}

export type ComputerBackupCapability = {
  supported: boolean
  protocolVersion: number
}

export type BackupRootPublic = {
  id: string
  kind: SyncRootKind
  displayName: string
  sourcePathIdentifier: string
  folderId: string
  status: SyncRootStatus
  /** When the computer claimed this root; null if no computer ever has. */
  acknowledgedAt: string | null
  fileCount: number
  folderCount: number
  byteCount: number
  lastSyncAt: string | null
}

export type BackupProfilePublic = {
  id: string
  deviceId: string
  userId: string
  folderId: string
  status: DeviceBackupStatus
  health: DeviceBackupHealth
  lastSyncAt: string | null
  lastHeartbeatAt: string | null
  lastError: string | null
  fileCount: number
  folderCount: number
  byteCount: number
  roots: BackupRootPublic[]
  device: {
    id: string
    name: string
    platform: DevicePlatform
  }
}

export type BackupEnableResult = {
  profile: BackupProfilePublic
  credential: string | null
  credentialIssued: boolean
}

export type BackupEntryPublic = {
  id: string
  syncRootId: string
  clientEntryId: string
  relativePath: string
  entryType: SyncEntryType
  assetId: string | null
  folderId: string | null
  sizeBytes: number | null
  contentHash: string | null
  modifiedAtClient: string | null
  syncState: SyncEntryState
}

export type AssetSourceContext = {
  deviceId: string
  deviceName: string
  rootDisplayName: string
  relativePath: string
  breadcrumbs: string[]
  /** Present so All Files can later label a retired root without dropping the file. */
  rootStatus?: SyncRootStatus
}

export type ComputerCardPublic = {
  deviceId: string
  profileId: string
  name: string
  platform: DevicePlatform
  health: DeviceBackupHealth
  lastSyncAt: string | null
  lastHeartbeatAt: string | null
  fileCount: number
  byteCount: number
  roots: BackupRootPublic[]
}
