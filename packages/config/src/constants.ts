export const APP_VERSION = "0.1.0"

export const DEFAULT_LIBRARY_DEFINITIONS = [
  { name: "Videos", slug: "videos", kind: "VIDEO", icon: "video" },
  { name: "Images", slug: "images", kind: "IMAGE", icon: "image" },
  { name: "Music", slug: "music", kind: "AUDIO", icon: "audio" },
  { name: "Documents", slug: "documents", kind: "DOCUMENT", icon: "document" },
  { name: "Inbox", slug: "inbox", kind: "INBOX", icon: "inbox" },
] as const

export const API_KEY_SCOPES = [
  "assets:read",
  "assets:write",
  "libraries:read",
  "libraries:write",
  "uploads:create",
  "activity:read",
  "events:subscribe",
  "appdata:databases:read",
  "appdata:databases:write",
  "appdata:databases:delete",
  "appdata:folders:read",
  "appdata:folders:write",
  "appdata:folders:delete",
  "appdata:records:read",
  "appdata:records:write",
  "appdata:records:delete",
  "appdata:admin",
  "admin",
] as const

/** Identifies which Arciin client initiated a request (web dashboard, mobile PWA, or API key). */
export const ARCIIN_CLIENT_CHANNEL_HEADER = "x-arciin-client"
export const ARCIIN_CLIENT_CHANNELS = ["web", "mobile", "api"] as const
export type ArciinClientChannel = (typeof ARCIIN_CLIENT_CHANNELS)[number]

export const SOCKET_EVENT_CHANNEL = "arciin:events"
export const WORKER_HEARTBEAT_KEY = "arciin:worker:heartbeat"

export const JOB_QUEUE_NAMES = {
  media: "media",
  storage: "storage",
  integrations: "integrations",
} as const

export const MEDIA_LIBRARY_SLUGS = ["videos", "images", "music"] as const

/**
 * Soft-deleted assets stay in Trash this long (like iOS Recently Deleted),
 * then are permanently removed from disk and the database.
 */
export const TRASH_RETENTION_DAYS = 30

export const JOB_TYPES = {
  analyzeFile: "analyze_file",
  extractMetadata: "extract_metadata",
  generateThumbnail: "generate_thumbnail",
  importUrl: "import_url",
  syncConnectorMirror: "sync_connector_mirror",
  cleanupTempFiles: "cleanup_temp_files",
  calculateStorageUsage: "calculate_storage_usage",
  migrateStorage: "migrate_storage",
  plexSyncPlaceholder: "plex_sync_placeholder",
  stageUpdate: "stage_update",
  applyUpdate: "apply_update",
  purgeExpiredTrash: "purge_expired_trash",
} as const
