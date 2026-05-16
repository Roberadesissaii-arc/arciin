import { fetchApi } from "@/lib/api/client"
import type { CreateFolderInput, FolderSummary, LibrarySummary } from "@/lib/types/models"

export function getLibraries(signal?: AbortSignal) {
  return fetchApi<LibrarySummary[]>("/libraries", {
    method: "GET",
    signal,
  })
}

export function getLibrary(libraryId: string, signal?: AbortSignal) {
  return fetchApi<LibrarySummary>(`/libraries/${libraryId}`, {
    method: "GET",
    signal,
  })
}

export function getFolders(libraryId: string, signal?: AbortSignal) {
  return fetchApi<FolderSummary[]>(`/libraries/${libraryId}/folders`, {
    method: "GET",
    signal,
  })
}

export function createFolder(input: CreateFolderInput) {
  const { libraryId: _lid, ...body } = input
  return fetchApi<FolderSummary>(`/libraries/${input.libraryId}/folders`, {
    method: "POST",
    body,
  })
}

export function updateFolder(folderId: string, body: { name: string }) {
  return fetchApi<FolderSummary>(`/folders/${folderId}`, {
    method: "PATCH",
    body,
  })
}

export function deleteFolder(folderId: string) {
  return fetchApi<{ success: boolean }>(`/folders/${folderId}`, {
    method: "DELETE",
  })
}
