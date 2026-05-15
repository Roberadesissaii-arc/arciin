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

export type SecuritySettings = {
  publicSignupEnabled: boolean
  sessionTimeoutMinutes: number
  loginAlertsEnabled: boolean
  maxFailedLogins: number
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
  readOnlyTools: boolean
  requireToolApproval: boolean
  hideLibraryNames: boolean
  hideAssetCounts: boolean
  hideStorageSize: boolean
  hideUploadDates: boolean
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
