export const APP_VERSION = "1.0.2"

export const DEFAULT_LIBRARY_DEFINITIONS = [
  { name: "Videos", slug: "videos", kind: "VIDEO", icon: "video" },
  { name: "Images", slug: "images", kind: "IMAGE", icon: "image" },
  { name: "Music", slug: "music", kind: "AUDIO", icon: "audio" },
  { name: "Documents", slug: "documents", kind: "DOCUMENT", icon: "document" },
  { name: "Inbox", slug: "inbox", kind: "INBOX", icon: "inbox" },
] as const

/**
 * A folder or two to open each library with.
 *
 * A brand-new instance shows five empty libraries, and an empty folder list is
 * a worse first impression than it sounds: nothing demonstrates that folders
 * exist, so the first upload lands loose at the root and the feature is
 * discovered late or not at all. One or two obvious folders show the shape of
 * the thing without deciding how anyone files their library.
 *
 * Deliberately few, and deliberately generic. A starter folder someone has to
 * delete is worse than one that was never created — these are the ones almost
 * any library wants.
 */
export const DEFAULT_LIBRARY_FOLDERS: Record<string, readonly string[]> = {
  videos: ["Movies", "Shows"],
  images: ["Photos", "Screenshots"],
  music: ["Albums"],
  documents: ["Books", "Papers"],
  // Inbox is where unsorted files land by design; giving it folders would
  // contradict what it is for.
  inbox: [],
}

/**
 * Resolve setup's library choices to canonical names.
 *
 * Claim used to take any strings and filter the definitions by *name*, so a
 * payload of slugs — "videos" rather than "Videos" — selected nothing, claimed
 * successfully, and left an instance with no libraries at all. Every upload
 * then failed with LIBRARY_NOT_CONFIGURED, and the only way out was restarting
 * the API so the seed re-ran with an instance present.
 *
 * Slugs are accepted because they are the obvious guess, and anything not in
 * the known set returns null so the caller can reject it rather than quietly
 * building an unusable instance.
 */
export function normalizeLibrarySelection(values: string[]): string[] | null {
  const resolved: string[] = []
  for (const value of values) {
    const wanted = value.trim().toLowerCase()
    const match = DEFAULT_LIBRARY_DEFINITIONS.find(
      (library) => library.name.toLowerCase() === wanted || library.slug.toLowerCase() === wanted,
    )
    if (!match) return null
    if (!resolved.includes(match.name)) resolved.push(match.name)
  }
  return resolved.length > 0 ? resolved : null
}

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

/**
 * Deadlines for every Redis client in the product.
 *
 * ioredis defaults to queueing commands while a connection is down and
 * retrying them forever. Combined with `maxRetriesPerRequest: null` — which
 * BullMQ requires, and which had been copied onto the API's ordinary command
 * client — a Redis outage stopped being an error and became an indefinite
 * wait: sign-in, uploads and `/api/health` all hung until the caller gave up,
 * so the instance looked frozen rather than degraded (ARC-002).
 *
 * A command that cannot reach Redis has to fail, and fail quickly enough that
 * the caller can say something useful. These are deliberately short: Redis is
 * either local or one hop away in every supported deployment, so anything
 * slower than this is a fault, not load.
 */
export const REDIS_CONNECT_TIMEOUT_MS = 5_000
export const REDIS_COMMAND_TIMEOUT_MS = 3_000

/**
 * Reconnect backoff, capped so recovery stays fast.
 *
 * Redis returning has to heal the instance on its own — a self-hosted
 * appliance has nobody to restart the API by hand.
 */
export function redisRetryDelayMs(attempt: number): number {
  return Math.min(attempt * 200, 2_000)
}

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
  transcribeMedia: "transcribe_media",
} as const
