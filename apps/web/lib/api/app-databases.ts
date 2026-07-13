import { fetchApi } from "@/lib/api/client"
import type {
  AppDatabaseFolderSummary,
  AppDatabaseRecordSummary,
  AppDatabaseSummary,
} from "@/lib/types/models"

export function listAppDatabases(signal?: AbortSignal) {
  return fetchApi<AppDatabaseSummary[]>("/app-databases", { method: "GET", signal })
}

export function createAppDatabase(
  body: { name: string; description?: string },
  signal?: AbortSignal
) {
  return fetchApi<AppDatabaseSummary>("/app-databases", {
    method: "POST",
    body,
    signal,
  })
}

export function deleteAppDatabase(databaseId: string, signal?: AbortSignal) {
  return fetchApi<{ success: true }>(`/app-databases/${databaseId}`, {
    method: "DELETE",
    signal,
  })
}

export function getAppDatabase(databaseId: string, signal?: AbortSignal) {
  return fetchApi<AppDatabaseSummary>(`/app-databases/${databaseId}`, {
    method: "GET",
    signal,
  })
}

export function listAppDatabaseFolders(databaseId: string, signal?: AbortSignal) {
  return fetchApi<AppDatabaseFolderSummary[]>(`/app-databases/${databaseId}/tables`, {
    method: "GET",
    signal,
  })
}

export function createAppDatabaseFolder(
  databaseId: string,
  body: { name: string; parentFolderId?: string },
  signal?: AbortSignal
) {
  return fetchApi<AppDatabaseFolderSummary>(`/app-databases/${databaseId}/tables`, {
    method: "POST",
    body,
    signal,
  })
}

export function deleteAppDatabaseFolder(folderId: string, signal?: AbortSignal) {
  return fetchApi<{ success: true }>(`/app-database-tables/${folderId}`, {
    method: "DELETE",
    signal,
  })
}

export function listFolderRecords(folderId: string, signal?: AbortSignal) {
  return fetchApi<AppDatabaseRecordSummary[]>(`/app-database-tables/${folderId}/rows`, {
    method: "GET",
    signal,
  })
}

export function createFolderRecord(
  folderId: string,
  body: { name: string; payload: Record<string, unknown>; mimeType?: string },
  signal?: AbortSignal
) {
  return fetchApi<AppDatabaseRecordSummary>(`/app-database-tables/${folderId}/rows`, {
    method: "POST",
    body,
    signal,
  })
}

export function deleteFolderRecord(recordId: string, signal?: AbortSignal) {
  return fetchApi<{ success: true }>(`/app-database-rows/${recordId}`, {
    method: "DELETE",
    signal,
  })
}
