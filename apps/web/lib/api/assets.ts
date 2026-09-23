import { fetchApi } from "@/lib/api/client"
import type { AssetSummary } from "@/lib/types/models"
import type { PdfPageLabel } from "@arciin/shared"

export type AssetFilters = {
  libraryId?: string
  folderId?: string
  /** When true, only assets at the library root (not inside a folder). */
  rootOnly?: boolean
  mediaType?: string
  /** Server-side filter: code, installers, or Other (uncategorized + zips). */
  category?: "code" | "applications" | "other"
  search?: string
  /** Include Inbox in an undirected cross-library listing (chat "latest upload"). */
  includeInbox?: boolean
  /** `only` = Archives chip; default excludes archived from main views. */
  archived?: "exclude" | "only" | "include"
}

export function getAssets(filters: AssetFilters = {}, signal?: AbortSignal) {
  const params = new URLSearchParams()

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return
    if (typeof value === "boolean") {
      if (value) params.set(key, "true")
      return
    }
    params.set(key, String(value))
  })

  const query = params.size ? `?${params.toString()}` : ""

  return fetchApi<AssetSummary[]>(`/assets${query}`, {
    method: "GET",
    signal,
  })
}

export type AssetPageFilters = AssetFilters & {
  cursor?: string
  limit?: number
  withTotal?: boolean
}

export type AssetPage = {
  items: AssetSummary[]
  nextCursor: string | null
  hasMore: boolean
  /** Only present when withTotal was requested (first page). */
  total?: number
}

/** Cursor-paginated listing used by library and folder browsing. */
export function getAssetsPage(filters: AssetPageFilters = {}, signal?: AbortSignal) {
  const params = new URLSearchParams()

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return
    if (typeof value === "boolean") {
      if (value) params.set(key, "true")
      return
    }
    params.set(key, String(value))
  })

  const query = params.size ? `?${params.toString()}` : ""

  return fetchApi<AssetPage>(`/assets/page${query}`, {
    method: "GET",
    signal,
  })
}

export function moveAsset(
  assetId: string,
  input: { folderId?: string; libraryId?: string } = {}
) {
  const body: { folderId?: string; libraryId?: string } = {}
  if (input.folderId !== undefined) {
    body.folderId = input.folderId
  }
  if (input.libraryId !== undefined) {
    body.libraryId = input.libraryId
  }

  return fetchApi<AssetSummary>(`/assets/${assetId}/move`, {
    method: "POST",
    body,
  })
}

export function deleteAsset(assetId: string) {
  return fetchApi<{ success: true }>(`/assets/${assetId}`, {
    method: "DELETE",
  })
}

/** Soft-archive: hide from main libraries; show under All Files → Archives. */
export function archiveAsset(assetId: string) {
  return fetchApi<AssetSummary>(`/assets/${assetId}/archive`, {
    method: "POST",
  })
}

export function unarchiveAsset(assetId: string) {
  return fetchApi<AssetSummary>(`/assets/${assetId}/unarchive`, {
    method: "POST",
  })
}

export type TrashAssetSummary = AssetSummary & {
  libraryName: string
  librarySlug: string
  expiresAt: string
  daysRemaining: number
  retentionDays: number
}

/** Trash API lives under /trash (not /assets/trash) to avoid id collisions. */
export function getTrashAssets(signal?: AbortSignal) {
  return fetchApi<TrashAssetSummary[]>("/trash", {
    method: "GET",
    signal,
  })
}

export function restoreTrashAsset(assetId: string) {
  return fetchApi<TrashAssetSummary>(`/trash/${assetId}/restore`, {
    method: "POST",
  })
}

export function permanentlyDeleteTrashAsset(assetId: string) {
  return fetchApi<{ success: true }>(`/trash/${assetId}`, {
    method: "DELETE",
  })
}

export function emptyTrash() {
  return fetchApi<{ removed: number }>("/trash/empty", {
    method: "POST",
  })
}

export function updateAsset(
  assetId: string,
  input: {
    title?: string
    description?: string
    originalFilename?: string
    badgeLabel?: string | null
    badgeColor?: string | null
    showBadge?: boolean
  },
) {
  return fetchApi<AssetSummary>(`/assets/${assetId}`, { method: "PATCH", body: input })
}

export function fetchPdfNavigationIndex(assetId: string, signal?: AbortSignal) {
  return fetchApi<{ asset_id: string; num_pages: number; page_index: PdfPageLabel[] }>(
    `/assets/${assetId}/pdf-navigation-index`,
    { method: "GET", signal },
  )
}

export function getAssetsByIds(ids: string[], signal?: AbortSignal) {
  if (ids.length === 0) return Promise.resolve([] as AssetSummary[])
  return fetchApi<AssetSummary[]>(`/assets?ids=${encodeURIComponent(ids.join(","))}`, {
    method: "GET",
    signal,
  })
}

export type DuplicateHit = { filename: string; assetId: string }

export async function checkDuplicates(
  filenames: string[],
  context: { libraryId?: string; folderId?: string | null } = {},
) {
  const unique = [...new Set(filenames)]
  const duplicates: DuplicateHit[] = []
  const chunkSize = 200

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    const result = await fetchApi<{ duplicates: DuplicateHit[] }>("/assets/check-duplicates", {
      method: "POST",
      body: { filenames: chunk, ...context },
    })
    duplicates.push(...result.duplicates)
  }

  return { duplicates }
}

/**
 * The counts the All Files header shows, from the database.
 *
 * "Active" means not trashed, not archived, and not inside a deleted or hidden
 * folder — the same predicate the listing uses. Archived is reported
 * separately rather than folded in.
 */
export type AssetStats = {
  active: number
  images: number
  videos: number
  audio: number
  documents: number
  archived: number
}

export function getAssetStats(signal?: AbortSignal) {
  return fetchApi<AssetStats>("/assets/stats", { method: "GET", signal })
}
