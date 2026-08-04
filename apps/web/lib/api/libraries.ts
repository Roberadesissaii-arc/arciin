import { fetchApi } from "@/lib/api/client"
import type {
  CreateFolderInput,
  FolderSummary,
  LibrarySummary,
} from "@/lib/types/models"

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
  const { libraryId, ...body } = input
  return fetchApi<FolderSummary>(`/libraries/${libraryId}/folders`, {
    method: "POST",
    body,
  })
}

export function updateFolder(
  folderId: string,
  body: { name?: string; hideFromAllFiles?: boolean },
) {
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

export type FolderCredentialInput = { password?: string; pin?: string }

export function lockFolder(folderId: string, input: FolderCredentialInput) {
  return fetchApi<FolderSummary>(`/folders/${folderId}/lock`, {
    method: "POST",
    body: input,
  })
}

export function unlockFolder(folderId: string, input: FolderCredentialInput) {
  return fetchApi<FolderSummary>(`/folders/${folderId}/unlock`, {
    method: "POST",
    body: input,
  })
}

export function removeFolderLock(folderId: string, input: FolderCredentialInput) {
  return fetchApi<FolderSummary>(`/folders/${folderId}/remove-lock`, {
    method: "POST",
    body: input,
  })
}
