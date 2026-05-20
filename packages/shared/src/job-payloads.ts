export type AnalyzeFilePayload = {
  assetId: string
  uploadId?: string
  userId?: string
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
