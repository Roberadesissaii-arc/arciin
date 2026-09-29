import type { ImportInspection } from "@arciin/shared"

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

/** Ask the server what is at a link: one item, up to five from a page or playlist, nothing, or a DRM host. */
export function inspectImportLink(url: string, signal?: AbortSignal) {
  return fetchApi<ImportInspection>("/imports/inspect", { method: "POST", body: { url }, signal })
}

export type ImportBatchResult = {
  accepted: Array<{ itemId: string; state: "started" | "waiting"; upload: UploadSessionSummary }>
  rejected: Array<{ itemId: string; message: string }>
}

/**
 * Import chosen items from an inspection. Only the ids are sent: the server
 * imports the URLs it found itself, re-checked, never ones the browser names.
 */
export function importInspectionItems(
  inspectionId: string,
  itemIds: string[],
  options?: ImportFromUrlOptions,
) {
  return fetchApi<ImportBatchResult>("/imports/batch", {
    method: "POST",
    body: {
      inspectionId,
      itemIds,
      targetLibraryId: options?.targetLibraryId,
      targetFolderId: options?.targetFolderId,
      audioOnly: options?.audioOnly,
      audioFormat: options?.audioFormat,
      videoFormat: options?.videoFormat,
    },
  })
}
