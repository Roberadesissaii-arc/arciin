import { fetchApi } from "@/lib/api/client"
import type { UploadSessionSummary } from "@/lib/types/models"

export type ImportFromUrlOptions = {
  targetLibraryId?: string
  targetFolderId?: string
  /** Extract audio only instead of the full video. */
  audioOnly?: boolean
  /** Audio codec when audioOnly is true. */
  audioFormat?: "mp3" | "m4a"
  /** Video container when downloading video. */
  videoFormat?: "mp4" | "best"
}

/** Queue a server-side import of a public link (YouTube, image, PDF, …). */
export function importFromUrl(url: string, options?: ImportFromUrlOptions) {
  return fetchApi<UploadSessionSummary>("/imports", {
    method: "POST",
    body: {
      url,
      targetLibraryId: options?.targetLibraryId,
      targetFolderId: options?.targetFolderId,
      audioOnly: options?.audioOnly,
      audioFormat: options?.audioFormat,
      videoFormat: options?.videoFormat,
    },
  })
}
