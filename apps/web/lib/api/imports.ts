import type { ImportInspection } from "@arciin/shared"

import { clientApiBase, fetchApi } from "@/lib/api/client"
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
  /**
   * The inspection candidate this link came from. The server uses it only to
   * look up the title it stored; no title is ever sent from here.
   */
  candidate?: { inspectionId: string; itemId: string }
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
      inspectionId: options?.candidate?.inspectionId,
      itemId: options?.candidate?.itemId,
    },
  })
}

/** Same-origin preview for an inspection candidate (the server fetches the third-party image). */
export function importCandidateThumbnailUrl(inspectionId: string, itemId: string) {
  return `${clientApiBase}/imports/inspections/${encodeURIComponent(inspectionId)}/items/${encodeURIComponent(itemId)}/thumbnail`
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
