export const APP_VERSION = "0.1.0"

export const DEFAULT_LIBRARY_DEFINITIONS = [
  { name: "Videos", slug: "videos", kind: "VIDEO", icon: "video" },
  { name: "Images", slug: "images", kind: "IMAGE", icon: "image" },
  { name: "Music", slug: "music", kind: "AUDIO", icon: "audio" },
  { name: "Documents", slug: "documents", kind: "DOCUMENT", icon: "document" },
  { name: "Applications", slug: "applications", kind: "CUSTOM", icon: "app" },
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

export const SOCKET_EVENT_CHANNEL = "arciin:events"
export const WORKER_HEARTBEAT_KEY = "arciin:worker:heartbeat"

export const JOB_QUEUE_NAMES = {
  media: "media",
  storage: "storage",
  integrations: "integrations",
} as const

export const JOB_TYPES = {
  analyzeFile: "analyze_file",
  extractMetadata: "extract_metadata",
  generateThumbnail: "generate_thumbnail",
  cleanupTempFiles: "cleanup_temp_files",
  calculateStorageUsage: "calculate_storage_usage",
  plexSyncPlaceholder: "plex_sync_placeholder",
} as const
