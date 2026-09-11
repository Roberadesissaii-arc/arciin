import { fetchApi } from "@/lib/api/client"
import type { StorageDiscovery, StoragePrepareResult } from "@/lib/types/models"

export const SETUP_TOKEN_HEADER = "x-arciin-setup-token"

function setupHeaders(setupToken: string): HeadersInit {
  return { [SETUP_TOKEN_HEADER]: setupToken }
}

export function getStorageDiscovery(setupToken: string, signal?: AbortSignal) {
  return fetchApi<StorageDiscovery>("/instance/storage-discovery", {
    method: "GET",
    signal,
    headers: setupHeaders(setupToken),
  })
}

export function prepareStoragePath(path: string, setupToken: string) {
  return fetchApi<StoragePrepareResult>("/instance/storage-prepare", {
    method: "POST",
    headers: setupHeaders(setupToken),
    body: { path },
  })
}
