import { fetchApi } from "@/lib/api/client"
import type { AssetSummary } from "@/lib/types/models"

export type AssetFilters = {
  libraryId?: string
  folderId?: string
  mediaType?: string
  /** Server-side filter: code (scripts) or applications (installers). */
  category?: "code" | "applications"
  search?: string
}

export function getAssets(filters: AssetFilters = {}, signal?: AbortSignal) {
  const params = new URLSearchParams()

  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value)
    }
  })

  const query = params.size ? `?${params.toString()}` : ""

  return fetchApi<AssetSummary[]>(`/assets${query}`, {
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

export function updateAsset(
  assetId: string,
  input: { title?: string; description?: string; originalFilename?: string },
) {
  return fetchApi<AssetSummary>(`/assets/${assetId}`, { method: "PATCH", body: input })
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
