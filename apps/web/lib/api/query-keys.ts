export const queryKeys = {
  instanceStatus: ["instance", "status"] as const,
  updateCheck: ["instance", "update-check"] as const,
  autoUpdateSettings: ["instance", "auto-update"] as const,
  authMe: ["auth", "me"] as const,
  userPreferences: ["auth", "preferences"] as const,
  libraries: ["libraries"] as const,
  library: (libraryId: string) => ["library", libraryId] as const,
  folders: (libraryId: string, folderId?: string | null) =>
    ["folders", libraryId, folderId ?? "root"] as const,
  /** Prefix for invalidating every assets query (library grids, search, etc.). */
  assetsRoot: ["assets"] as const,
  /** Server-side totals for the All Files header; invalidated by asset mutations. */
  assetStats: ["assets", "stats"] as const,
  assets: (filters: Record<string, unknown> = {}) => ["assets", filters] as const,
  /** Paginated library/folder browsing. Shares the "assets" prefix so realtime invalidation reaches it. */
  assetsPage: (filters: Record<string, unknown> = {}) => ["assets", "page", filters] as const,
  trash: ["assets", "trash"] as const,
  /** Prefix for invalidating every activity query. */
  activityRoot: ["activity"] as const,
  activity: (filters: Record<string, unknown> = {}) =>
    ["activity", filters] as const,
  securityActivity: ["activity", "security"] as const,
  /** Prefix for every notifications query: the badge and each inbox page. */
  notificationsRoot: ["notifications"] as const,
  notifications: (params: { limit: number; offset: number }) =>
    ["notifications", params] as const,
  uploads: ["uploads"] as const,
  upload: (uploadId: string) => ["upload", uploadId] as const,
  jobs: ["jobs"] as const,
  job: (jobId: string) => ["job", jobId] as const,
  licenseStatus: ["license", "status"] as const,
  /**
   * Entitlement is scoped by user: an unscoped key let one account's plan seed
   * the next account's first render after a logout/login.
   */
  licenseStatusFor: (userId: string | null) => ["license", "status", userId ?? "anonymous"] as const,
  generalSettings: ["settings", "general"] as const,
  storageSettings: ["settings", "storage"] as const,
  storageVolumes: ["settings", "storage", "volumes"] as const,
  storageMigrateStatus: ["settings", "storage", "migrate"] as const,
  remoteAccessSettings: ["settings", "remote-access"] as const,
  cloudflareTunnel: ["settings", "cloudflare-tunnel"] as const,
  securitySettings: ["settings", "security"] as const,
  securityLog: ["settings", "security", "log"] as const,
  modelProfiles: ["models"] as const,
  chatProfiles: ["chat", "profiles"] as const,
  chatSelection: ["chat", "selection"] as const,
  apiKeys: ["api-keys"] as const,
  integrations: ["integrations"] as const,
  plexStatus: ["integrations", "plex", "status"] as const,
  jellyfinStatus: ["integrations", "jellyfin", "status"] as const,
  webhooks: ["webhooks"] as const,
  webhookDeliveries: (endpointId: string) => ["webhooks", endpointId, "deliveries"] as const,
  adminTables: ["admin", "tables"] as const,
  adminTableData: (table: string, page: number, status = "all") =>
    ["admin", "table", table, page, status] as const,
  appDatabases: ["app-databases"] as const,
  appDatabase: (id: string) => ["app-database", id] as const,
  appDatabaseFolders: (databaseId: string) => ["app-database-folders", databaseId] as const,
  appFolderRecords: (folderId: string) => ["app-folder-records", folderId] as const,
  sessions: ["auth", "sessions"] as const,
  chatConversations: ["chat", "conversations"] as const,
  chatConversation: (id: string) => ["chat", "conversation", id] as const,
  chatContext: ["chat", "context"] as const,
  availableModels: (profileId: string) => ["models", profileId, "available"] as const,
  ollamaModelShow: (profileId: string, model: string) => ["models", profileId, "show", model] as const,
  ollamaModelCapabilities: (profileId: string, modelsKey: string) =>
    ["models", profileId, "capabilities", modelsKey] as const,
  aiSettings: ["settings", "ai"] as const,
  aiSecuritySettings: ["settings", "ai-security"] as const,
  passwordVault: ["settings", "password-vault"] as const,
  apiProtectionStatus: ["settings", "api-protection", "status"] as const,
  adminUsers: ["settings", "users"] as const,
  connectedDevices: ["settings", "devices"] as const,
  computers: ["computers"] as const,
  computer: (deviceId: string) => ["computers", deviceId] as const,
  computerBrowse: (deviceId: string, folderId?: string | null) =>
    ["computers", deviceId, "browse", folderId ?? "root"] as const,
  accessControlStatus: ["settings", "access-control", "status"] as const,
  logsOverview: ["logs", "overview"] as const,
  logFiles: ["logs", "files"] as const,
  logTail: (filename: string, lines: number) => ["logs", "tail", filename, lines] as const,
  shareLinks: ["shares"] as const,
  mobileAppInstall: ["settings", "mobile-app", "install"] as const,
} as const
