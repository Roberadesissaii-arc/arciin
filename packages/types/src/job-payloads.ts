export type AnalyzeFilePayload = {
  assetId: string
  uploadId?: string
  userId?: string
}

export type ImportUrlPayload = {
  url: string
  uploadId: string
  userId: string
  targetLibraryId?: string
  targetFolderId?: string
  /** Extract audio only instead of downloading the full video. */
  audioOnly?: boolean
  /** Audio codec when audioOnly is true (yt-dlp --audio-format). */
  audioFormat?: "mp3" | "m4a"
  /** Video container when downloading video (yt-dlp --merge-output-format or best). */
  videoFormat?: "mp4" | "best"
}

export type ExtractMetadataPayload = {
  assetId: string
  uploadId?: string
  userId?: string
}

export type GenerateThumbnailPayload = {
  assetId: string
  userId?: string
}

export type CleanupTempFilesPayload = {
  olderThanHours?: number
}

export type PurgeExpiredTrashPayload = {
  /** Optional: override retention for tests. Defaults to TRASH_RETENTION_DAYS. */
  retentionDays?: number
}

export type CalculateStorageUsagePayload = {
  requestedByUserId?: string
}

export type MigrateStoragePayload = {
  fromRoot: string
  toRoot: string
  requestedByUserId?: string
}

export type PlexSyncPlaceholderPayload = {
  integrationId: string
  requestedByUserId?: string
}

export type StageUpdatePayload = {
  targetVersion: string
}

export type ApplyUpdatePayload = {
  requestedByUserId?: string
}

/**
 * Turn the speech in a media asset into a timestamped transcript.
 *
 * Queued rather than run inline because the work is unbounded: a two-hour
 * recording takes minutes of upload and model time, and an HTTP request tied to
 * a React drawer would die the moment someone closed it. `transcriptId` is
 * created before the job is enqueued so the UI has something to watch straight
 * away.
 */
export type TranscribeMediaPayload = {
  assetId: string
  transcriptId: string
  userId: string
  /** Gemini model profile to bill against. Omit to use the default. */
  profileId?: string
  jobRecordId?: string
}

/**
 * Generate a dub: separate, synthesise, fit, mix, store.
 *
 * Queued rather than awaited because every stage is unbounded — separation
 * alone runs at roughly 13x realtime on a CPU without AVX — and because the
 * work must outlive the panel that asked for it. The `MediaDub` row exists
 * before the job is enqueued, so the UI has a status to watch immediately and
 * a reopened panel picks the run up where it is.
 */
export type DubMediaPayload = {
  assetId: string
  dubId: string
  translationId: string
  userId: string
  /** Gemini model profile to bill against. Omit to use the default. */
  profileId?: string
  jobRecordId?: string
}
