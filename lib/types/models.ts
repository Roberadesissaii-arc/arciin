import type { AiLibraryToolAccess } from "@arciin/shared"

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
  | "APPLICATION"
  | "CODE"
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
  avatarUrl?: string | null
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
  /** Present for browser cookie sessions; null when using API key only. */
  session: SessionSummary | null
  apiKeyId?: string | null
  apiKeyScopes?: string[] | null
}

export type InstanceStatus = {
  initialized: boolean
  setupRequired: boolean
  instanceName?: string
  version: string
  /** Host or native path to pre-fill setup (not the in-container path when using Docker). */
  suggestedStorageRoot?: string
  runtimeStorageRoot?: string
  hostStorageRoot?: string | null
  isDockerRuntime?: boolean
  storageRootHint?: string
}

export type StorageVolumeOption = {
  id: string
  label: string
  arciinPath: string
  mountPoint: string | null
  kind: "recommended" | "mount" | "runtime" | "os-root" | "custom"
  filesystem: string | null
  device: string | null
  totalBytes: number | null
  availableBytes: number | null
  writable: boolean
  recommended: boolean
  largeExternal: boolean
}

export type StorageDiscovery = {
  runtimeDataDir: string
  hostDataDir: string | null
  isDockerRuntime: boolean
  recommendedArciinPath: string
  osRoot: {
    mountPoint: string
    totalBytes: number | null
    availableBytes: number | null
  }
  volumes: StorageVolumeOption[]
  installNotes: string[]
}

