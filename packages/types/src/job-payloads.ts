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
