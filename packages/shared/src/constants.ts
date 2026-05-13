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
