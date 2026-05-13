import { fetchApi } from "@/lib/api/client"
import type { AssetSummary } from "@/lib/types/models"

export type AssetFilters = {
  libraryId?: string
  folderId?: string
  mediaType?: string
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
