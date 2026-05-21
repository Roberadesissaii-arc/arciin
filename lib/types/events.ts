export type SocketEventPayload = {
  id: string
  type: string
  userId?: string
  libraryId?: string
  uploadId?: string
  assetId?: string
  jobId?: string
  progress?: number
  message?: string
  data?: Record<string, unknown>
  createdAt: string
}

export const socketEventTypes = [
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
  "library.created",
  "library.updated",
  "library.scanned",
  "job.created",
  "job.progress",
  "job.completed",
  "job.failed",
  "activity.created",
  "instance.urls.updated",
  "plex.connected",
  "plex.sync.started",
  "plex.sync.completed",
  "plex.sync.failed",
] as const

export type SocketEventType = (typeof socketEventTypes)[number]
