export const SOCKET_EVENT_TYPES = [
  "upload.started",
  "upload.progress",
  "upload.completed",
  "upload.failed",
  "asset.created",
  "asset.updated",
  "asset.moved",
  "asset.deleted",
  "asset.classified",
  "thumbnail.created",
  "media.metadata.extracted",
  "media.processing.completed",
  "media.processing.failed",
  "asset.transcript.updated",
  "asset.transcript.ready",
  "asset.transcript.failed",
  "library.created",
  "library.updated",
  "library.scanned",
  "job.created",
  "job.progress",
  "job.completed",
  "job.failed",
  "activity.created",
  /** Read state changed for one user; every tab/device of theirs refetches. */
  "notifications.read",
  "instance.urls.updated",
  "plex.connected",
  "plex.sync.started",
  "plex.sync.completed",
  "plex.sync.failed",
  /** A folder's incoming File Request uploads changed. Owner-only; carries a FolderIncomingSummary. */
  "file-request.incoming",
] as const

export type SocketEventType = (typeof SOCKET_EVENT_TYPES)[number]

export type RealtimeEvent = {
  id: string
  type: SocketEventType
  userId?: string
  instanceId?: string
  libraryId?: string
  uploadId?: string
  assetId?: string
  jobId?: string
  progress?: number
  message?: string
  data?: Record<string, unknown>
  /**
   * "user": deliver to `user:{userId}` only — not to the library room, and not
   * to the instance feed OWNER/ADMIN sockets otherwise receive. For events
   * about one person's own things.
   */
  audience?: "user"
  createdAt: string
}

/** Lifecycle step of one incoming File Request upload, as announced to the owner. */
export type IncomingPhase = "started" | "progress" | "verifying" | "completed" | "ended"

/**
 * What one folder is receiving through File Requests. Counts and bytes only:
 * no token, submitter or file name.
 */
export type FolderIncomingSummary = {
  folderId: string
  libraryId: string
  activeUploadCount: number
  totalBytes: number
  receivedBytes: number
  /** receivedBytes / totalBytes, 0–100, floored. */
  progressPercent: number
  /** RECEIVING: bytes arrived recently. VERIFYING: checking the finished file. WAITING: open but quiet. IDLE: nothing open. */
  state: "RECEIVING" | "VERIFYING" | "WAITING" | "IDLE"
}
