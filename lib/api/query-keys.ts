export const queryKeys = {
  instanceStatus: ["instance", "status"] as const,
  authMe: ["auth", "me"] as const,
  libraries: ["libraries"] as const,
  library: (libraryId: string) => ["library", libraryId] as const,
  folders: (libraryId: string, folderId?: string | null) =>
    ["folders", libraryId, folderId ?? "root"] as const,
  assets: (filters: Record<string, unknown> = {}) => ["assets", filters] as const,
  activity: (filters: Record<string, unknown> = {}) =>
    ["activity", filters] as const,
  uploads: ["uploads"] as const,
  upload: (uploadId: string) => ["upload", uploadId] as const,
  jobs: ["jobs"] as const,
  job: (jobId: string) => ["job", jobId] as const,
  storageSettings: ["settings", "storage"] as const,
  remoteAccessSettings: ["settings", "remote-access"] as const,
  apiKeys: ["api-keys"] as const,
  integrations: ["integrations"] as const,
} as const