export type StoragePrepareResult = {
  arciinPath: string
  writable: boolean
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

export type AppDatabaseSummary = {
  id: string
  name: string
  slug: string
  description?: string | null
  createdById: string
  folderCount: number
  createdAt: string
  updatedAt: string
}

export type AppDatabaseFolderSummary = {
  id: string
  databaseId: string
  parentFolderId?: string | null
  name: string
  slug: string
  pathCache: string
  recordCount: number
  childFolderCount: number
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type AppDatabaseRecordSummary = {
  id: string
  folderId: string
  name: string
  payload: Record<string, unknown>
  mimeType?: string | null
  createdAt: string
  updatedAt: string
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

export type GeneralSettings = {
  instanceName: string
  version: string
  initializedAt: string | null
}

export type StorageSettings = {
  instanceName?: string
  /** Path shown in UI (host bind mount when Docker). */
  storageRoot: string
  runtimeStorageRoot?: string
  hostStorageRoot?: string | null
  isDockerRuntime?: boolean
  defaultLocationId?: string | null
  writable: boolean
  usageBytes: number
  objectCount: number
  totalBytes?: number | null
  availableBytes?: number | null
}

export type StorageMigrateStatus = {
  active: boolean
  job: {
    id: string
    status: string
    progress: number
    error: string | null
    result: unknown
    createdAt: string
    completedAt: string | null
  } | null
}

export type StorageMigrateStartResult = {
  jobId: string
  fromRoot: string
  toRoot: string
  displayRoot: string
}

export type MobileServerEndpoints = {
  webUrl: string
  apiBaseUrl: string
  socketUrl: string
  instanceName: string
  version: string
  requestOrigin: string | null
}

export type MobileConnectedDevice = {
  id: string
  userId: string
  userName: string
  userEmail: string
  deviceName: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  expiresAt: string
}

export type MobileConnectionSettings = {
  ttlMinutes: number
  activeCode: {
    expiresAt: string
    createdAt: string
  } | null
  server: MobileServerEndpoints
  devices: MobileConnectedDevice[]
}

export type MobilePairingCodeResult = {
  code: string
  expiresAt: string
  ttlMinutes: number
}

export type MobileDiscoverResult = {
  service: string
  initialized: boolean
  instanceName: string
  version: string
  webUrl: string
  apiBaseUrl: string
  socketUrl: string
  requestOrigin: string | null
  pairingSupported: boolean
}

export type MobilePairResult = {
  sessionToken: string
  sessionExpiresAt: string
  user: UserSummary
  server: MobileServerEndpoints
}

export type RemoteAccessSettings = {
  publicUrl?: string | null
  mobilePublicUrl?: string | null
  localUrl?: string | null
  loopbackUrl?: string | null
  lanUrls?: string[]
  primaryLanUrl?: string | null
  currentUrl?: string | null
  requestOrigin?: string | null
  mode: "local" | "reverse-proxy" | "cloudflare-tunnel"
  reverseProxyEnabled: boolean
  cloudflareTunnelEnabled: boolean
}

export type CloudflareTunnelStatus = {
  running: boolean
  url: string | null
  localTarget: string | null
  error: string | null
  /** Tunnel process died; saved trycloudflare URL will return Cloudflare 530. */
  stale?: boolean
  cloudflareTunnelEnabled: boolean
  publicUrl?: string | null
  mobilePublicUrl?: string | null
}

export type PasswordImportEntry = {
  name: string
  url?: string
  username?: string
  password?: string
  notes?: string
  category?: string
}

export type PasswordVaultDisplaySettings = {
  showUsername: boolean
  showUrl: boolean
  showNotes: boolean
  showCategory: boolean
  showPasswordColumn: boolean
  maskStyle: "dots" | "asterisk" | "block"
  revealByDefault: boolean
  lockSidebarVault: boolean
}

export type PasswordVaultEntry = {
  id: string
  name: string
  username: string | null
  password: string | null
  /** Present when password is redacted so the UI can still render a mask. */
  passwordLength?: number | null
  hasPassword?: boolean
  url: string | null
  notes: string | null
  category: string | null
  importSource: string | null
  createdAt: string
  updatedAt: string
}

export type SecuritySettings = {
  publicSignupEnabled: boolean
  sessionTimeoutMinutes: number
  loginAlertsEnabled: boolean
  maxFailedLogins: number
  idleLogoutEnabled: boolean
  idleLogoutMinutes: number
  /** Single IPs or CIDR strings; enforced at edge when supported. */
  ipAllowlist: string[]
  ipBlocklist: string[]
  /** When true, only allowlisted IPs may use the HTTP API (after enforcement ships). */
  enforceIpAllowlist: boolean
  /** 0 = disabled. Enforced on all /api routes (Redis). */
  apiGlobalRequestsPerMinute: number
  /** 0 = disabled. Enforced per API key on Bearer auth. */
  apiKeyRequestsPerMinute: number
  /** When true, POST /api-keys rejects keys without an expiresAt date. */
  requireApiKeyExpiry: boolean
  /** 0 = unlimited. POST /api-keys rejects expiry dates beyond this many days. */
  maxApiKeyExpiryDays: number
}

export type AiEmojiUsage = "none" | "low" | "medium" | "high"

export type AiSettings = {
  agent: boolean
  autonomy: boolean
  planning: boolean
  showThinking: boolean
  emojiUsage: AiEmojiUsage
}

/** Subset of Ollama `POST /api/show` JSON (fields vary by version). */
export type OllamaModelShowData = {
  parameters?: string
  license?: string
  template?: string
  capabilities?: string[]
  modified_at?: string
  details?: {
    parent_model?: string
    format?: string
    family?: string
    families?: string[]
    parameter_size?: string
    quantization_level?: string
  }
  model_info?: Record<string, unknown>
}

export type AiSecuritySettings = {
  blockInjection: boolean
  redactSecrets: boolean
  redactPII: boolean
  /** Derived from `libraryToolAccess === "vision_only"` for compatibility. */
  readOnlyTools: boolean
  /** What the chat agent may do via library server tools. */
  libraryToolAccess: AiLibraryToolAccess
  requireToolApproval: boolean
  hideLibraryNames: boolean
  hideAssetCounts: boolean
  hideStorageSize: boolean
  hideUploadDates: boolean
  /** blocked | count_only | metadata (secrets always [VAULT_ENCRYPTED] for AI). */
  passwordVaultAiAccess: "blocked" | "count_only" | "metadata"
  passwordVaultAiShare: {
    names: boolean
    usernames: boolean
    urls: boolean
    notes: boolean
  }
  passwordQueriesLocalAiOnly: boolean
}

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "ollama"
  | "gemini"
  | "deepseek"
  | "grok"
  | "meta"
  | "qwen"
  | "elevenlabs"
  | "custom"

export type ModelProfile = {
  id: string
  provider: ModelProvider | string
  displayName: string
  apiKeyMasked: string | null
  hasApiKey: boolean
  baseUrl: string | null
  defaultModel: string | null
  isDefault: boolean
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type CreateModelProfileInput = {
  provider: string
  displayName: string
  apiKey?: string | null
  baseUrl?: string | null
  defaultModel?: string | null
  isDefault?: boolean
  isEnabled?: boolean
}

export type UpdateModelProfileInput = Partial<CreateModelProfileInput>

/** Result of probing one model on ollama.com with the user's API key. */
export type OllamaCloudModelProbe = {
  name: string
  access: "available" | "paid" | "rate_limited" | "error"
  message?: string
}

export type OllamaAvailableModelsResult = {
  models: string[]
  fromCache: boolean
}

export type OllamaCloudModelsResult = {
  probes: OllamaCloudModelProbe[]
  fromCache: boolean
}

export type HealthStatus = {
  api: "online" | "offline"
  database: "online" | "offline"
  redis: "online" | "offline"
  realtime: "online" | "offline"
  worker: "online" | "offline" | "unknown"
  storage: "online" | "offline"
  version: string
  timestamp: string
}

export type LogFileSummary = {
  name: string
  sizeBytes: number
  modifiedAt: string
  source: "api" | "worker" | "other"
}

export type LogsOverview = {
  health: HealthStatus & { workerLastSeenAt: string | null }
  logs: {
    displayPath: string
    readable: boolean
    writable: boolean
    fileCount: number
    totalBytes: number
  }
  jobs: {
    queued: number
    active: number
    completed: number
    failed: number
    recentFailed: JobSummary[]
  }
  environment: string
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

export type ChangePasswordInput = {
  currentPassword: string
  newPassword: string
}

/** PATCH /auth/profile — at least one field required (validated server-side). */
export type UpdateProfileInput = {
  name?: string
  email?: string
}

export type SessionDetail = {
  id: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  expiresAt: string
  isCurrent: boolean
}

export type CreateFolderInput = {
  libraryId: string
  name: string
  /** Omit, or pass `null` / `""` for a folder at the library root. */
  parentFolderId?: string | null
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

export type WebhookEndpointSummary = {
  id: string
  name: string
  url: string
  enabled: boolean
  eventTypes: string[]
  secretPrefix: string
  createdAt: string
  updatedAt: string
}

export type WebhookDeliverySummary = {
  id: string
  endpointId: string
  eventType: string
  status: "PENDING" | "SUCCESS" | "FAILED"
  responseCode?: number | null
  responseBody?: string | null
  durationMs?: number | null
  error?: string | null
  createdAt: string
}

export type CreateWebhookEndpointInput = {
  name: string
  url: string
  enabled?: boolean
  eventTypes: string[]
}

export type CreateWebhookEndpointResult = {
  endpoint: WebhookEndpointSummary
  secret: string
}

export type UpdateWebhookEndpointInput = Partial<CreateWebhookEndpointInput> & {
  rotateSecret?: boolean
}
