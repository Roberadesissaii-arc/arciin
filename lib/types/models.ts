export type UserRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"

export type UserStatus = "ACTIVE" | "DISABLED"

export type LibraryKind =
  | "VIDEO"
  | "IMAGE"
  | "AUDIO"
  | "DOCUMENT"
  | "INBOX"
  | "CUSTOM"

export type MediaType =
  | "VIDEO"
  | "IMAGE"
  | "AUDIO"
  | "DOCUMENT"
  | "ARCHIVE"
  | "OTHER"

export type AssetStatus = "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | "DELETED"

export type UploadStatus =
  | "QUEUED"
  | "UPLOADING"
  | "UPLOADED"
  | "ANALYZING"
  | "CLASSIFIED"
  | "PROCESSING"
  | "READY"
  | "FAILED"

export type JobStatus = "QUEUED" | "ACTIVE" | "COMPLETED" | "FAILED"

export type IntegrationType = "PLEX" | "S3" | "WEBHOOK" | "CUSTOM"

export type UserSummary = {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
}

export type SessionSummary = {
  id: string
  userId: string
  expiresAt: string
  createdAt: string
}

export type AuthSession = {
  user: UserSummary
  session: SessionSummary
}

export type InstanceStatus = {
  initialized: boolean
  setupRequired: boolean
  instanceName?: string
  version: string
}

export type InstanceSummary = {
  id: string
  instanceName: string
  storageRoot: string
  publicUrl?: string | null
  initializedAt: string
  createdAt: string
  updatedAt: string
}

export type StorageLocationSummary = {
  id: string
  name: string
  type: "LOCAL"
  rootPath: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export type LibrarySummary = {
  id: string
  name: string
  slug: string
  description?: string | null
  kind: LibraryKind
  icon?: string | null
  color?: string | null
  storageLocationId: string
  assetCount: number
  folderCount: number
  createdAt: string
  updatedAt: string
}

export type FolderSummary = {
  id: string
  libraryId: string
  parentFolderId?: string | null
  name: string
  slug: string
  pathCache: string
  assetCount: number
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type AssetSummary = {
  id: string
  libraryId: string
  folderId?: string | null
  storageObjectId: string
  ownerId: string
  filename: string
  originalFilename: string
  title?: string | null
  description?: string | null
  mimeType: string
  mediaType: MediaType
  extension: string
  sizeBytes: number
  checksumSha256: string
  durationSeconds?: number | null
  width?: number | null
  height?: number | null
  codec?: string | null
  status: AssetStatus
  processingError?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type UploadSessionSummary = {
  id: string
  userId: string
  originalFilename: string
  mimeType?: string | null
  sizeBytes: number
  status: UploadStatus
  progress: number
  targetLibraryId?: string | null
  targetFolderId?: string | null
  detectedMediaType?: MediaType | null
  assetId?: string | null
  error?: string | null
  createdAt: string
  updatedAt: string
  completedAt?: string | null
  targetLibrary?: LibrarySummary | null
}

export type JobSummary = {
  id: string
  type: string
  status: JobStatus
  progress: number
  payload: Record<string, unknown>
  result?: Record<string, unknown> | null
  error?: string | null
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

export type ActivitySummary = {
  id: string
  userId?: string | null
  type: string
  title: string
  message?: string | null
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: string
}

export type ApiKeySummary = {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt?: string | null
  expiresAt?: string | null
  createdAt: string
  revokedAt?: string | null
}

export type IntegrationSummary = {
  id: string
  type: IntegrationType
  name: string
  enabled: boolean
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type StorageSettings = {
  instanceName?: string
  storageRoot: string
  defaultLocationId?: string | null
  writable: boolean
  usageBytes: number
  objectCount: number
  totalBytes?: number | null
  availableBytes?: number | null
}

export type RemoteAccessSettings = {
  publicUrl?: string | null
  localUrl?: string | null
  currentUrl?: string | null
  mode: "local" | "reverse-proxy" | "cloudflare-tunnel"
  reverseProxyEnabled: boolean
  cloudflareTunnelEnabled: boolean
}

export type HealthStatus = {
  api: "online" | "offline"
  database: "online" | "offline"
  redis: "online" | "offline"
  worker: "online" | "offline" | "unknown"
  storage: "online" | "offline"
  version: string
  timestamp: string
}

export type ClaimInstanceInput = {
  setupToken: string
  instanceName: string
  adminName: string
  adminEmail: string
  adminPassword: string
  confirmPassword: string
  storageRoot: string
  libraries: string[]
  acceptedTermsAndPrivacy: boolean
}

export type LoginInput = {
  email: string
  password: string
}

export type CreateFolderInput = {
  libraryId: string
  name: string
  parentFolderId?: string
}

export type CreateApiKeyInput = {
  name: string
  scopes: string[]
  expiresAt?: string
}

export type CreateApiKeyResult = {
  apiKey: ApiKeySummary
  rawKey: string
}
