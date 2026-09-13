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
  kind: "recommended" | "mount" | "runtime" | "os-root" | "custom" | "unmounted"
  filesystem: string | null
  device: string | null
  totalBytes: number | null
  availableBytes: number | null
  writable: boolean
  recommended: boolean
  largeExternal: boolean
  /** Present on /settings/storage/volumes — true when Arciin already stores files here. */
  isCurrent?: boolean
  /** Same block device / mount as the active storage root (different folder only). */
  sameDiskAsCurrent?: boolean
}

export type UnmountedBlockDevice = {
  id: string
  device: string
  name: string
  sizeLabel: string
  sizeBytes: number | null
  filesystem: string | null
  isLuks: boolean
  needsFormat?: boolean
  type: "disk" | "part"
  suggestedMountPoint: string
  suggestedArciinPath: string
  model?: string | null
  transport?: string | null
}

export type CurrentStorageDeviceContext = {
  mountDevice: string | null
  mountPoint: string | null
  filesystemTotalBytes: number | null
  filesystemAvailableBytes: number | null
  blockDevice: string | null
  blockDeviceSizeBytes: number | null
  blockDeviceModel: string | null
  blockDeviceTransport: string | null
}

export type StorageBlockDisk = {
  id: string
  device: string
  name: string
  sizeLabel: string
  sizeBytes: number | null
  model: string | null
  transport: string | null
  role: "system" | "attached" | "internal"
  unmountedPartitionCount: number
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
  /** Block devices visible to lsblk but not mounted (mount on the host, then Rescan). */
  unmountedDevices: UnmountedBlockDevice[]
  /** Physical disks detected on the server (NVMe, SD, USB, etc.). */
  blockDisks?: StorageBlockDisk[]
  /** Where Arciin data lives vs the underlying physical disk size. */
  currentDeviceContext?: CurrentStorageDeviceContext | null
  mountPasswordlessSudo: boolean
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
  /** Folder created via API or received API-key uploads. */
  isRemote?: boolean
  /** When true, assets in this folder are hidden from All Files. */
  hideFromAllFiles?: boolean
  isLocked?: boolean
  accessGranted?: boolean
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

/**
 * Compact AI state, sent with the listing so a card needs no request of its own.
 *
 * Deliberately about activity rather than about any one operation: whatever
 * learns to run in the background next will want the same indicator, and a card
 * should not be redesigned each time.
 */
export type AssetAiActivity = {
  active: boolean
  kind: "transcript"
  /** Human, for a tooltip. Never an internal id. */
  label: string
  stage: string | null
  updatedAt: string | null
  status: "running" | "failed"
}

export type AssetAiSummary = {
  /** Original plus translated. A Hindi video with two translations is 3. */
  languageCount: number
  activity: AssetAiActivity | null
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
  /** PDF page count when extracted. */
  pageCount?: number | null
  /** PDF InfoDict author when present. */
  documentAuthor?: string | null
  /** PDF InfoDict subject when present. */
  documentSubject?: string | null
  /** Assist → Summarize result for documents. */
  documentInsight?: {
    summary: string
    keywords: string[]
    links: string[]
    about: { kind: string; title: string; note: string | null } | null
    topics: string[]
    model: string | null
    generatedAt: string | null
  } | null
  status: AssetStatus
  processingError?: string | null
  importSourceUrl?: string | null
  /** Device channel the upload came from ("web" | "mobile" | "api") — fallback badge when there's no import source. */
  uploadClient?: string | null
  badgeLabel?: string | null
  badgeColor?: string | null
  showBadge?: boolean
  /** Set when an AI cover exists, so the card asks the server for it. */
  coverImageAt?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  /** Set when the user archived the file (All Files → Archives). */
  archivedAt?: string | null
  /** Absent on responses that predate the summary, or on single-asset reads. */
  ai?: AssetAiSummary
}

export type ShareResourceType = "ASSET" | "ASSETS" | "FOLDER"

export type ShareLinkSummary = {
  id: string
  resourceType: ShareResourceType
  assetId?: string | null
  folderId?: string | null
  assetCount?: number
  tokenPrefix: string
  label: string
  expiresAt?: string | null
  maxViews?: number | null
  viewCount: number
  allowDownload: boolean
  lastViewedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type CreateShareInput = {
  resourceType: ShareResourceType
  assetId?: string
  assetIds?: string[]
  folderId?: string
  label?: string
  expiresInDays?: number
  maxViews?: number
  allowDownload?: boolean
}

export type CreateShareResult = ShareLinkSummary & {
  rawToken: string
  shareUrlPath: string
}

export type PublicShareAsset = {
  id: string
  originalFilename: string
  title?: string | null
  mimeType: string
  mediaType: MediaType
  extension: string
  sizeBytes: number
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  status: AssetStatus
  updatedAt: string
}

export type PublicShareFolderEntry = {
  id: string
  name: string
  slug: string
  assetCount: number
}

export type PublicShareView =
  | {
      resourceType: "ASSET"
      label: string
      allowDownload: boolean
      expiresAt?: string | null
      asset: PublicShareAsset
    }
  | {
      resourceType: "FOLDER"
      label: string
      allowDownload: boolean
      expiresAt?: string | null
      folder: {
        id: string
        name: string
        slug: string
        rootFolderId: string
        folders: PublicShareFolderEntry[]
        /** Only the page loaded so far — use assetCount for the real total. */
        assets: PublicShareAsset[]
        assetCount?: number
        hasMore?: boolean
        nextCursor?: string | null
      }
    }
  | {
      resourceType: "ASSETS"
      label: string
      allowDownload: boolean
      expiresAt?: string | null
      assets: PublicShareAsset[]
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

export type MobileAppInstallStatus = {
  clonePresent: boolean
  pm2Online: boolean
  installed: boolean
  installRunning: boolean
  installState: "idle" | "running" | "done" | "failed"
  serverRoot: string
  mobileDir: string
  mobilePort: string | null
  mobileUrl: string | null
  serverRepoUrl: string
  mobileRepoUrl: string
  installCommands: string
  installLogTail: string | null
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
  /** When true (default), API starts cloudflared on boot if tunnel mode is enabled. */
  cloudflareTunnelAutoStart?: boolean
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
  /** Let the assistant illustrate a Canvas draft. Off by default: each picture is paid for. */
  canvasImages: boolean
  emojiUsage: AiEmojiUsage
}

/** Subset of Ollama `POST /api/show` JSON (fields vary by version). */
export type OllamaModelCapabilityEntry = {
  model: string
  capabilities: string[]
  vision: boolean
  thinking: boolean
}

export type OllamaModelCapabilitiesResult = {
  entries: OllamaModelCapabilityEntry[]
  fromCache: boolean
}

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
  ttsModel: string | null
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
  ttsModel?: string | null
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
  /** "degraded" is served with HTTP 503 so supervisors see the outage too. */
  status?: "ready" | "degraded"
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
  rememberMe?: boolean
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

export type PairedDevicePublic = {
  id: string
  name: string
  platform: "WINDOWS" | "MACOS" | "LINUX" | "IOS" | "ANDROID" | "OTHER"
  deviceType: "DESKTOP" | "LAPTOP" | "PHONE" | "TABLET" | "OTHER"
  status: "ACTIVE" | "REVOKED"
  pairedAt: string
  lastSeenAt: string | null
  appVersion: string | null
  protocolVersion: number
}

export type DeviceSettingsSnapshot = {
  devices: PairedDevicePublic[]
  pairing: {
    expiresAt: string
    createdAt: string
  } | null
  ttlMinutes: number
  protocolVersion: number
  instanceName: string
  localUrl: string | null
  mdns: {
    serviceType: string
    advertised: boolean
  }
}

export type DevicePairingCodeResult = {
  code: string
  displayCode: string
  expiresAt: string
  ttlMinutes: number
}
